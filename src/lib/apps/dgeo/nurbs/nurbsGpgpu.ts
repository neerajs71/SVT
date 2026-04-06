// @ts-nocheck
/**
 * nurbsGpgpu.ts — WebGL GPGPU evaluator for NURBS surfaces.
 *
 * Uses Three.js renderer to render a fullscreen quad with the NURBS fragment
 * shader into a float render target, then reads back surface point positions.
 *
 * Control points are normalised to [0,1] before GPU upload and denormalised
 * after readback to work around RGBA8 fallback clamping on many devices.
 */

import * as THREE from 'three';
import { nurbsEvalFrag, fullscreenVert } from './nurbsEval.glsl.ts';
import type { NurbsSurfaceParams, NurbsEvalResult } from '../types.ts';

export class NurbsGpgpu {
  #renderer: THREE.WebGLRenderer;
  #rt:       THREE.WebGLRenderTarget;
  #mat:      THREE.ShaderMaterial;
  #scene:    THREE.Scene;
  #cam:      THREE.OrthographicCamera;
  #res:      number;

  constructor(renderer: THREE.WebGLRenderer, resolution = 40) {
    this.#renderer = renderer;
    this.#res      = resolution;

    const W = resolution + 1, H = resolution + 1;

    this.#rt = new THREE.WebGLRenderTarget(W, H, {
      type:          THREE.FloatType,
      format:        THREE.RGBAFormat,
      magFilter:     THREE.NearestFilter,
      minFilter:     THREE.NearestFilter,
      depthBuffer:   false,
      stencilBuffer: false,
    });

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

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]), 2));

    this.#scene = new THREE.Scene();
    this.#scene.add(new THREE.Mesh(geo, this.#mat));
    this.#cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  evaluate(params: NurbsSurfaceParams): NurbsEvalResult {
    const { controlPoints, nCtrlU, nCtrlV, uKnots, vKnots, degreeU, degreeV } = params;

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
      cpArr[i].set((x-mnX)/rX, (y-mnY)/rY, (z-mnZ)/rZ, 1.0);
    }

    const ku = new Float32Array(40); ku.set(uKnots.slice(0, 40));
    const kv = new Float32Array(40); kv.set(vKnots.slice(0, 40));
    u.uKnotsU.value = ku;
    u.uKnotsV.value = kv;
    this.#mat.needsUpdate = true;

    const prev = this.#renderer.getRenderTarget();
    this.#renderer.setRenderTarget(this.#rt);
    this.#renderer.render(this.#scene, this.#cam);
    this.#renderer.setRenderTarget(prev);

    const W   = this.#res + 1, H = this.#res + 1;
    const raw = new Float32Array(W * H * 4);
    this.#renderer.readRenderTargetPixels(this.#rt, 0, 0, W, H, raw);

    const positions = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      positions[i*3]   = raw[i*4]   * rX + mnX;
      positions[i*3+1] = raw[i*4+1] * rY + mnY;
      positions[i*3+2] = raw[i*4+2] * rZ + mnZ;
    }

    const indices = new Uint32Array(this.#res * this.#res * 6);
    let ii = 0;
    for (let r = 0; r < this.#res; r++) {
      for (let c = 0; c < this.#res; c++) {
        const a = r*W+c, b=a+1, d=(r+1)*W+c, e=d+1;
        indices[ii++]=a; indices[ii++]=b; indices[ii++]=e;
        indices[ii++]=a; indices[ii++]=e; indices[ii++]=d;
      }
    }

    return { positions, indices, resolution: this.#res };
  }

  dispose(): void {
    this.#rt.dispose();
    this.#mat.dispose();
  }
}
