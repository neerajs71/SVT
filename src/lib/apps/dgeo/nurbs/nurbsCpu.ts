/**
 * nurbsCpu.ts — CPU B-spline surface evaluator (Cox–de Boor)
 *
 * Same evaluate() interface as NurbsGpgpu so the call-site is unchanged.
 * For a 40×40 grid (1681 points) this runs in < 5 ms in modern JS engines.
 */

import type { NurbsSurfaceParams, NurbsEvalResult } from '../types.ts';

// ── Knot-span binary search ───────────────────────────────────────────────────
function findSpan(t: number, n: number, p: number, U: number[]): number {
  if (t >= U[n + 1]) return n;
  if (t <= U[p])     return p;
  let lo = p, hi = n + 1, mid = (lo + hi) >> 1;
  while (t < U[mid] || t >= U[mid + 1]) {
    if (t < U[mid]) hi = mid; else lo = mid + 1;
    mid = (lo + hi) >> 1;
  }
  return mid;
}

// ── B-spline basis functions ──────────────────────────────────────────────────
function basisFuncs(t: number, span: number, p: number, U: number[]): Float64Array {
  const N     = new Float64Array(p + 1);
  const left  = new Float64Array(p + 1);
  const right = new Float64Array(p + 1);
  N[0] = 1.0;
  for (let j = 1; j <= p; j++) {
    left[j]  = t - U[span + 1 - j];
    right[j] = U[span + j] - t;
    let saved = 0.0;
    for (let r = 0; r < j; r++) {
      const denom = right[r + 1] + left[j - r];
      const tmp   = denom > 1e-14 ? N[r] / denom : 0.0;
      N[r]  = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
  return N;
}

// ── NurbsCpu class ────────────────────────────────────────────────────────────
export class NurbsCpu {
  readonly #res: number;

  constructor(resolution = 40) {
    this.#res = resolution;
  }

  /** No-op — no GPU resources to release. */
  dispose(): void {}

  evaluate(params: NurbsSurfaceParams): NurbsEvalResult {
    const { controlPoints, nCtrlU, nCtrlV, uKnots, vKnots, degreeU, degreeV, resolution } = params;
    const res = resolution ?? this.#res;
    const W   = res + 1;

    const positions = new Float32Array(W * W * 3);

    for (let row = 0; row < W; row++) {
      const v     = row / res;
      const spanV = findSpan(v, nCtrlV - 1, degreeV, vKnots);
      const Nv    = basisFuncs(v, spanV, degreeV, vKnots);

      for (let col = 0; col < W; col++) {
        const u     = col / res;
        const spanU = findSpan(u, nCtrlU - 1, degreeU, uKnots);
        const Nu    = basisFuncs(u, spanU, degreeU, uKnots);

        let x = 0, y = 0, z = 0, wSum = 0;

        for (let j = 0; j <= degreeV; j++) {
          for (let i = 0; i <= degreeU; i++) {
            const idx = (spanV - degreeV + j) * nCtrlU + (spanU - degreeU + i);
            if (idx < 0 || idx >= controlPoints.length) continue;
            const cp = controlPoints[idx];
            const w  = Nu[i] * Nv[j];
            x += w * cp[0]; y += w * cp[1]; z += w * cp[2];
            wSum += w;
          }
        }

        if (wSum > 1e-14) { x /= wSum; y /= wSum; z /= wSum; }

        const base = (row * W + col) * 3;
        positions[base]     = x;
        positions[base + 1] = y;
        positions[base + 2] = z;
      }
    }

    const indices = new Uint32Array(res * res * 6);
    let ii = 0;
    for (let r = 0; r < res; r++) {
      for (let c = 0; c < res; c++) {
        const a = r * W + c, b = a + 1;
        const d = (r + 1) * W + c, e = d + 1;
        indices[ii++] = a; indices[ii++] = b; indices[ii++] = e;
        indices[ii++] = a; indices[ii++] = e; indices[ii++] = d;
      }
    }

    return { positions, indices, resolution: res };
  }
}
