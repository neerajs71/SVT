/**
 * nurbsGpgpu.js
 *
 * WebGL GPGPU evaluator for NURBS surfaces.
 * Uses the existing Three.js renderer (from useThrelte()) to render a
 * fullscreen quad with the NURBS fragment shader into a float render target,
 * then reads back the surface point positions via readRenderTargetPixels().
 *
 * FIX: control points are normalised to [0,1] before upload and denormalised
 * after readback.  Many devices silently fall back from FloatType to RGBA8
 * render targets; without normalisation, world-space coords (0–10) are clamped
 * to 1.0 in RGBA8, making every surface collapse to the top face of the block.
 *
 * Works on all browsers that support THREE.FloatType render targets
 * (requires OES_texture_float + WEBGL_color_buffer_float on WebGL1,
 *  standard on WebGL2 / Three.js r152+).
 */

import * as THREE from 'three';
import { nurbsEvalFrag, fullscreenVert } from './nurbsEval.glsl.js';

export class NurbsGpgpu {
  /** @type {THREE.WebGLRenderer} */       #renderer;
  /** @type {THREE.WebGLRenderTarget} */   #rt;
  /** @type {THREE.ShaderMaterial} */      #mat;
  /** @type {THREE.Scene} */               #scene;
  /** @type {THREE.OrthographicCamera} */  #cam;
  #res;

  /**
   * @param {THREE.WebGLRenderer} renderer  — from useThrelte().renderer
   * @param {number} resolution             — NxN output grid (default 40)
   */
  constructor(renderer, resolution = 40) {
    this.#renderer = renderer;
    this.#res      = resolution;

    const W = resolution + 1, H = resolution + 1;

    // Float render target — each pixel stores one surface point (XYZ in [0,1])
    this.#rt = new THREE.WebGLRenderTarget(W, H, {
      type:          THREE.FloatType,
      format:        THREE.RGBAFormat,
      magFilter:     THREE.NearestFilter,
      minFilter:     THREE.NearestFilter,
      depthBuffer:   false,
      stencilBuffer: false,
    });

    // Pre-allocate uniform vectors (avoids per-frame GC); matches MAX_CP in GLSL
    const cpUniforms = Array.from({ length: 512 }, () => new THREE.Vector4(0, 0, 0, 1));

    this.#mat = new THREE.ShaderMaterial({
      vertexShader:   fullscreenVert,
      fragmentShader: nurbsEvalFrag,
      uniforms: {
        uDegreeU:       { value: 3 },
        uDegreeV:       { value: 3 },
        uNCtrlU:        { value: 8 },
        uNCtrlV:        { value: 4 },
        uResolution:    { value: resolution },
        uControlPoints: { value: cpUniforms },
        uKnotsU:        { value: new Float32Array(40) },
        uKnotsV:        { value: new Float32Array(40) },
      },
    });

    // Fullscreen quad — two triangles covering [-1,1]²
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), 2));

    this.#scene = new THREE.Scene();
    this.#scene.add(new THREE.Mesh(geo, this.#mat));
    this.#cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  /**
   * Evaluate a NURBS surface and return vertex positions + triangle indices.
   *
   * Control points are normalised to [0,1] per axis before GPU upload and
   * denormalised after readback, so the render target always stores values in
   * [0,1] regardless of whether the device supports true float textures.
   *
   * @param {ReturnType<import('./railsToNURBS.js').railsToNURBS>} params
   * @returns {{ positions: Float32Array, indices: Uint32Array, resolution: number }}
   */
  evaluate(params) {
    const { controlPoints, nCtrlU, nCtrlV, uKnots, vKnots, degreeU, degreeV } = params;

    // ── Normalise control points to [0,1] per axis ───────────────────────────
    let mnX =  Infinity, mxX = -Infinity;
    let mnY =  Infinity, mxY = -Infinity;
    let mnZ =  Infinity, mxZ = -Infinity;
    for (const [x, y, z] of controlPoints) {
      if (x < mnX) mnX = x;  if (x > mxX) mxX = x;
      if (y < mnY) mnY = y;  if (y > mxY) mxY = y;
      if (z < mnZ) mnZ = z;  if (z > mxZ) mxZ = z;
    }
    const rX = mxX - mnX || 1;
    const rY = mxY - mnY || 1;
    const rZ = mxZ - mnZ || 1;

    // ── Upload uniforms ───────────────────────────────────────────────────────
    const u = this.#mat.uniforms;
    u.uDegreeU.value    = degreeU;
    u.uDegreeV.value    = degreeV;
    u.uNCtrlU.value     = nCtrlU;
    u.uNCtrlV.value     = nCtrlV;
    u.uResolution.value = this.#res;

    const cpArr = u.uControlPoints.value;
    const nCP   = Math.min(controlPoints.length, 512);
    for (let i = 0; i < nCP; i++) {
      const [x, y, z] = controlPoints[i];
      cpArr[i].set(
        (x - mnX) / rX,
        (y - mnY) / rY,
        (z - mnZ) / rZ,
        1.0,
      );
    }

    const ku = new Float32Array(40); ku.set(uKnots.slice(0, 40));
    const kv = new Float32Array(40); kv.set(vKnots.slice(0, 40));
    u.uKnotsU.value = ku;
    u.uKnotsV.value = kv;
    this.#mat.needsUpdate = true;

    // ── GPU evaluation: render to float texture ───────────────────────────────
    const prev = this.#renderer.getRenderTarget();
    this.#renderer.setRenderTarget(this.#rt);
    this.#renderer.render(this.#scene, this.#cam);
    this.#renderer.setRenderTarget(prev);

    // ── Read back pixel data ──────────────────────────────────────────────────
    const W   = this.#res + 1, H = this.#res + 1;
    const raw = new Float32Array(W * H * 4);
    this.#renderer.readRenderTargetPixels(this.#rt, 0, 0, W, H, raw);

    // Denormalise XYZ back to world space
    const positions = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      positions[i * 3]     = raw[i * 4]     * rX + mnX;
      positions[i * 3 + 1] = raw[i * 4 + 1] * rY + mnY;
      positions[i * 3 + 2] = raw[i * 4 + 2] * rZ + mnZ;
    }

    // ── Build triangle index buffer (quad grid, same as buildGridGeo) ─────────
    const indices = new Uint32Array(this.#res * this.#res * 6);
    let ii = 0;
    for (let r = 0; r < this.#res; r++) {
      for (let c = 0; c < this.#res; c++) {
        const a = r * W + c, b = a + 1;
        const d = (r + 1) * W + c, e = d + 1;
        indices[ii++] = a; indices[ii++] = b; indices[ii++] = e;
        indices[ii++] = a; indices[ii++] = e; indices[ii++] = d;
      }
    }

    return { positions, indices, resolution: this.#res };
  }

  dispose() {
    this.#rt.dispose();
    this.#mat.dispose();
  }
}
