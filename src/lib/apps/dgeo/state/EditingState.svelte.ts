/**
 * EditingState.svelte.ts
 *
 * Tracks drag state for control-point manipulation in the 3D viewport.
 * Selection (editHorizonId, editRailIdx) is managed as $bindable props
 * in Dgeo3DScene/Dgeo3DView so the parent can react to changes.
 */

export class EditingState {
  /** True while a control point is being dragged in the 3D viewport */
  isDragging: boolean = $state(false);

  /** Index of the control point currently being dragged */
  dragPointIdx: number | null = $state(null);

  startDrag(pointIdx: number): void {
    this.isDragging   = true;
    this.dragPointIdx = pointIdx;
  }

  endDrag(): void {
    this.isDragging   = false;
    this.dragPointIdx = null;
  }
}
