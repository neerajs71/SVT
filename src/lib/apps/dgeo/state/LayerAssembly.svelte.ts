/**
 * LayerAssembly.svelte.ts
 *
 * Represents ONE geological layer — the band between two adjacent sorted
 * horizons.  Each assembly owns its own build state for both solid types:
 *
 *   gridSolid  — cube-warp approach via buildSolidManifold()
 *   nurbsSolid — ear-clip direct approach via buildNurbsSolidDirect()
 *
 * Assembly is created by GeologicalModel, one per horizon in the sorted stack
 * (index 0 = deepest / basement).  The horizon referenced is the UPPER
 * (shallower) boundary of the layer.
 */

import * as THREE from 'three';

// ── Manifold mesh → Three.js BufferGeometry ───────────────────────────────────
function manifoldMeshToGeo(mesh: { vertProperties: ArrayLike<number>; numProp: number; triVerts: ArrayLike<number> }): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), mesh.numProp));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geo.computeVertexNormals();
  return geo;
}

// ── LayerAssembly ─────────────────────────────────────────────────────────────
export class LayerAssembly {
  /** ID of the upper (shallower) horizon of this layer */
  readonly horizonId: string;
  readonly color:     string;
  readonly name:      string;

  // ── Grid solid (cube-warp / buildSolidManifold) ───────────────────────────
  gridGeo:  THREE.BufferGeometry | null = $state(null);

  // ── NURBS solid (ear-clip direct / buildNurbsSolidDirect) ─────────────────
  nurbsGeo: THREE.BufferGeometry | null = $state(null);

  constructor(horizonId: string, color: string, name: string) {
    this.horizonId = horizonId;
    this.color     = color;
    this.name      = name;
  }

  // ── Grid solid build ──────────────────────────────────────────────────────

  async buildGrid(mfShallow: unknown, mfDeep: unknown | null): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shallow = mfShallow as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deep    = mfDeep    as any;

      let result = shallow;
      if (deep) {
        result = shallow.subtract(deep);
        const st = result.status();
        if (st !== 'NoError') throw new Error(`CSG status: ${st}`);
      }

      const mesh = result.getMesh();
      if (!mesh || mesh.triVerts.length === 0) throw new Error('empty mesh');

      this.gridGeo?.dispose();
      this.gridGeo = manifoldMeshToGeo(mesh);
      console.log(`[LayerAssembly] ${this.name} grid vol=${result.volume().toFixed(2)}`);
    } catch (e: unknown) {
      console.warn(`[LayerAssembly] ${this.name} grid build failed:`, e instanceof Error ? e.message : e);
    }
  }

  // ── NURBS solid build ─────────────────────────────────────────────────────

  async buildNurbs(mfShallow: unknown, mfDeep: unknown | null): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shallow = mfShallow as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deep    = mfDeep    as any;

      let result = shallow;
      if (deep) {
        result = shallow.subtract(deep);
        const st = result.status();
        if (st !== 'NoError') throw new Error(`CSG status: ${st}`);
      }

      const mesh = result.getMesh();
      if (!mesh || mesh.triVerts.length === 0) throw new Error('empty mesh');

      this.nurbsGeo?.dispose();
      this.nurbsGeo = manifoldMeshToGeo(mesh);
      console.log(`[LayerAssembly] ${this.name} nurbs vol=${result.volume().toFixed(2)}`);
    } catch (e: unknown) {
      console.warn(`[LayerAssembly] ${this.name} nurbs build failed:`, e instanceof Error ? e.message : e);
    }
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.gridGeo?.dispose();
    this.nurbsGeo?.dispose();
    this.gridGeo  = null;
    this.nurbsGeo = null;
  }
}
