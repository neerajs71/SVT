/**
 * nurbsWebGpu.js — WebGPU compute-shader NURBS surface evaluator
 *
 * Ported from pyenthu/dlis src/routes/test/lib/webnurbs/ with these simplifications:
 *   - positionUniform binding removed (control points are already in world space)
 *   - Output is 1 vec4 per vertex (position only; normals computed by Three.js CPU-side)
 *   - Bindings renumbered 0–4
 *   - Control point index formula changed from U-major to V-major to match railsToNURBS():
 *       cpIndex = (startV + l) * numControlPointsU + (startU + k)
 *
 * Fallback: NurbsGpgpu (WebGL) → NurbsCpu — wired in Dgeo3DScene.svelte.
 *
 * Same evaluate() return shape as NurbsGpgpu / NurbsCpu:
 *   { positions: Float32Array, indices: Uint32Array, resolution: number }
 */

// ── WGSL compute shader ────────────────────────────────────────────────────
// Derived from pyenthu/dlis shaders/compute.wgsl (MIT, same author).
// Only the cpIndex line and output format differ from the original.
const COMPUTE_WGSL = /* wgsl */`
struct NURBSParams {
  degreeU           : u32,
  degreeV           : u32,
  numControlPointsU : u32,
  numControlPointsV : u32,
  numKnotsU         : u32,
  numKnotsV         : u32,
  resolution        : u32,
  _padding          : u32,
};

@group(0) @binding(0) var<uniform>            params        : NURBSParams;
@group(0) @binding(1) var<storage, read>      controlPoints : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>      knotsU        : array<f32>;
@group(0) @binding(3) var<storage, read>      knotsV        : array<f32>;
@group(0) @binding(4) var<storage, read_write> output       : array<vec4<f32>>;

// ── Knot span binary search ────────────────────────────────────────────────

fn findKnotSpanU(u: f32, degree: u32, numKnots: u32) -> u32 {
  if (u >= knotsU[numKnots - degree - 1u]) { return numKnots - degree - 2u; }
  if (u <  knotsU[degree])                 { return degree; }
  var lo  = degree;
  var hi  = numKnots - degree - 1u;
  var mid = (lo + hi) / 2u;
  while (u < knotsU[mid] || u >= knotsU[mid + 1u]) {
    if (u < knotsU[mid]) { hi = mid; } else { lo = mid + 1u; }
    mid = (lo + hi) / 2u;
  }
  return mid;
}

fn findKnotSpanV(v: f32, degree: u32, numKnots: u32) -> u32 {
  if (v >= knotsV[numKnots - degree - 1u]) { return numKnots - degree - 2u; }
  if (v <  knotsV[degree])                 { return degree; }
  var lo  = degree;
  var hi  = numKnots - degree - 1u;
  var mid = (lo + hi) / 2u;
  while (v < knotsV[mid] || v >= knotsV[mid + 1u]) {
    if (v < knotsV[mid]) { hi = mid; } else { lo = mid + 1u; }
    mid = (lo + hi) / 2u;
  }
  return mid;
}

// ── Cox–de Boor basis functions ───────────────────────────────────────────

fn basisFunctionsU(u: f32, span: u32, degree: u32,
                   basis: ptr<function, array<f32, 10>>) {
  var left  : array<f32, 10>;
  var right : array<f32, 10>;
  (*basis)[0] = 1.0;
  for (var j = 1u; j <= degree; j++) {
    left[j]  = u - knotsU[span + 1u - j];
    right[j] = knotsU[span + j] - u;
    var saved = 0.0;
    for (var r = 0u; r < j; r++) {
      let tmp     = (*basis)[r] / (right[r + 1u] + left[j - r]);
      (*basis)[r] = saved + right[r + 1u] * tmp;
      saved       = left[j - r] * tmp;
    }
    (*basis)[j] = saved;
  }
}

fn basisFunctionsV(v: f32, span: u32, degree: u32,
                   basis: ptr<function, array<f32, 10>>) {
  var left  : array<f32, 10>;
  var right : array<f32, 10>;
  (*basis)[0] = 1.0;
  for (var j = 1u; j <= degree; j++) {
    left[j]  = v - knotsV[span + 1u - j];
    right[j] = knotsV[span + j] - v;
    var saved = 0.0;
    for (var r = 0u; r < j; r++) {
      let tmp     = (*basis)[r] / (right[r + 1u] + left[j - r]);
      (*basis)[r] = saved + right[r + 1u] * tmp;
      saved       = left[j - r] * tmp;
    }
    (*basis)[j] = saved;
  }
}

// ── Main compute entry ────────────────────────────────────────────────────

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ui         = gid.x;
  let vi         = gid.y;
  let resolution = params.resolution;
  if (ui > resolution || vi > resolution) { return; }

  var u = f32(ui) / f32(resolution);
  var v = f32(vi) / f32(resolution);

  // Clamp to valid knot range
  let uMin = knotsU[params.degreeU];
  let uMax = knotsU[params.numKnotsU - params.degreeU - 1u];
  let vMin = knotsV[params.degreeV];
  let vMax = knotsV[params.numKnotsV - params.degreeV - 1u];
  u = clamp(u, uMin, uMax);
  v = clamp(v, vMin, vMax);

  let spanU  = findKnotSpanU(u, params.degreeU, params.numKnotsU);
  let spanV  = findKnotSpanV(v, params.degreeV, params.numKnotsV);

  var basisU : array<f32, 10>;
  var basisV : array<f32, 10>;
  basisFunctionsU(u, spanU, params.degreeU, &basisU);
  basisFunctionsV(v, spanV, params.degreeV, &basisV);

  let startU = spanU - params.degreeU;
  let startV = spanV - params.degreeV;

  var point = vec4<f32>(0.0);

  for (var l = 0u; l <= params.degreeV; l++) {
    var temp = vec4<f32>(0.0);
    for (var k = 0u; k <= params.degreeU; k++) {
      // V-major layout: railsToNURBS stores rows=rails (V), cols=profile (U)
      // cpIndex = (startV + l) * numControlPointsU + (startU + k)
      let cpIndex = (startV + l) * params.numControlPointsU + (startU + k);
      temp += controlPoints[cpIndex] * basisU[k];
    }
    point += temp * basisV[l];
  }

  // Dehomogenise
  var pos = vec3<f32>(0.0);
  if (point.w != 0.0) { pos = point.xyz / point.w; }

  output[vi * (resolution + 1u) + ui] = vec4<f32>(pos, 1.0);
}
`;

