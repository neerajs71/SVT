/**
 * nurbsGpgpu.js
 *
 * WebGL GPGPU evaluator for NURBS surfaces.
 * Uses the existing Three.js renderer (from useThrelte()) to render a
 * fullscreen quad with the NURBS fragment shader into a float render target,
 * then reads back the surface point positions via readRenderTargetPixels().
 *
 * Works on all browsers that support THREE.FloatType render targets
 * (requires OES_texture_float + WEBGL_color_buffer_float on WebGL1,
 *  standard on WebGL2 / Three.js r152+).
 */

import * as THREE from 'three';
import { nurbsEvalFrag, fullscreenVert } from './nurbsEval.glsl.js';

export class NurbsGpgpu {
  /** @type {THREE.WebGLRenderer} */  #renderer;
  /** @type {THREE.WebGLRenderTarget} */ #rt;
  /** @type {THREE.ShaderMaterial} */  #mat;
  /** @type {THREE.Scene} */           #scene;
  /** @type {THREE.OrthographicCamera} */ #cam;
  #res;

  /**
   * @param {THREE.WebGLRenderer} renderer  — from useThrelte().renderer
   * @param {number} resolution             — NxN output grid (default 40)
   */
  constructor(renderer, resolution = 40) {
    this.#renderer = renderer;
    this.#res      = resolution;

    const W = resolution + 1, H = resolution + 1;

    // Float render target — each pixel stores one surface point (XYZ)
    this.#rt = new THREE.WebGLRenderTarget(W, H, {
      type:          THREE.FloatType,
      format:        THREE.RGBAFormat,
      magFilter:     THREE.NearestFilter,
      minFilter:     THREE.NearestFilter,
      depthBuffer:   false,
      stencilBuffer: false,
    });

    // Pre-allocate uniform vectors (avoids per-frame GC)
    const cpUniforms = Array.from({ length: 64 }, () => new THREE.Vector4(0, 0, 0, 1));

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
        uKnotsU:        { value: new Float32Array(16) },
        uKnotsV:        { value: new Float32Array(16) },
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
   * @param {ReturnType<import('./railsToNURBS.js').railsToNURBS>} params
   * @returns {{ positions: Float32Array, indices: Uint32Array, resolution: number }}
   */
  evaluate(params) {
    const { controlPoints, nCtrlU, nCtrlV, uKnots, vKnots, degreeU, degreeV } = params;
    const u = this.#mat.uniforms;

    // Upload scalar uniforms
    u.uDegreeU.value   = degreeU;
    u.uDegreeV.value   = degreeV;
    u.uNCtrlU.value    = nCtrlU;
    u.uNCtrlV.value    = nCtrlV;
    u.uResolution.value = this.#res;

    // Upload control points (xyz → vec4 w=1)
    const cpArr = u.uControlPoints.value;
    const nCP   = Math.min(controlPoints.length, 64);
    for (let i = 0; i < nCP; i++) {
      const [x, y, z] = controlPoints[i];
      cpArr[i].set(x, y, z, 1.0);
    }

    // Upload knot vectors into pre-sized Float32Arrays
    const ku = new Float32Array(16); ku.set(uKnots.slice(0, 16));
    const kv = new Float32Array(16); kv.set(vKnots.slice(0, 16));
    u.uKnotsU.value = ku;
    u.uKnotsV.value = kv;

    this.#mat.needsUpdate = true;

    // ── GPU evaluation: render to float texture ──────────────────────────
    const prev = this.#renderer.getRenderTarget();
    this.#renderer.setRenderTarget(this.#rt);
    this.#renderer.render(this.#scene, this.#cam);
    this.#renderer.setRenderTarget(prev);

    // ── Read back pixel data ─────────────────────────────────────────────
    const W   = this.#res + 1, H = this.#res + 1;
    const raw = new Float32Array(W * H * 4);
    this.#renderer.readRenderTargetPixels(this.#rt, 0, 0, W, H, raw);

    // Extract XYZ — discard W channel
    const positions = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      positions[i * 3]     = raw[i * 4];
      positions[i * 3 + 1] = raw[i * 4 + 1];
      positions[i * 3 + 2] = raw[i * 4 + 2];
    }

    // ── Build triangle index buffer (quad grid, same as buildGridGeo) ────
    const indices = [];
    for (let r = 0; r < this.#res; r++) {
      for (let c = 0; c < this.#res; c++) {
        const a = r * W + c;
        const b = a + 1;
        const d = (r + 1) * W + c;
        const e = d + 1;
        indices.push(a, b, e,  a, e, d);
      }
    }

    return {
      positions,
      indices:    new Uint32Array(indices),
      resolution: this.#res,
    };
  }

  dispose() {
    this.#rt.dispose();
    this.#mat.dispose();
  }
}
