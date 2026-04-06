/**
 * EditingState.svelte.ts
 *
 * Tracks which horizon/rail is currently being edited in the 3D view,
 * and manages the drag state for control-point manipulation.
 *
 * Extracted from Dgeo3DScene.svelte so the 3D scene template can remain
 * a thin render-only component.
 */

import type { Point2D } from '../types.ts';

export class EditingState {
  /** ID of the horizon currently open in the rail editor, or null */
  editHorizonId: string | null = $state(null);

  /** Index into the horizon's sorted rail array being edited, or null */
  editRailIdx: number | null = $state(null);

  /** True while a control point is being dragged in the 3D viewport */
  isDragging: boolean = $state(false);

  /** Index of the control point currently being dragged */
  dragPointIdx: number | null = $state(null);

  // ── Selection ─────────────────────────────────────────────────────────────

  select(horizonId: string, railIdx: number): void {
    this.editHorizonId = horizonId;
    this.editRailIdx   = railIdx;
  }

  clearSelection(): void {
    this.editHorizonId = null;
    this.editRailIdx   = null;
    this.endDrag();
  }

  // ── Drag ──────────────────────────────────────────────────────────────────

  startDrag(pointIdx: number): void {
    this.isDragging   = true;
    this.dragPointIdx = pointIdx;
  }

  endDrag(): void {
    this.isDragging   = false;
    this.dragPointIdx = null;
  }

  // ── Guards ────────────────────────────────────────────────────────────────

  get isEditing(): boolean {
    return this.editHorizonId !== null;
  }

  get isEditingHorizon(): (horizonId: string) => boolean {
    return (horizonId: string) => this.editHorizonId === horizonId;
  }
}
