<script>
  import { extractLasCurve } from '../parser.js';
  import { extractCurveData } from '$lib/apps/dlis/utils.js';

  const { tpl, slotFiles } = $props();

  // ── Curve helper ────────────────────────────────────────────────────────
  function getSlotCurve(slotKey, mnemonic) {
    const slot = slotFiles?.[slotKey];
    if (!slot || !mnemonic) return null;
    if (slot.las) {
      const cd = extractLasCurve(slot.las, mnemonic);
      return cd ? { depths: cd.depths, values: cd.values } : null;
    }
    if (slot.dlis) {
      const cd = extractCurveData(slot.dlis, mnemonic);
      return cd ? { depths: cd.xs, values: cd.ys } : null;
    }
    return null;
  }

  // ── Available curves per slot ────────────────────────────────────────────
  const slotCurveOptions = $derived.by(() => {
    if (!slotFiles) return {};
    const result = {};
    for (const [slotKey, slot] of Object.entries(slotFiles)) {
      if (!slot) continue;
      const curves = [];
      if (slot.las?.curves) {
        for (const c of slot.las.curves) {
          if (!c.isIndex) curves.push(c.mnem);
        }
      } else if (slot.dlis) {
        // Extract channel names from DLIS parse result
        for (const lf of slot.dlis?.logicalFiles ?? []) {
          for (const eflr of lf.eflrList ?? []) {
            if (eflr.setType?.trim().toUpperCase() === 'CHANNEL') {
              for (const obj of eflr.objects ?? []) {
                const name = obj.name?.identifier ?? obj.ObName?.identifier ?? '';
                if (name) curves.push(name);
              }
            }
          }
        }
      }
      result[slotKey] = curves;
    }
    return result;
  });

  const slots = $derived(Object.keys(slotFiles ?? {}));

  // ── Parameters ───────────────────────────────────────────────────────────
  let porSlot   = $state(slots[0] ?? 'F1');
  let porCurve  = $state('NPHI');
  let porUnits  = $state('pu');   // 'pu' (0-100) | 'frac' (0-1)
  let resCurve  = $state('ILD');
  let resSlot   = $state(slots[0] ?? 'F1');
  let rw        = $state(0.05);
  let a         = $state(1.0);
  let m         = $state(2.0);
  let n         = $state(2.0);
  let swResult  = $state(null);  // { depths, sw }
  let calcError = $state('');

  // ── Archie calculation ───────────────────────────────────────────────────
  function calculate() {
    calcError = '';
    swResult  = null;

    const porData = getSlotCurve(porSlot, porCurve);
    const resData = getSlotCurve(resSlot, resCurve);
    if (!porData) { calcError = `Porosity curve "${porCurve}" not found in ${porSlot}`; return; }
    if (!resData) { calcError = `Resistivity curve "${resCurve}" not found in ${resSlot}`; return; }

    // Merge on nearest-depth basis (simple index join on sorted depths)
    const porMap = new Map(porData.depths.map((d, i) => [d, porData.values[i]]));
    const depths = [], sw = [];
    for (let i = 0; i < resData.depths.length; i++) {
      const d  = resData.depths[i];
      const Rt = resData.values[i];
      let phi = porMap.get(d) ?? null;
      if (phi === null || !isFinite(phi) || !isFinite(Rt) || Rt <= 0) continue;
      if (porUnits === 'pu') phi = phi / 100;
      if (phi <= 0) continue;

      // Sw^n = (a * Rw) / (phi^m * Rt)
      const swVal = Math.pow((a * rw) / (Math.pow(phi, m) * Rt), 1 / n);
      depths.push(d);
      sw.push(Math.max(0, Math.min(1, swVal)));
    }

    if (!depths.length) { calcError = 'No overlapping depths between the two curves.'; return; }
    swResult = { depths, sw };
  }

  // ── Chart constants ──────────────────────────────────────────────────────
  const CHART_W  = 200;
  const CHART_H  = 500;
  const HEADER_H = 40;
  const MARGIN_L = 40;

  const dMin = $derived(tpl?.depth?.visibleMin ?? tpl?.depth?.min ?? 0);
  const dMax = $derived(tpl?.depth?.visibleMax ?? tpl?.depth?.max ?? 5000);
  function sy(d) { return HEADER_H + ((d - dMin) / ((dMax - dMin) || 1)) * CHART_H; }
  function sx(v) { return MARGIN_L + v * CHART_W; }

  const swPolyline = $derived.by(() => {
    if (!swResult) return '';
    const pts = [];
    for (let i = 0; i < swResult.depths.length; i++) {
      const d = swResult.depths[i];
      if (d < dMin || d > dMax) continue;
      pts.push(`${sx(swResult.sw[i]).toFixed(1)},${sy(d).toFixed(1)}`);
    }
    return pts.join(' ');
  });

  const depthTicks = $derived.by(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d = dMin + (i / 5) * (dMax - dMin);
      return { d, py: sy(d), label: Math.round(d) };
    })
  );
