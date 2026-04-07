/**
 * LayerAssembly.svelte.ts
 *
 * Represents ONE geological layer in the depositional stack.
 * Each assembly stores the final display geometry — after all CSG has been
 * done by GeologicalModel — as a list of BufferGeometry objects.
 *
 * There is normally one geometry per layer, but a subtraction may produce
 * multiple disconnected bodies (e.g. a pinch-out), each stored separately.
 * All bodies share the same material colour.
 *
 * GeologicalModel calls setGridGeos() / setNurbsGeos() to push new geometry;
 * this class only owns disposal and reactive state.
 */

import * as THREE from 'three';

// ── LayerAssembly ─────────────────────────────────────────────────────────────
export class LayerAssembly {
  /** ID of the horizon that defines the top of this layer */
  readonly horizonId: string;
  readonly color:     string;
  readonly name:      string;

  // ── Grid solid (cube-warp / buildSolidManifold) ───────────────────────────
  gridGeos:  THREE.BufferGeometry[] = $state([]);

  // ── NURBS solid (ear-clip direct / buildNurbsSolidDirect) ─────────────────
  nurbsGeos: THREE.BufferGeometry[] = $state([]);

  constructor(horizonId: string, color: string, name: string) {
    this.horizonId = horizonId;
    this.color     = color;
    this.name      = name;
  }

  // ── Setters (called by GeologicalModel after CSG + decompose) ─────────────

  setGridGeos(geos: THREE.BufferGeometry[]): void {
    this.gridGeos.forEach(g => g.dispose());
    this.gridGeos = geos;
  }

  setNurbsGeos(geos: THREE.BufferGeometry[]): void {
    this.nurbsGeos.forEach(g => g.dispose());
    this.nurbsGeos = geos;
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.gridGeos.forEach(g => g.dispose());
    this.nurbsGeos.forEach(g => g.dispose());
    this.gridGeos  = [];
    this.nurbsGeos = [];
  }
}
