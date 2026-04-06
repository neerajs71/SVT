/**
 * NurbsEvaluatorChain.svelte.ts
 *
 * Manages the WebGPU → WebGL GPGPU → CPU evaluator priority chain.
 *
 * - `ready` is a reactive $state boolean so components can react to WebGPU
 *   becoming available and trigger re-evaluation.
 * - Evaluation methods are synchronous when WebGPU is not ready; WebGPU
 *   evaluation is always async.
 */

import type { NurbsSurfaceParams, NurbsEvalResult } from '../types.ts';
import { NurbsCpu }   from '../nurbs/nurbsCpu.ts';
import { NurbsGpgpu } from '../nurbs/nurbsGpgpu.ts';
import { NurbsWebGpu } from '../nurbs/nurbsWebGpu.ts';

export class NurbsEvaluatorChain {
  /** True once WebGPU device is initialised — reactive so effects re-run */
  ready: boolean = $state(false);

  private readonly cpu:    NurbsCpu;
  private          gpgpu:  NurbsGpgpu | null = null;
  private          webgpu: NurbsWebGpu | null = null;

  /**
   * @param renderer — THREE.WebGLRenderer, used by GPGPU evaluator.
   *                   Pass null to fall back directly to CPU.
   */
  constructor(renderer: unknown) {
    this.cpu = new NurbsCpu(40);

    try {
      this.gpgpu = new NurbsGpgpu(renderer as any, 40);
    } catch (e) {
      console.warn('[NurbsEvaluatorChain] WebGL GPGPU unavailable, using CPU fallback', e);
    }

    // WebGPU — async; set `ready` once the device resolves
    NurbsWebGpu.create(40)
      .then((g: NurbsWebGpu) => { this.webgpu = g; this.ready = true; })
      .catch((e: unknown) => console.warn('[NurbsEvaluatorChain] WebGPU unavailable:', e));
  }

  /**
   * Evaluate a NURBS surface.
   * Uses the best available evaluator in priority order:
   *   WebGPU (if ready) → WebGL GPGPU → CPU
   */
  async evaluate(params: NurbsSurfaceParams): Promise<NurbsEvalResult> {
    if (this.webgpu) {
      return this.webgpu.evaluate(params as any) as Promise<NurbsEvalResult>;
    }
    if (this.gpgpu) {
      return this.gpgpu.evaluate(params as any) as NurbsEvalResult;
    }
    return this.cpu.evaluate(params as any) as NurbsEvalResult;
  }

  destroy(): void {
    this.gpgpu?.dispose();
    this.webgpu?.destroy();
    this.gpgpu  = null;
    this.webgpu = null;
  }
}
