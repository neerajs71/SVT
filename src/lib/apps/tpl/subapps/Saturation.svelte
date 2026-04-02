<script>
  import { extractLasCurve } from '../parser.js';
  import { extractCurveData } from '$lib/apps/dlis/utils.js';

  const { tpl, slotFiles } = $props();

  // ── Models ────────────────────────────────────────────────────────────────
  const MODELS = [
    { id: 'archie',     label: 'Archie',     shalyInputs: false,
      formula: 'Sw = [(a·Rw) / (φᵐ·Rt)]^(1/n)' },
    { id: 'simandoux',  label: 'Simandoux',  shalyInputs: true,
      formula: 'Sw²·φᵐ/(a·Rw) + Sw·Vcl/Rcl = 1/Rt' },
    { id: 'indonesian', label: 'Indonesian', shalyInputs: true,
      formula: '1/√Rt = [φ^(m/2)/√(a·Rw) + Vcl^(1−Vcl/2)/√Rcl]·Sw^(n/2)' },
  ];

  const VCL_FORMULAS = {
    linear:        'Vcl = IGR',
    larionov_old:  'Vcl = 0.33·(2^(2·IGR) − 1)',
    larionov_ter:  'Vcl = 0.083·(2^(3.7·IGR) − 1)',
    clavier:       'Vcl = 1.7 − √(3.38 − (IGR+0.7)²)',
    steiber:       'Vcl = IGR / (3 − 2·IGR)',
  };
  let modelId = $state('archie');
  const model = $derived(MODELS.find(m => m.id === modelId));

  // ── Vclay methods ─────────────────────────────────────────────────────────
  const VCL_METHODS = [
    { id: 'linear',        label: 'Linear' },
    { id: 'larionov_old',  label: 'Larionov — Older rocks' },
    { id: 'larionov_ter',  label: 'Larionov — Tertiary' },
    { id: 'clavier',       label: 'Clavier' },
    { id: 'steiber',       label: 'Steiber' },
  ];

  // ── Curve helper ──────────────────────────────────────────────────────────
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

  const slotCurveOptions = $derived.by(() => {
    if (!slotFiles) return {};
    const result = {};
    for (const [slotKey, slot] of Object.entries(slotFiles)) {
      if (!slot) continue;
      const curves = [];
      if (slot.las?.curves) {
        for (const c of slot.las.curves) { if (!c.isIndex) curves.push(c.mnem); }
      } else if (slot.dlis) {
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

  // ── Panel tab (shaly models only) ─────────────────────────────────────────
  let activePanel = $state('vclay');  // 'vclay' | 'sw'

  // ── Stage 1 — Vclay inputs ────────────────────────────────────────────────
  let grSlot    = $state(slots[0] ?? 'F1');
  let grCurve   = $state('GR');
  let grMin     = $state(10);
  let grMax     = $state(140);
  let vclMethod = $state('linear');

  // ── Stage 2 — Sw inputs ───────────────────────────────────────────────────
  let porSlot  = $state(slots[0] ?? 'F1');
  let porCurve = $state('NPHI');
  let porUnits = $state('pu');
  let resSlot  = $state(slots[0] ?? 'F1');
  let resCurve = $state('ILD');
  let rclMode  = $state('const');
  let rcl      = $state(4.0);
  let rclSlot  = $state(slots[0] ?? 'F1');
  let rclCurve = $state('RCL');
  let rw = $state(0.05);
  let a  = $state(1.0);
  let m  = $state(2.0);
  let n  = $state(2.0);

  // ── Results ───────────────────────────────────────────────────────────────
  let swResult  = $state(null);
  let calcError = $state('');
  let vclStats  = $state(null);  // { min, max, mean, count } shown after calc

  // ── Helpers ───────────────────────────────────────────────────────────────
  function phiOf(v) { return porUnits === 'pu' ? v / 100 : v; }

  function calcVclOf(grVal) {
    const igr = Math.max(0, Math.min(1, (grVal - grMin) / ((grMax - grMin) || 1)));
    switch (vclMethod) {
      case 'larionov_old': return Math.max(0, 0.33 * (Math.pow(2, 2 * igr) - 1));
      case 'larionov_ter': return Math.max(0, 0.083 * (Math.pow(2, 3.7 * igr) - 1));
      case 'clavier':      return Math.max(0, Math.min(1, 1.7 - Math.sqrt(3.38 - Math.pow(igr + 0.7, 2))));
      case 'steiber':      return igr / (3 - 2 * igr);
      default:             return igr;
    }
  }

  // ── Calculate ─────────────────────────────────────────────────────────────
  function calculate() {
    calcError = '';
    swResult  = null;
    vclStats  = null;

    const porData = getSlotCurve(porSlot, porCurve);
    const resData = getSlotCurve(resSlot, resCurve);
    if (!porData) { calcError = `Porosity curve "${porCurve}" not found in ${porSlot}`; return; }
    if (!resData) { calcError = `Resistivity curve "${resCurve}" not found in ${resSlot}`; return; }

    // Stage 1: Vclay array (shaly models only)
    let vclMap = null, rclData = null;
    let vclTrackDepths = [], vclTrackValues = [];
    if (model?.shalyInputs) {
      const grData = getSlotCurve(grSlot, grCurve);
      if (!grData) { calcError = `GR curve "${grCurve}" not found in ${grSlot}`; return; }
      vclMap = new Map(grData.depths.map((d, i) => [d, calcVclOf(grData.values[i])]));
      // Store full Vclay track for plotting
      vclTrackDepths = grData.depths;
      vclTrackValues = grData.depths.map((_, i) => calcVclOf(grData.values[i]));

      // Stats for display
      const vclArr = vclTrackValues.filter(v => isFinite(v));
      if (vclArr.length) {
        const sum = vclArr.reduce((s, v) => s + v, 0);
        vclStats = {
          min: Math.min(...vclArr).toFixed(3),
          max: Math.max(...vclArr).toFixed(3),
          mean: (sum / vclArr.length).toFixed(3),
          count: vclArr.length,
        };
      }

      if (rclMode === 'curve') {
        rclData = getSlotCurve(rclSlot, rclCurve);
        if (!rclData) { calcError = `Rcl curve "${rclCurve}" not found in ${rclSlot}`; return; }
      }
    }

    // Stage 2: Sw
    const porMap = new Map(porData.depths.map((d, i) => [d, porData.values[i]]));
    const rclMap = rclData ? new Map(rclData.depths.map((d, i) => [d, rclData.values[i]])) : null;

    const depths = [], sw = [];

    for (let i = 0; i < resData.depths.length; i++) {
      const d  = resData.depths[i];
      const Rt = resData.values[i];
      const rawPhi = porMap.get(d);
      if (rawPhi == null || !isFinite(rawPhi) || !isFinite(Rt) || Rt <= 0) continue;
      const phi = phiOf(rawPhi);
      if (phi <= 0) continue;

      let swVal;

      if (modelId === 'archie') {
        swVal = Math.pow((a * rw) / (Math.pow(phi, m) * Rt), 1 / n);

      } else {
        const Vcl = vclMap?.get(d);
        if (Vcl == null || !isFinite(Vcl)) continue;
        const Rcl = rclMode === 'curve' ? (rclMap?.get(d) ?? rcl) : rcl;
        if (!isFinite(Rcl) || Rcl <= 0) continue;

        if (modelId === 'simandoux') {
          const A = Math.pow(phi, m) / (a * rw);
          const B = Vcl / Rcl;
          const C = 1 / Rt;
          swVal = (-B + Math.sqrt(B * B + 4 * A * C)) / (2 * A);
        } else {
          // Indonesian
          const termPor = Math.pow(phi, m / 2) / Math.sqrt(a * rw);
          const termCl  = Math.pow(Math.max(Vcl, 1e-9), 1 - Vcl / 2) / Math.sqrt(Rcl);
          const denom   = termPor + termCl;
          if (denom <= 0) continue;
          swVal = Math.pow(1 / (Math.sqrt(Rt) * denom), 2 / n);
        }
      }

      if (!isFinite(swVal)) continue;
      depths.push(d);
      sw.push(Math.max(0, Math.min(1, swVal)));
    }

    if (!depths.length) { calcError = 'No overlapping depths between curves.'; return; }
    swResult = { depths, sw, vclDepths: vclTrackDepths, vcl: vclTrackValues };
  }

  // ── Chart ─────────────────────────────────────────────────────────────────
  const TRACK_W  = 160;   // width of each track
  const CHART_H  = 500;
  const HEADER_H = 50;
  const MARGIN_L = 40;
  const TRACK_GAP = 8;

  const dMin = $derived(tpl?.depth?.visibleMin ?? tpl?.depth?.min ?? 0);
  const dMax = $derived(tpl?.depth?.visibleMax ?? tpl?.depth?.max ?? 5000);
  function sy(d) { return HEADER_H + ((d - dMin) / ((dMax - dMin) || 1)) * CHART_H; }

  // Vclay track x-scale (left track)
  const VCL_X0 = $derived(MARGIN_L);
  function svx(v) { return VCL_X0 + v * TRACK_W; }

  // Sw track x-scale (right track, or left when no vcl)
  const SW_X0 = $derived(swResult?.vclDepths?.length ? MARGIN_L + TRACK_W + TRACK_GAP : MARGIN_L);
  function ssx(v) { return SW_X0 + v * TRACK_W; }

  const svgWidth = $derived(
    swResult?.vclDepths?.length
      ? MARGIN_L + TRACK_W + TRACK_GAP + TRACK_W + 20
      : MARGIN_L + TRACK_W + 20
  );

  const swPolyline = $derived.by(() => {
    if (!swResult) return '';
    return swResult.depths
      .map((d, i) => d < dMin || d > dMax ? null : `${ssx(swResult.sw[i]).toFixed(1)},${sy(d).toFixed(1)}`)
      .filter(Boolean).join(' ');
  });

  const vclPolyline = $derived.by(() => {
    if (!swResult?.vclDepths?.length) return '';
    return swResult.vclDepths
      .map((d, i) => d < dMin || d > dMax ? null : `${svx(Math.max(0, Math.min(1, swResult.vcl[i]))).toFixed(1)},${sy(d).toFixed(1)}`)
      .filter(Boolean).join(' ');
  });

  const depthTicks = $derived.by(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d = dMin + (i / 5) * (dMax - dMin);
      return { d, py: sy(d), label: Math.round(d) };
    })
  );
</script>

<div class="flex h-full overflow-hidden">

  <!-- ── Left panel ─────────────────────────────────────────────────────── -->
  <div class="w-72 flex-shrink-0 border-r border-gray-200 flex flex-col bg-gray-50">

    <!-- Model selector -->
    <div class="px-3 pt-3 pb-2 border-b border-gray-200">
      <label class="block text-[0.6rem] text-gray-400 uppercase tracking-wide mb-1">Model</label>
      <div class="flex gap-1 mb-1.5">
        {#each MODELS as mod}
          <button
            onclick={() => { modelId = mod.id; swResult = null; calcError = ''; vclStats = null; activePanel = mod.shalyInputs ? 'vclay' : 'vclay'; }}
            class="flex-1 text-[0.65rem] py-0.5 rounded border transition-colors
                   {modelId === mod.id
                     ? 'bg-blue-600 text-white border-blue-600'
                     : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}">
            {mod.label}
          </button>
        {/each}
      </div>
      <p class="text-[0.6rem] font-mono text-gray-500 leading-snug">{model?.formula}</p>
    </div>

    {#if model?.shalyInputs}
      <!-- ── Workflow diagram ───────────────────────────────────────────── -->
      <div class="px-3 py-2 border-b border-gray-200 bg-white">
        <div class="flex items-center gap-1 text-[0.6rem]">
          <!-- Stage 1 box -->
          <div class="flex flex-col items-center gap-0.5">
            <div class="text-[0.55rem] text-gray-400 uppercase tracking-wide">inputs</div>
            <div class="flex flex-col gap-0.5">
              <div class="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-700 font-mono font-medium">GR</div>
              <div class="px-1.5 py-0.5 rounded bg-green-100 border border-green-300 text-green-700 font-mono font-medium">φ</div>
              <div class="px-1.5 py-0.5 rounded bg-blue-100 border border-blue-300 text-blue-700 font-mono font-medium">Rt</div>
            </div>
          </div>

          <!-- Arrow + Stage 1 calc -->
          <div class="flex flex-col items-center">
            <div class="text-gray-300 text-base">→</div>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="text-[0.55rem] text-gray-400 uppercase tracking-wide">stage 1</div>
            <button
              onclick={() => activePanel = 'vclay'}
              class="px-2 py-1.5 rounded border text-center transition-colors leading-tight
                     {activePanel === 'vclay'
                       ? 'bg-amber-500 text-white border-amber-500'
                       : 'bg-white border-amber-300 text-amber-600 hover:bg-amber-50'}">
              <div class="font-semibold">Vclay</div>
              <div class="text-[0.55rem] opacity-80">{VCL_METHODS.find(v=>v.id===vclMethod)?.label.split(' ')[0]}</div>
            </button>
          </div>

          <!-- Arrow -->
          <div class="flex flex-col items-center">
            <div class="text-gray-300 text-base">→</div>
          </div>

          <!-- Stage 2 calc -->
          <div class="flex flex-col items-center gap-0.5">
            <div class="text-[0.55rem] text-gray-400 uppercase tracking-wide">stage 2</div>
            <button
              onclick={() => activePanel = 'sw'}
              class="px-2 py-1.5 rounded border text-center transition-colors leading-tight
                     {activePanel === 'sw'
                       ? 'bg-blue-600 text-white border-blue-600'
                       : 'bg-white border-blue-300 text-blue-600 hover:bg-blue-50'}">
              <div class="font-semibold">Sw</div>
              <div class="text-[0.55rem] opacity-80">{model.label}</div>
            </button>
          </div>

          <!-- Arrow + output -->
          <div class="flex flex-col items-center">
            <div class="text-gray-300 text-base">→</div>
          </div>
          <div class="flex flex-col items-center gap-0.5">
            <div class="text-[0.55rem] text-gray-400 uppercase tracking-wide">output</div>
            <div class="px-1.5 py-1 rounded bg-blue-600 text-white font-semibold text-[0.65rem]">Sw</div>
          </div>
        </div>

        {#if vclStats}
          <div class="mt-1.5 text-[0.6rem] text-gray-500 bg-amber-50 rounded px-2 py-1 border border-amber-200">
            Vclay — min: {vclStats.min} · max: {vclStats.max} · mean: {vclStats.mean} · n={vclStats.count}
          </div>
        {/if}
      </div>

      <!-- ── Panel tabs ─────────────────────────────────────────────────── -->
      <div class="flex border-b border-gray-200 bg-white">
        {#each [['vclay','① Vclay'], ['sw','② Saturation']] as [pid, plabel]}
          <button
            onclick={() => activePanel = pid}
            class="flex-1 text-xs py-1.5 border-b-2 transition-colors font-medium
                   {activePanel === pid
                     ? (pid === 'vclay' ? 'border-amber-500 text-amber-700' : 'border-blue-600 text-blue-700')
                     : 'border-transparent text-gray-400 hover:text-gray-600'}">
            {plabel}
          </button>
        {/each}
      </div>
    {/if}

    <!-- ── Scrollable content ────────────────────────────────────────────── -->
    <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

      {#if !model?.shalyInputs || activePanel === 'vclay'}
        <!-- ── ARCHIE: single panel / SHALY: Vclay panel ──────────────────── -->

        {#if model?.shalyInputs}
          <!-- GR curve -->
          <div class="border border-gray-200 rounded p-2 bg-white">
            <p class="text-[0.65rem] font-semibold text-gray-500 uppercase mb-1.5">Gamma Ray (GR)</p>
            <div class="grid grid-cols-2 gap-1.5 mb-1.5">
              <div>
                <label class="block text-[0.6rem] text-gray-400 mb-0.5">Slot</label>
                <select bind:value={grSlot} class="w-full text-xs border border-gray-200 rounded px-1 py-0.5">
                  {#each slots as s}<option value={s}>{s}</option>{/each}
                </select>
              </div>
              <div>
                <label class="block text-[0.6rem] text-gray-400 mb-0.5">Curve</label>
                <input type="text" bind:value={grCurve} list="gr-curves"
                  class="w-full text-xs border border-gray-200 rounded px-1 py-0.5 uppercase"/>
                <datalist id="gr-curves">
                  {#each slotCurveOptions[grSlot] ?? [] as c}<option value={c}>{c}</option>{/each}
                </datalist>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <div>
                <label class="block text-[0.6rem] text-gray-400 mb-0.5">GR clean (min)</label>
                <input type="number" step="1" bind:value={grMin}
                  class="w-full text-xs border border-gray-200 rounded px-1 py-0.5"/>
              </div>
              <div>
                <label class="block text-[0.6rem] text-gray-400 mb-0.5">GR shale (max)</label>
                <input type="number" step="1" bind:value={grMax}
                  class="w-full text-xs border border-gray-200 rounded px-1 py-0.5"/>
              </div>
            </div>
          </div>

          <!-- Vclay method -->
          <div class="border border-gray-200 rounded p-2 bg-white">
            <p class="text-[0.65rem] font-semibold text-gray-500 uppercase mb-1.5">Vclay Method</p>
            <div class="flex flex-col gap-0.5">
              {#each VCL_METHODS as vm}
                <button
                  onclick={() => vclMethod = vm.id}
                  class="w-full text-left px-2 py-1 rounded border transition-colors
                         {vclMethod === vm.id
                           ? 'bg-amber-500 text-white border-amber-500'
                           : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'}">
                  <div class="text-xs">{vm.label}</div>
                  <div class="text-[0.58rem] font-mono opacity-75 mt-0.5">{VCL_FORMULAS[vm.id]}</div>
                </button>
              {/each}
            </div>
          </div>

        {:else}
          <!-- Archie — Porosity -->
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
            <div>
              <label class="block text-[0.6rem] text-gray-400 mb-0.5">Units</label>
              <div class="flex rounded overflow-hidden border border-gray-200 text-[0.65rem] font-medium">
                <button onclick={() => porUnits = 'pu'}
                  class="flex-1 py-0.5 text-center transition-colors
                         {porUnits === 'pu' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}">
                  PU (0–100)
                </button>
                <button onclick={() => porUnits = 'frac'}
                  class="flex-1 py-0.5 text-center border-l border-gray-200 transition-colors
                         {porUnits === 'frac' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}">
                  Fraction
                </button>
              </div>
            </div>
          </div>

          <!-- Archie — Resistivity -->
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

          <!-- Archie — Parameters -->
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
        {/if}

      {:else}
        <!-- ── SHALY: Sw panel ─────────────────────────────────────────────── -->

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
              <input type="text" bind:value={porCurve} list="por-curves2"
                class="w-full text-xs border border-gray-200 rounded px-1 py-0.5 uppercase"/>
              <datalist id="por-curves2">
                {#each slotCurveOptions[porSlot] ?? [] as c}<option value={c}>{c}</option>{/each}
              </datalist>
            </div>
          </div>
          <div>
            <label class="block text-[0.6rem] text-gray-400 mb-0.5">Units</label>
            <div class="flex rounded overflow-hidden border border-gray-200 text-[0.65rem] font-medium">
              <button onclick={() => porUnits = 'pu'}
                class="flex-1 py-0.5 text-center transition-colors
                       {porUnits === 'pu' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}">
                PU (0–100)
              </button>
              <button onclick={() => porUnits = 'frac'}
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
              <input type="text" bind:value={resCurve} list="res-curves2"
                class="w-full text-xs border border-gray-200 rounded px-1 py-0.5 uppercase"/>
              <datalist id="res-curves2">
                {#each slotCurveOptions[resSlot] ?? [] as c}<option value={c}>{c}</option>{/each}
              </datalist>
            </div>
          </div>
        </div>

        <!-- Clay Resistivity -->
        <div class="border border-gray-200 rounded p-2 bg-white">
          <p class="text-[0.65rem] font-semibold text-gray-500 uppercase mb-1.5">Clay Resistivity (Rcl)</p>
          <div class="flex rounded overflow-hidden border border-gray-200 text-[0.65rem] font-medium mb-1.5">
            <button onclick={() => rclMode = 'const'}
              class="flex-1 py-0.5 text-center transition-colors
                     {rclMode === 'const' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}">
              Constant
            </button>
            <button onclick={() => rclMode = 'curve'}
              class="flex-1 py-0.5 text-center border-l border-gray-200 transition-colors
                     {rclMode === 'curve' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}">
              Curve
            </button>
          </div>
          {#if rclMode === 'const'}
            <div>
              <label class="block text-[0.6rem] text-gray-400 mb-0.5">Rcl (ohm·m)</label>
              <input type="number" step="0.1" bind:value={rcl}
                class="w-full text-xs border border-gray-200 rounded px-1 py-0.5"/>
            </div>
          {:else}
            <div class="grid grid-cols-2 gap-1.5">
              <div>
                <label class="block text-[0.6rem] text-gray-400 mb-0.5">Slot</label>
                <select bind:value={rclSlot} class="w-full text-xs border border-gray-200 rounded px-1 py-0.5">
                  {#each slots as s}<option value={s}>{s}</option>{/each}
                </select>
              </div>
              <div>
                <label class="block text-[0.6rem] text-gray-400 mb-0.5">Curve</label>
                <input type="text" bind:value={rclCurve} list="rcl-curves"
                  class="w-full text-xs border border-gray-200 rounded px-1 py-0.5 uppercase"/>
                <datalist id="rcl-curves">
                  {#each slotCurveOptions[rclSlot] ?? [] as c}<option value={c}>{c}</option>{/each}
                </datalist>
              </div>
            </div>
          {/if}
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
      {/if}

      <!-- Calculate button + status — always visible -->
      <button onclick={calculate}
        class="w-full text-xs bg-blue-600 text-white rounded px-3 py-2 hover:bg-blue-700 font-medium">
        Calculate Sw
      </button>

      {#if calcError}
        <p class="text-xs text-red-500 bg-red-50 rounded p-1.5">{calcError}</p>
      {/if}
      {#if swResult}
        <div class="text-xs text-gray-500 bg-green-50 rounded p-1.5 border border-green-200">
          ✓ {swResult.depths.length} depth points — {model?.label}
        </div>
      {/if}
    </div>
  </div>

  <!-- ── Right: Sw chart ─────────────────────────────────────────────────── -->
  <div class="flex-1 overflow-auto bg-white">
    {#if !swResult}
      <div class="h-full flex items-center justify-center text-gray-400 text-xs select-none text-center px-8">
        Configure inputs and click Calculate Sw
      </div>
    {:else}
      <!-- Formula banner -->
      <div class="px-4 py-2 border-b border-gray-100 bg-gray-50">
        <span class="text-[0.6rem] text-gray-400 uppercase tracking-wide mr-2">Formula</span>
        <span class="text-[0.65rem] font-mono text-gray-600">{model?.formula}</span>
        {#if model?.shalyInputs}
          <span class="text-gray-300 mx-1">·</span>
          <span class="text-[0.6rem] text-amber-500 font-mono">{VCL_FORMULAS[vclMethod]}</span>
          <span class="text-[0.55rem] text-gray-400 ml-1">where IGR=(GR−{grMin})/(GR{grMax}−{grMin})</span>
        {/if}
      </div>

      <svg width={svgWidth} height={HEADER_H + CHART_H + 20}
        style="display:block; font-family:sans-serif">

        <!-- Depth ticks -->
        {#each depthTicks as t}
          <line x1={MARGIN_L - 4} y1={t.py} x2={svgWidth - 10} y2={t.py} stroke="#e5e7eb" stroke-width="0.5"/>
          <text x={MARGIN_L - 6} y={t.py + 3} text-anchor="end" font-size="8" fill="#6b7280">{t.label}</text>
        {/each}

        <!-- ── Vclay track (shaly models only) ──────────────────────────── -->
        {#if swResult.vclDepths?.length}
          <rect x={VCL_X0} y={HEADER_H} width={TRACK_W} height={CHART_H} fill="#fffbeb"/>
          <!-- header -->
          <text x={VCL_X0 + TRACK_W/2} y="18" text-anchor="middle" font-size="10" font-weight="bold" fill="#92400e">Vclay</text>
          <text x={VCL_X0 + TRACK_W/2} y="30" text-anchor="middle" font-size="8" fill="#b45309">{VCL_METHODS.find(v=>v.id===vclMethod)?.label}</text>
          <text x={VCL_X0 + TRACK_W/2} y="42" text-anchor="middle" font-size="7" fill="#d97706" font-style="italic">{VCL_FORMULAS[vclMethod]}</text>
          <!-- x-axis ticks -->
          {#each [0, 0.25, 0.5, 0.75, 1.0] as v}
            <line x1={svx(v)} y1={HEADER_H} x2={svx(v)} y2={HEADER_H + CHART_H} stroke="#fde68a" stroke-width="1"/>
            <text x={svx(v)} y={HEADER_H - 4} text-anchor="middle" font-size="8" fill="#d97706">{v}</text>
          {/each}
          <!-- curve -->
          {#if vclPolyline}
            <polyline points={vclPolyline} fill="none" stroke="#d97706" stroke-width="1.5" opacity="0.9"/>
          {/if}
          <!-- 0.5 marker -->
          <line x1={svx(0.5)} y1={HEADER_H} x2={svx(0.5)} y2={HEADER_H + CHART_H}
            stroke="#92400e" stroke-width="1" stroke-dasharray="3,3" opacity="0.4"/>
        {/if}

        <!-- ── Sw track ───────────────────────────────────────────────────── -->
        <rect x={SW_X0} y={HEADER_H} width={TRACK_W} height={CHART_H} fill="#eff6ff"/>
        <!-- header -->
        <text x={SW_X0 + TRACK_W/2} y="18" text-anchor="middle" font-size="10" font-weight="bold" fill="#1e40af">Sw</text>
        <text x={SW_X0 + TRACK_W/2} y="30" text-anchor="middle" font-size="8" fill="#3b82f6">{model?.label}</text>
        <text x={SW_X0 + TRACK_W/2} y="42" text-anchor="middle" font-size="7" fill="#60a5fa" font-style="italic">{model?.formula}</text>
        <!-- x-axis ticks -->
        {#each [0, 0.25, 0.5, 0.75, 1.0] as v}
          <line x1={ssx(v)} y1={HEADER_H} x2={ssx(v)} y2={HEADER_H + CHART_H} stroke="#bfdbfe" stroke-width="1"/>
          <text x={ssx(v)} y={HEADER_H - 4} text-anchor="middle" font-size="8" fill="#93c5fd">{v}</text>
        {/each}
        <!-- curve -->
        {#if swPolyline}
          <polyline points={swPolyline} fill="none" stroke="#2563eb" stroke-width="1.5" opacity="0.9"/>
        {/if}
        <!-- 0.5 marker -->
        <line x1={ssx(0.5)} y1={HEADER_H} x2={ssx(0.5)} y2={HEADER_H + CHART_H}
          stroke="#dc2626" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>
      </svg>
    {/if}
  </div>
</div>
