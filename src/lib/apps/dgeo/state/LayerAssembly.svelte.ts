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
import type { WorldDimensions, CoordMappers, Rail, Point2D } from '../types.ts';

// ── Manifold mesh → Three.js BufferGeometry ───────────────────────────────────
function manifoldMeshToGeo(mesh: { vertProperties: ArrayLike<number>; numProp: number; triVerts: ArrayLike<number> }): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), mesh.numProp));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geo.computeVertexNormals();
  return geo;
}

// ── Build options passed down from GeologicalModel ────────────────────────────
export interface GridBuildOptions extends WorldDimensions {
  domX: { min: number; max: number };
  sampleArcLength: (pts: Point2D[], n: number) => Point2D[];
  nX: (x: number) => number;
  nDepth: (y: number) => number;
  nXsamp?: number;
  refineN?: number;
}

export interface NurbsBuildOptions extends WorldDimensions {
  // WX, WY, strikeW inherited from WorldDimensions
}

// ── LayerAssembly ─────────────────────────────────────────────────────────────
export class LayerAssembly {
  /** ID of the upper (shallower) horizon of this layer */
  readonly horizonId: string;
  readonly color:     string;
  readonly name:      string;

  // ── Grid solid (cube-warp / buildSolidManifold) ───────────────────────────
  gridGeo:      THREE.BufferGeometry | null = $state(null);
  gridBuilding: boolean                     = $state(false);
  gridError:    string | null               = $state(null);
  gridStatus:   'idle' | 'building' | 'ready' | 'error' = $state('idle');

  // ── NURBS solid (ear-clip direct / buildNurbsSolidDirect) ─────────────────
  nurbsGeo:      THREE.BufferGeometry | null = $state(null);
  nurbsBuilding: boolean                     = $state(false);
  nurbsError:    string | null               = $state(null);
  nurbsStatus:   'idle' | 'building' | 'ready' | 'error' = $state('idle');

  constructor(horizonId: string, color: string, name: string) {
    this.horizonId = horizonId;
    this.color     = color;
    this.name      = name;
  }

  // ── Grid solid build ──────────────────────────────────────────────────────

  /**
   * Build the grid (cube-warp) solid for this layer.
   * `mfShallow` and `mfDeep` are already-built Manifold objects for the
   * shallower and deeper bounding horizons respectively.
   * For the deepest layer (index 0), `mfDeep` is null — solid = mfShallow.
   */
  async buildGrid(
    mfShallow: unknown,
    mfDeep: unknown | null,
  ): Promise<void> {
    this.gridBuilding = true;
    this.gridStatus   = 'building';
    this.gridError    = null;
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
      this.gridGeo    = manifoldMeshToGeo(mesh);
      this.gridStatus = 'ready';

      console.log(`[LayerAssembly] ${this.name} grid vol=${result.volume().toFixed(2)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.gridError  = msg;
      this.gridStatus = 'error';
      console.warn(`[LayerAssembly] ${this.name} grid build failed: ${msg}`);
    } finally {
      this.gridBuilding = false;
    }
  }

  // ── NURBS solid build ─────────────────────────────────────────────────────

  /**
   * Build the NURBS (ear-clip direct) solid for this layer.
   * `mfShallow` and `mfDeep` are Manifold objects built from NURBS positions.
   */
  async buildNurbs(
    mfShallow: unknown,
    mfDeep: unknown | null,
  ): Promise<void> {
    this.nurbsBuilding = true;
    this.nurbsStatus   = 'building';
    this.nurbsError    = null;
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
      this.nurbsGeo    = manifoldMeshToGeo(mesh);
      this.nurbsStatus = 'ready';

      console.log(`[LayerAssembly] ${this.name} nurbs vol=${result.volume().toFixed(2)}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.nurbsError  = msg;
      this.nurbsStatus = 'error';
      console.warn(`[LayerAssembly] ${this.name} nurbs build failed: ${msg}`);
    } finally {
      this.nurbsBuilding = false;
    }
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.gridGeo?.dispose();
    this.nurbsGeo?.dispose();
    this.gridGeo  = null;
    this.nurbsGeo = null;
    this.gridStatus  = 'idle';
    this.nurbsStatus = 'idle';
  }
}
