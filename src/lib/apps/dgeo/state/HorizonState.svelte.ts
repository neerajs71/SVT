/**
 * HorizonState.svelte.ts
 *
 * Reactive class for a single geological horizon.
 * Uses Svelte 5 runes ($state) so components automatically re-render
 * when name, colour, points, or rails change.
 *
 * Non-reactive fields (nurbsPositions, nurbsDirty) are plain TS properties —
 * they are managed by NurbsEvaluatorChain and do not need to drive renders.
 */

import type {
  HorizonData,
  HorizonOperator,
  Point2D,
  Rail,
} from '../types.ts';

export class HorizonState {
  // ── Reactive fields (drive UI) ────────────────────────────────────────────
  id:       string          = $state('');
  name:     string          = $state('Horizon');
  colour:   string          = $state('#888888');
  operator: HorizonOperator = $state('RA');
  visible:  boolean         = $state(true);

  /** 2D cross-section control points (x = distance, y = depth) */
  points: Point2D[] = $state([]);

  /** Along-strike rails — each rail is a {z, points[]} pair */
  rails: Rail[] = $state([]);

  // ── Non-reactive NURBS cache (managed by NurbsEvaluatorChain) ────────────
  nurbsPositions:  Float32Array | null = null;
  nurbsResolution: number                    = 40;
  /**
   * Set to true whenever rails change; cleared by NurbsEvaluatorChain after
   * a successful evaluation.  Not reactive — the evaluator polls this flag.
   */
  nurbsDirty: boolean = true;

  // ─────────────────────────────────────────────────────────────────────────
  constructor(data: HorizonData) {
    this.id       = data.id;
    this.name     = data.name;
    this.colour   = data.colour;
    this.operator = data.operator;
    this.visible  = data.visible ?? true;
    this.points   = data.points  ?? [];
    this.rails    = data.rails   ?? [];
  }

  // ── Computed helpers ──────────────────────────────────────────────────────

  /** Average depth (y) across all rail points — used for horizon sorting */
  get avgDepth(): number {
    let sum = 0, count = 0;
    for (const rail of this.rails) {
      for (const p of rail.points) { sum += p.y; count++; }
    }
    // Fall back to 2D points if no rails defined
    if (count === 0) {
      for (const p of this.points) { sum += p.y; count++; }
    }
    return count > 0 ? sum / count : 0;
  }

  // ── Rail mutations ────────────────────────────────────────────────────────

  /** Replace the points of the rail at sorted index `idx` */
  updateRail(idx: number, points: Point2D[]): void {
    const next = [...this.rails];
    next[idx] = { ...next[idx], points };
    this.rails    = next;
    this.nurbsDirty = true;
  }

  /** Add a new rail (keeps array unsorted — caller should sort by z) */
  addRail(rail: Rail): void {
    this.rails    = [...this.rails, rail];
    this.nurbsDirty = true;
  }

  /** Remove rail at given index */
  removeRail(idx: number): void {
    const next = [...this.rails];
    next.splice(idx, 1);
    this.rails    = next;
    this.nurbsDirty = true;
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  toJSON(): HorizonData {
    return {
      id:       this.id,
      name:     this.name,
      colour:   this.colour,
      operator: this.operator,
      visible:  this.visible,
      points:   this.points,
      rails:    this.rails,
    };
  }

  static fromJSON(data: HorizonData): HorizonState {
    return new HorizonState(data);
  }
}