// ── NurbsWebGpu class ─────────────────────────────────────────────────────

export class NurbsWebGpu {
  /** @type {GPUDevice} */    #device;
  /** @type {number} */       #res;
  /** @type {GPUComputePipeline} */ #pipeline;

  /**
   * Async factory — throws if WebGPU is unavailable.
   * @param {number} resolution
   */
  static async create(resolution = 40) {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice();
    return new NurbsWebGpu(device, resolution);
  }

  constructor(device, resolution) {
    this.#device   = device;
    this.#res      = resolution;
    this.#pipeline = device.createComputePipeline({
      layout:  'auto',
      compute: {
        module:     device.createShaderModule({ code: COMPUTE_WGSL }),
        entryPoint: 'main',
      },
    });
  }

  /**
   * Evaluate a NURBS surface and return vertex data.
   * Follows evaluation/surface.ts from pyenthu/dlis.
   *
   * @param {ReturnType<import('./railsToNURBS.js').railsToNURBS>} params
   * @returns {Promise<{ positions: Float32Array, indices: Uint32Array, resolution: number }>}
   */
  async evaluate({ controlPoints, nCtrlU, nCtrlV, uKnots, vKnots, degreeU, degreeV }) {
    const device = this.#device;
    const res    = this.#res;
    const W      = res + 1;
    const nVerts = W * W;

    // ── Control points → flat Float32Array [x,y,z,w, x,y,z,w, ...] ─────────
    const cpFlat = new Float32Array(controlPoints.length * 4);
    for (let i = 0; i < controlPoints.length; i++) {
      cpFlat[i * 4]     = controlPoints[i][0];
      cpFlat[i * 4 + 1] = controlPoints[i][1];
      cpFlat[i * 4 + 2] = controlPoints[i][2];
      cpFlat[i * 4 + 3] = 1.0;   // weight = 1 (non-rational)
    }

    // ── GPU buffers ───────────────────────────────────────────────────────────
    const mkBuf = (data, usage) => {
      const buf = device.createBuffer({ size: data.byteLength, usage });
      device.queue.writeBuffer(buf, 0, data);
      return buf;
    };

    const STORAGE  = GPUBufferUsage.STORAGE  | GPUBufferUsage.COPY_DST;
    const UNIFORM  = GPUBufferUsage.UNIFORM  | GPUBufferUsage.COPY_DST;
    const OUT      = GPUBufferUsage.STORAGE  | GPUBufferUsage.COPY_SRC;
    const STAGING  = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;

    const paramsData = new Uint32Array([
      degreeU, degreeV,
      nCtrlU,  nCtrlV,
      uKnots.length, vKnots.length,
      res, 0,     // resolution + padding
    ]);

    const paramsBuf = mkBuf(paramsData,               UNIFORM);
    const cpBuf     = mkBuf(cpFlat,                   STORAGE);
    const kuBuf     = mkBuf(new Float32Array(uKnots), STORAGE);
    const kvBuf     = mkBuf(new Float32Array(vKnots), STORAGE);

    const outSize   = nVerts * 4 * 4;   // nVerts × vec4<f32>
    const outBuf    = device.createBuffer({ size: outSize, usage: OUT });

    // ── Dispatch ──────────────────────────────────────────────────────────────
    const bindGroup = device.createBindGroup({
      layout: this.#pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: cpBuf     } },
        { binding: 2, resource: { buffer: kuBuf     } },
        { binding: 3, resource: { buffer: kvBuf     } },
        { binding: 4, resource: { buffer: outBuf    } },
      ],
    });

    const enc  = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, bindGroup);
    const wg = Math.ceil(W / 8);
    pass.dispatchWorkgroups(wg, wg);
    pass.end();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();

    // ── Readback ──────────────────────────────────────────────────────────────
    const stagingBuf = device.createBuffer({ size: outSize, usage: STAGING });
    const enc2 = device.createCommandEncoder();
    enc2.copyBufferToBuffer(outBuf, 0, stagingBuf, 0, outSize);
    device.queue.submit([enc2.finish()]);
    await device.queue.onSubmittedWorkDone();

    await stagingBuf.mapAsync(GPUMapMode.READ);
    const raw = new Float32Array(stagingBuf.getMappedRange().slice(0));
    stagingBuf.unmap();

    // Extract XYZ from vec4 (w is 1.0, ignored)
    const positions = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts; i++) {
      positions[i * 3]     = raw[i * 4];
      positions[i * 3 + 1] = raw[i * 4 + 1];
      positions[i * 3 + 2] = raw[i * 4 + 2];
    }

    // ── Cleanup intermediate buffers ──────────────────────────────────────────
    paramsBuf.destroy();
    cpBuf.destroy();
    kuBuf.destroy();
    kvBuf.destroy();
    outBuf.destroy();
    stagingBuf.destroy();

    // ── Triangle index buffer (same quad winding as buildGridGeo) ────────────
    const indices = new Uint32Array(res * res * 6);
    let ii = 0;
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const a = r * W + c, b = a + 1, d = (r + 1) * W + c, e = d + 1;
        indices[ii++] = a; indices[ii++] = b; indices[ii++] = e;
        indices[ii++] = a; indices[ii++] = e; indices[ii++] = d;
      }
    }

    return { positions, indices, resolution: res };
  }

  /** Release the GPUDevice. Call when the component unmounts. */
  destroy() {
    try { this.#device.destroy(); } catch { /* ignore if already gone */ }
  }
}