</script>

<div class="flex h-full overflow-hidden">

  <!-- Left: parameters -->
  <div class="w-64 flex-shrink-0 border-r border-gray-200 overflow-y-auto p-3 flex flex-col gap-3 bg-gray-50">

    <div>
      <h3 class="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">Archie's Formula</h3>
      <p class="text-[0.65rem] text-gray-400 font-mono">Sw = [(a·Rw) / (φ<sup>m</sup>·Rt)]<sup>1/n</sup></p>
    </div>

    <!-- Porosity -->
    <div class="border border-gray-200 rounded p-2 bg-white">
      <p class="text-[0.65rem] font-semibold text-gray-500 uppercase mb-1.5">Porosity (φ)</p>
      <div class="grid grid-cols-2 gap-1.5 mb-1.5">
        <div>
          <label class="block text-[0.6rem] text-gray-400 mb-0.5">Slot</label>
          <select bind:value={porSlot} class="w-full text-xs border border-gray-200 rounded px-1 py-0.5">
            {#each slots as s}<option value={s}>{s}</option>{/each}
          </select>
        </div>
        <div>
          <label class="block text-[0.6rem] text-gray-400 mb-0.5">Curve</label>
          <input type="text" bind:value={porCurve} list="por-curves"
            class="w-full text-xs border border-gray-200 rounded px-1 py-0.5 uppercase"/>
          <datalist id="por-curves">
            {#each slotCurveOptions[porSlot] ?? [] as c}<option value={c}>{c}</option>{/each}
          </datalist>
        </div>
      </div>
      <!-- Units toggle -->
      <div>
        <label class="block text-[0.6rem] text-gray-400 mb-0.5">Units</label>
        <div class="flex rounded overflow-hidden border border-gray-200 text-[0.65rem] font-medium">
          <button
            onclick={() => porUnits = 'pu'}
            class="flex-1 py-0.5 text-center transition-colors
                   {porUnits === 'pu' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}">
            PU (0–100)
          </button>
          <button
            onclick={() => porUnits = 'frac'}
            class="flex-1 py-0.5 text-center border-l border-gray-200 transition-colors
                   {porUnits === 'frac' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}">
            Fraction
          </button>
        </div>
      </div>
    </div>

    <!-- Resistivity -->
    <div class="border border-gray-200 rounded p-2 bg-white">
      <p class="text-[0.65rem] font-semibold text-gray-500 uppercase mb-1.5">Resistivity (Rt)</p>
      <div class="grid grid-cols-2 gap-1.5">
        <div>
          <label class="block text-[0.6rem] text-gray-400 mb-0.5">Slot</label>
          <select bind:value={resSlot} class="w-full text-xs border border-gray-200 rounded px-1 py-0.5">
            {#each slots as s}<option value={s}>{s}</option>{/each}
          </select>
        </div>
        <div>
          <label class="block text-[0.6rem] text-gray-400 mb-0.5">Curve</label>
          <input type="text" bind:value={resCurve} list="res-curves"
            class="w-full text-xs border border-gray-200 rounded px-1 py-0.5 uppercase"/>
          <datalist id="res-curves">
            {#each slotCurveOptions[resSlot] ?? [] as c}<option value={c}>{c}</option>{/each}
          </datalist>
        </div>
      </div>
    </div>

    <!-- Parameters -->
    <div class="border border-gray-200 rounded p-2 bg-white">
      <p class="text-[0.65rem] font-semibold text-gray-500 uppercase mb-1.5">Parameters</p>
      <div class="grid grid-cols-2 gap-1.5">
        {#each [['Rw (ohm·m)', rw, v => rw = v], ['a', a, v => a = v], ['m', m, v => m = v], ['n', n, v => n = v]] as [lbl, val, set]}
          <div>
            <label class="block text-[0.6rem] text-gray-400 mb-0.5">{lbl}</label>
            <input type="number" step="0.01" value={val}
              oninput={e => set(parseFloat(e.target.value) || 0)}
              class="w-full text-xs border border-gray-200 rounded px-1 py-0.5"/>
          </div>
        {/each}
      </div>
    </div>

    <button onclick={calculate}
      class="w-full text-xs bg-blue-600 text-white rounded px-3 py-2 hover:bg-blue-700 font-medium">
      Calculate Sw
    </button>

    {#if calcError}
      <p class="text-xs text-red-500 bg-red-50 rounded p-1.5">{calcError}</p>
    {/if}

    {#if swResult}
      <div class="text-xs text-gray-500 bg-green-50 rounded p-1.5 border border-green-200">
        ✓ {swResult.depths.length} depth points computed
      </div>
    {/if}
  </div>

  <!-- Right: Sw depth track -->
  <div class="flex-1 overflow-auto bg-white">
    {#if !swResult}
      <div class="h-full flex items-center justify-center text-gray-400 text-xs select-none text-center px-8">
        Select porosity and resistivity curves,<br>then click Calculate Sw
      </div>
    {:else}
      <svg width={MARGIN_L + CHART_W + 20} height={HEADER_H + CHART_H + 20}
        style="display:block; font-family:sans-serif">

        <!-- Background -->
        <rect x={MARGIN_L} y={HEADER_H} width={CHART_W} height={CHART_H} fill="#f8fafc"/>

        <!-- Header -->
        <text x={MARGIN_L + CHART_W/2} y="16" text-anchor="middle" font-size="11" font-weight="bold" fill="#374151">Sw</text>
        <text x={MARGIN_L + CHART_W/2} y="28" text-anchor="middle" font-size="9" fill="#6b7280">Archie</text>

        <!-- X-axis labels 0–1 -->
        {#each [0, 0.25, 0.5, 0.75, 1.0] as v}
          <line x1={sx(v)} y1={HEADER_H} x2={sx(v)} y2={HEADER_H + CHART_H} stroke="#e5e7eb" stroke-width="1"/>
          <text x={sx(v)} y={HEADER_H - 4} text-anchor="middle" font-size="8" fill="#9ca3af">{v}</text>
        {/each}

        <!-- Depth ticks -->
        {#each depthTicks as t}
          <line x1={MARGIN_L - 4} y1={t.py} x2={MARGIN_L + CHART_W} y2={t.py} stroke="#e5e7eb" stroke-width="0.5"/>
          <text x={MARGIN_L - 6} y={t.py + 3} text-anchor="end" font-size="8" fill="#6b7280">{t.label}</text>
        {/each}

        <!-- Sw curve -->
        {#if swPolyline}
          <polyline points={swPolyline} fill="none" stroke="#2563eb" stroke-width="1.5" opacity="0.9"/>
        {/if}

        <!-- 0.5 Sw marker -->
        <line x1={sx(0.5)} y1={HEADER_H} x2={sx(0.5)} y2={HEADER_H + CHART_H}
          stroke="#dc2626" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>
      </svg>
    {/if}
  </div>
</div>
