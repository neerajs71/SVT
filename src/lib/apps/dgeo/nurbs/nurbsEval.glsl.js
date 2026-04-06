/**
 * nurbsEval.glsl.js
 *
 * GLSL shaders for WebGL GPGPU NURBS surface evaluation.
 * Ported from pyenthu/dlis src/routes/test/lib/webnurbs/shaders/compute.wgsl
 *
 * Each fragment corresponds to one (u,v) sample on the surface.
 * gl_FragCoord.xy / uResolution → (u, v) ∈ [0,1]²
 * Output: gl_FragColor = vec4(x, y, z, 1.0)  (world-space surface point)
 *
 * Limits (sufficient for geological horizons with folds):
 *   MAX_CP   = 512  control points  (e.g. 32 U × 16 V)
 *   MAX_KNOT = 40   knots per axis  (up to 36 ctrl pts with degree 3)
 *   MAX_DEG  = 10   basis functions (degree ≤ 9)
 */

export const fullscreenVert = /* glsl */`
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const nurbsEvalFrag = /* glsl */`
precision highp float;

#define MAX_CP   512
#define MAX_KNOT 40
#define MAX_DEG  10

uniform int   uDegreeU;
uniform int   uDegreeV;
uniform int   uNCtrlU;
uniform int   uNCtrlV;
uniform int   uResolution;
uniform vec4  uControlPoints[MAX_CP];   // xyz + w (homogeneous weight)
uniform float uKnotsU[MAX_KNOT];
uniform float uKnotsV[MAX_KNOT];

// ── Knot span (binary search) ─────────────────────────────────────────────
int findKnotSpanU(float t) {
  int deg = uDegreeU;
  int n   = uNCtrlU + deg;          // nKnots - 1
  int hi  = n - deg - 1;
  if (t >= uKnotsU[hi + 1]) return hi;
  if (t <= uKnotsU[deg])    return deg;
  int lo  = deg, mid = (lo + hi) / 2;
  for (int iter = 0; iter < 20; iter++) {
    if      (t <  uKnotsU[mid])     hi = mid;
    else if (t >= uKnotsU[mid + 1]) lo = mid + 1;
    else break;
    mid = (lo + hi) / 2;
  }
  return mid;
}

int findKnotSpanV(float t) {
  int deg = uDegreeV;
  int n   = uNCtrlV + deg;
  int hi  = n - deg - 1;
  if (t >= uKnotsV[hi + 1]) return hi;
  if (t <= uKnotsV[deg])    return deg;
  int lo  = deg, mid = (lo + hi) / 2;
  for (int iter = 0; iter < 20; iter++) {
    if      (t <  uKnotsV[mid])     hi = mid;
    else if (t >= uKnotsV[mid + 1]) lo = mid + 1;
    else break;
    mid = (lo + hi) / 2;
  }
  return mid;
}

// ── B-spline basis functions (Cox–de Boor) ────────────────────────────────
void basisFuncsU(float t, int span, out float N[MAX_DEG]) {
  float left[MAX_DEG], right[MAX_DEG];
  N[0] = 1.0;
  for (int j = 1; j <= uDegreeU; j++) {
    left[j]  = t - uKnotsU[span + 1 - j];
    right[j] = uKnotsU[span + j] - t;
    float saved = 0.0;
    for (int r = 0; r < j; r++) {
      float denom = right[r + 1] + left[j - r];
      float tmp   = (denom > 0.0) ? N[r] / denom : 0.0;
      N[r]  = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
}

void basisFuncsV(float t, int span, out float N[MAX_DEG]) {
  float left[MAX_DEG], right[MAX_DEG];
  N[0] = 1.0;
  for (int j = 1; j <= uDegreeV; j++) {
    left[j]  = t - uKnotsV[span + 1 - j];
    right[j] = uKnotsV[span + j] - t;
    float saved = 0.0;
    for (int r = 0; r < j; r++) {
      float denom = right[r + 1] + left[j - r];
      float tmp   = (denom > 0.0) ? N[r] / denom : 0.0;
      N[r]  = saved + right[r + 1] * tmp;
      saved = left[j - r] * tmp;
    }
    N[j] = saved;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
void main() {
  // UV from fragment coordinate
  float u = clamp((gl_FragCoord.x - 0.5) / float(uResolution), 0.0, 1.0);
  float v = clamp((gl_FragCoord.y - 0.5) / float(uResolution), 0.0, 1.0);

  int spanU = findKnotSpanU(u);
  int spanV = findKnotSpanV(v);

  float Nu[MAX_DEG], Nv[MAX_DEG];
  basisFuncsU(u, spanU, Nu);
  basisFuncsV(v, spanV, Nv);

  vec3  point = vec3(0.0);
  float wSum  = 0.0;

  for (int j = 0; j <= uDegreeV; j++) {
    for (int i = 0; i <= uDegreeU; i++) {
      int idx = (spanV - uDegreeV + j) * uNCtrlU + (spanU - uDegreeU + i);
      // Guard against out-of-bounds (GLSL requires constant array index in some drivers,
      // but MAX_CP is a compile-time constant so the uniform array is safe)
      if (idx < 0 || idx >= MAX_CP) continue;
      vec4  cp = uControlPoints[idx];
      float w  = cp.w * Nu[i] * Nv[j];
      point   += w * cp.xyz;
      wSum    += w;
    }
  }
  if (wSum > 1e-10) point /= wSum;

  gl_FragColor = vec4(point, 1.0);
}
`;
