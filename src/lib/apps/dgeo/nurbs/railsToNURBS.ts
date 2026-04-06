/**
 * railsToNURBS.ts
 *
 * Converts dgeo horizon rails to a NURBSSurfaceParams object suitable for
 * GPU evaluation via NurbsGpgpu / NurbsWebGpu / NurbsCpu.
 *
 * Layout:
 *   U direction = along the horizon profile (arc-length parameterised)
 *   V direction = along strike (one row per rail)
 *
 * Guarantees at least MIN_RAILS rows by splitting the largest gap between
 * adjacent rails, inserting a linearly-interpolated intermediate rail.
 * This ensures cubic (degree-3) basis in the V direction on all surfaces.
 */

import type { Rail, Point2D, DomainBounds, NurbsSurfaceParams } from '../types.ts';

const MIN_RAILS = 4;

export interface RailsToNurbsOptions {
  sampleArcLength: (pts: Point2D[], n: number) => Point2D[];
  nX:      (x: number) => number;
  nDepth:  (y: number) => number;
  nStrike: (z_km: number) => number;
  domX?:   DomainBounds;
  nCtrlU?: number;
}

export function railsToNURBS(
  rails: Rail[],
  { sampleArcLength, nX, nDepth, nStrike, domX, nCtrlU = 8 }: RailsToNurbsOptions,
): NurbsSurfaceParams | null {
  let sorted = [...rails].sort((a, b) => a.z - b.z);
  if (sorted.length < 2) return null;

  // ── Pad to MIN_RAILS by splitting the widest gap ──────────────────────────
  while (sorted.length < MIN_RAILS) {
    let maxGap = -1, gapIdx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].z - sorted[i].z;
      if (gap > maxGap) { maxGap = gap; gapIdx = i; }
    }
    const r0 = sorted[gapIdx], r1 = sorted[gapIdx + 1];
    const midZ  = (r0.z + r1.z) / 2;
    const nPts  = Math.max(r0.points.length, r1.points.length, 2);
    const s0    = sampleArcLength(r0.points, nPts);
    const s1    = sampleArcLength(r1.points, nPts);
    const midPts = s0.map((p, i) => ({
      x: (p.x + s1[i].x) / 2,
      y: (p.y + s1[i].y) / 2,
    }));
    sorted = [
      ...sorted.slice(0, gapIdx + 1),
      { z: midZ, points: midPts },
      ...sorted.slice(gapIdx + 1),
    ];
  }

  const nCtrlV  = sorted.length;
  const degreeU = Math.min(3, nCtrlU - 1);
  const degreeV = Math.min(3, nCtrlV - 1);

  // Control points: nCtrlV rows × nCtrlU cols, world-space [x, y, z]
  const controlPoints: number[][] = sorted.flatMap(rail => {
    const pts = sampleArcLength(rail.points, nCtrlU);
    if (domX && pts.length > 0) {
      pts[0].x = domX.min;
      pts[pts.length - 1].x = domX.max;
    }
    return pts.map(p => [nX(p.x), nStrike(rail.z), nDepth(p.y)]);
  });

  return {
    controlPoints,
    nCtrlU,
    nCtrlV,
    uKnots: clampedUniform(nCtrlU, degreeU),
    vKnots: clampedUniform(nCtrlV, degreeV),
    degreeU,
    degreeV,
    resolution: 40,
  };
}

// ── Clamped uniform knot vector ───────────────────────────────────────────────
function clampedUniform(n: number, degree: number): number[] {
  const inner = n - degree - 1;
  return [
    ...Array(degree + 1).fill(0),
    ...Array.from({ length: inner }, (_, i) => (i + 1) / (inner + 1)),
    ...Array(degree + 1).fill(1),
  ];
}
