/**
 * types.ts — DGeo shared type definitions
 *
 * Pure TypeScript interfaces only — no Svelte runes, no Three.js imports.
 * Imported by state classes, components, and utility modules.
 */

// ── Geometry primitives ───────────────────────────────────────────────────────

export interface Point2D {
  x: number;
  y: number;
}

export interface Rail {
  /** Along-strike position in km */
  z: number;
  /** Cross-section horizon points (x = distance, y = depth) */
  points: Point2D[];
}

export interface DomainBounds {
  min: number;
  max: number;
}

// ── Horizon data ──────────────────────────────────────────────────────────────

/**
 * Deposition operator — mirrors pyenthu/dlis geostore conventions.
 * 'none' = conformable deposit (default).
 */
export type HorizonOperator = 'none' | 'RA' | 'RAI' | 'RB' | 'RBI';

/** Plain serialisable horizon record (JSON shape) */
export interface HorizonData {
  id: string;
  name: string;
  colour: string;
  operator: HorizonOperator;
  visible: boolean;
  points: Point2D[];
  rails: Rail[];
}

// ── NURBS surface ─────────────────────────────────────────────────────────────

export interface NurbsSurfaceParams {
  /** Flat array of [x,y,z] control points, nCtrlV rows × nCtrlU cols */
  controlPoints: number[][];
  nCtrlU: number;
  nCtrlV: number;
  uKnots: number[];
  vKnots: number[];
  degreeU: number;
  degreeV: number;
  /** Evaluation grid size (resolution × resolution quads) */
  resolution: number;
}

export interface NurbsEvalResult {
  /** Flat Float32Array of (resolution+1)² × 3 world-space positions */
  positions: Float32Array;
  /** Triangle index buffer */
  indices: Uint32Array;
  resolution: number;
}

// ── World coordinate helpers ──────────────────────────────────────────────────

export interface WorldDimensions {
  /** World-space horizontal extent */
  WX: number;
  /** World-space depth extent */
  WY: number;
  /** World-space along-strike extent (derived from strikeKm) */
  strikeW: number;
}
