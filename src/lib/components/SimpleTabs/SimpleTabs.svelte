<script>
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { getApp } from '$lib/apps/registry.js';
</script>

{#if tabStore.tabs.length === 0}
<div class="h-full overflow-y-auto flex flex-col items-center justify-start pt-7 pb-10 px-4 select-none"
     style="background:linear-gradient(160deg,#f0f4f8 0%,#e8eef5 60%,#e2e9f0 100%)">

  <!-- Title -->
  <div class="flex items-center gap-2.5 mb-1">
    <!-- stacked-layers logo mark -->
    <svg viewBox="0 0 28 22" width="28" height="22" fill="none">
      <path d="M14 2 L26 7.5 L14 13 L2 7.5 Z"  fill="#7a9090" opacity="0.9"/>
      <path d="M14 7 L26 12.5 L14 18 L2 12.5 Z" fill="#9b7aa0" opacity="0.85"/>
      <path d="M14 12 L26 17.5 L14 23 L2 17.5 Z" fill="#b8a882" opacity="0.88" transform="translate(0,-2)"/>
    </svg>
    <span style="font-size:1.35rem;font-weight:700;letter-spacing:-0.02em;color:#1e293b">SVTC</span>
  </div>
  <p style="font-size:11px;color:#64748b;margin-bottom:1.6rem;letter-spacing:0.02em">
    Subsurface Visualisation &amp; Interpretation
  </p>

  <!-- ── Hero: 3-D Geological Block ──────────────────────────────────────── -->
  <div style="width:100%;max-width:320px;margin-bottom:1.4rem">
    <svg viewBox="0 0 280 195" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f0f4f8"/>
          <stop offset="100%" stop-color="#e2e9f0"/>
        </linearGradient>
        <!-- right-face depth gradient -->
        <linearGradient id="rfGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#c4bfa0"/>
          <stop offset="100%" stop-color="#a8a48a"/>
        </linearGradient>
        <!-- top-face gradient -->
        <linearGradient id="tfGrad" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stop-color="#d8dde4"/>
          <stop offset="100%" stop-color="#bfc7d0"/>
        </linearGradient>
      </defs>

      <!-- ── Formation layers (front cross-section face) ─────────────────── -->

      <!-- Brown / earthy top band (flat) -->
      <path d="M18,55 L204,55 L204,82 L18,82 Z"
            fill="#7a5c2e" opacity="0.88"/>

      <!-- Purple / mauve dome layer -->
      <path d="M18,82 L204,82 L204,114 Q111,93 18,114 Z"
            fill="#9b7aa0" opacity="0.86"/>

      <!-- Khaki / tan layer (follows dome) -->
      <path d="M18,114 Q111,93 204,114 L204,140 Q111,120 18,140 Z"
            fill="#b8a882" opacity="0.88"/>

      <!-- Gray-green basement (fills to bottom) -->
      <path d="M18,140 Q111,120 204,140 L204,170 L18,170 Z"
            fill="#7a9090" opacity="0.90"/>

      <!-- ── Top face ─────────────────────────────────────────────────────── -->
      <polygon points="18,55 54,28 240,28 204,55"
               fill="url(#tfGrad)" opacity="0.95"/>

      <!-- Dome cap visible on top face (mauve oval) -->
      <ellipse cx="147" cy="38" rx="32" ry="8"
               fill="#9b7aa0" opacity="0.42"/>
      <!-- Brown ring around it -->
      <ellipse cx="147" cy="38" rx="56" ry="12"
               fill="#7a5c2e" opacity="0.18"/>

      <!-- ── Right face ──────────────────────────────────────────────────── -->
      <!-- Fill right face with layered bands matching front face -->
      <!-- gray-green base -->
      <polygon points="204,140 240,110 240,170 204,170"
               fill="#7a9090" opacity="0.88"/>
      <!-- khaki band -->
      <polygon points="204,114 240,88 240,110 204,140"
               fill="#b8a882" opacity="0.85"/>
      <!-- purple band -->
      <polygon points="204,82 240,58 240,88 204,114"
               fill="#9b7aa0" opacity="0.80"/>
      <!-- brown band -->
      <polygon points="204,55 240,28 240,58 204,82"
               fill="#7a5c2e" opacity="0.82"/>

      <!-- ── Wireframe box ────────────────────────────────────────────────── -->
      <!-- Front face outline -->
      <rect x="18" y="55" width="186" height="115"
            fill="none" stroke="#475569" stroke-width="1.2" opacity="0.7"/>
      <!-- Top face outline -->
      <polygon points="18,55 54,28 240,28 204,55"
               fill="none" stroke="#475569" stroke-width="1.2" opacity="0.7"/>
      <!-- Right face outline -->
      <polygon points="204,55 240,28 240,170 204,170"
               fill="none" stroke="#475569" stroke-width="1.2" opacity="0.7"/>

      <!-- Depth tick marks on left edge of front face -->
      {#each [82,114,140] as y}
        <line x1="10" y1={y} x2="18" y2={y} stroke="#94a3b8" stroke-width="0.8"/>
      {/each}

      <!-- ── Dashed borehole through front face ─────────────────────────── -->
      <line x1="111" y1="55" x2="111" y2="170"
            stroke="#374151" stroke-width="1.1" stroke-dasharray="3,2.5" opacity="0.55"/>

      <!-- Labels for formations (right side) -->
      <text x="209" y="70"  font-size="7.5" fill="#fff" opacity="0.85" font-family="sans-serif">Brown Fm</text>
      <text x="209" y="100" font-size="7.5" fill="#fff" opacity="0.85" font-family="sans-serif">Mauve Fm</text>
      <text x="209" y="128" font-size="7.5" fill="#4a3a0a" opacity="0.7"  font-family="sans-serif">Khaki Fm</text>
      <text x="209" y="155" font-size="7.5" fill="#fff" opacity="0.75" font-family="sans-serif">Basement</text>
    </svg>
  </div>

  <!-- ── Feature tiles ───────────────────────────────────────────────────── -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%;max-width:320px;margin-bottom:1.4rem">

    <!-- DGEO -->
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:10px 10px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
      <svg viewBox="0 0 72 52" style="width:100%;height:auto;display:block;margin-bottom:5px">
        <rect x="2" y="2" width="68" height="48" rx="2" fill="#f0f4f8"/>
        <!-- Brown flat top -->
        <rect x="2" y="2" width="68" height="10" fill="#7a5c2e" opacity="0.88"/>
        <!-- Purple dome -->
        <path d="M2,12 L70,12 L70,27 Q37,19 2,27 Z" fill="#9b7aa0" opacity="0.86"/>
        <!-- Khaki -->
        <path d="M2,27 Q37,19 70,27 L70,38 Q37,31 2,38 Z" fill="#b8a882" opacity="0.88"/>
        <!-- Basement -->
        <path d="M2,38 Q37,31 70,38 L70,50 L2,50 Z" fill="#7a9090" opacity="0.9"/>
        <!-- border -->
        <rect x="2" y="2" width="68" height="48" rx="2" fill="none" stroke="#94a3b8" stroke-width="0.8"/>
        <!-- well -->
        <line x1="36" y1="2" x2="36" y2="50" stroke="#374151" stroke-width="0.8" stroke-dasharray="2,2" opacity="0.5"/>
      </svg>
      <div style="font-size:10px;font-weight:600;color:#334155">.dgeo</div>
      <div style="font-size:9.5px;color:#64748b">Geological Cross-Section</div>
    </div>

    <!-- LAS / DLIS -->
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:10px 10px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
      <svg viewBox="0 0 72 52" style="width:100%;height:auto;display:block;margin-bottom:5px">
        <!-- depth track background -->
        <rect x="2" y="2" width="10" height="48" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="0.5"/>
        <!-- 3 log tracks -->
        <rect x="13" y="2" width="18" height="48" fill="#f0fdf4" stroke="#e2e8f0" stroke-width="0.5"/>
        <rect x="32" y="2" width="18" height="48" fill="#fff7ed" stroke="#e2e8f0" stroke-width="0.5"/>
        <rect x="51" y="2" width="19" height="48" fill="#eff6ff" stroke="#e2e8f0" stroke-width="0.5"/>
        <!-- depth ticks -->
        {#each [10,22,34,46] as y}
          <line x1="9" y1={y} x2="12" y2={y} stroke="#94a3b8" stroke-width="0.6"/>
        {/each}
        <!-- GR curve (green, jagged) -->
        <polyline points="14,5 18,13 15,21 21,29 16,37 20,44 15,50"
                  fill="none" stroke="#16a34a" stroke-width="1.3"/>
        <!-- Resistivity (red, smoother) -->
        <polyline points="33,6 42,16 35,26 44,34 36,42 43,49"
                  fill="none" stroke="#dc2626" stroke-width="1.3"/>
        <!-- Density (blue) -->
        <polyline points="53,7 60,17 54,27 62,36 55,44 63,50"
                  fill="none" stroke="#2563eb" stroke-width="1.1"/>
      </svg>
      <div style="font-size:10px;font-weight:600;color:#334155">.las / .dlis</div>
      <div style="font-size:9.5px;color:#64748b">Well Log Curves</div>
    </div>

    <!-- WSON -->
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:10px 10px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
      <svg viewBox="0 0 72 52" style="width:100%;height:auto;display:block;margin-bottom:5px">
        <!-- surface casing -->
        <rect x="22" y="2"  width="28" height="18" rx="1" fill="none" stroke="#374151" stroke-width="1.6"/>
        <!-- int. casing -->
        <rect x="28" y="2"  width="16" height="32" rx="0.5" fill="none" stroke="#64748b" stroke-width="1.3"/>
        <!-- tubing -->
        <rect x="32" y="5"  width="8"  height="30" rx="0.5" fill="none" stroke="#0369a1" stroke-width="1.1"/>
        <!-- cement squeezes -->
        <rect x="23" y="14" width="5"  height="6" rx="1" fill="#9ca3af"/>
        <rect x="44" y="14" width="5"  height="6" rx="1" fill="#9ca3af"/>
        <!-- reservoir band -->
        <rect x="2"  y="38" width="68" height="12" rx="1" fill="#fef3c7" opacity="0.8"/>
        <line x1="2" y1="38" x2="70" y2="38" stroke="#d97706" stroke-width="0.6" stroke-dasharray="3,2"/>
        <!-- perforations -->
        <line x1="28" y1="42" x2="23" y2="42" stroke="#dc2626" stroke-width="1.5"/>
        <line x1="44" y1="45" x2="49" y2="45" stroke="#dc2626" stroke-width="1.5"/>
        <text x="4" y="47" font-size="6" fill="#b45309" font-family="sans-serif" opacity="0.8">Reservoir</text>
      </svg>
      <div style="font-size:10px;font-weight:600;color:#334155">.wson</div>
      <div style="font-size:9.5px;color:#64748b">Well Schematic</div>
    </div>

    <!-- TPL / WFLOW -->
    <div style="background:white;border-radius:10px;border:1px solid #e2e8f0;padding:10px 10px 8px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">
      <svg viewBox="0 0 72 52" style="width:100%;height:auto;display:block;margin-bottom:5px">
        <!-- Plot background -->
        <rect x="2" y="2" width="68" height="48" rx="1.5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.6"/>
        <!-- Grid -->
        <line x1="2"  y1="20" x2="70" y2="20" stroke="#e2e8f0" stroke-width="0.5"/>
        <line x1="2"  y1="34" x2="70" y2="34" stroke="#e2e8f0" stroke-width="0.5"/>
        <line x1="25" y1="2"  x2="25" y2="50" stroke="#e2e8f0" stroke-width="0.5"/>
        <line x1="47" y1="2"  x2="47" y2="50" stroke="#e2e8f0" stroke-width="0.5"/>
        <!-- S-shaped blue curve -->
        <path d="M5,38 C16,34 22,12 36,18 C50,24 56,42 67,38"
              fill="none" stroke="#2563eb" stroke-width="1.5"/>
        <!-- Dashed orange trend -->
        <path d="M5,28 C22,22 50,36 67,30"
              fill="none" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="3,2"/>
        <!-- Scatter dots -->
        <circle cx="12" cy="36" r="2" fill="#7c3aed" opacity="0.7"/>
        <circle cx="28" cy="18" r="2" fill="#7c3aed" opacity="0.7"/>
        <circle cx="44" cy="24" r="2" fill="#7c3aed" opacity="0.7"/>
        <circle cx="60" cy="38" r="2" fill="#7c3aed" opacity="0.7"/>
      </svg>
      <div style="font-size:10px;font-weight:600;color:#334155">.tpl / .wflow</div>
      <div style="font-size:9.5px;color:#64748b">Plots &amp; Workflows</div>
    </div>

  </div>

  <!-- Getting started hint -->
  <p style="font-size:11px;color:#94a3b8;text-align:center;max-width:220px;line-height:1.5">
    Open the <strong style="color:#64748b">file explorer</strong> on the left to browse
    well data, or load a sample from the menu <span style="color:#64748b">⊞</span>
  </p>

</div>

{:else}
  <div class="flex flex-col h-full overflow-hidden">

    <!-- Tab bar -->
    <div class="flex items-end border-b border-gray-200 bg-gray-50 overflow-x-auto flex-shrink-0">
      {#each tabStore.tabs as tab (tab.id)}
        {@const isActive = tab.id === tabStore.activeId}
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-r border-gray-200 flex-shrink-0 max-w-[160px] min-w-0
                 {isActive
                   ? 'bg-white text-green-800 border-t-2 border-t-green-700 -mb-px'
                   : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'}"
          onclick={() => tabStore.setActive(tab.id)}
          title={tab.name}
        >
          {#if tab.dirty}<span class="flex-shrink-0 text-orange-400 text-[10px] leading-none">●</span>{/if}
          <span class="truncate flex-1 min-w-0">{tab.name}</span>
          <span
            class="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 leading-none"
            role="button"
            tabindex="0"
            aria-label="Close {tab.name}"
            onclick={(e) => { e.stopPropagation(); tabStore.closeTab(tab.id); }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tabStore.closeTab(tab.id); } }}
          >✕</span>
        </button>
      {/each}
    </div>

    <!-- Tab contents — all mounted, active one visible -->
    <div class="flex-1 overflow-hidden relative">
      {#each tabStore.tabs as tab (tab.id)}
        {@const AppComponent = getApp(tab.ext)}
        <div class="absolute inset-0 overflow-hidden"
             style="display:{tab.id === tabStore.activeId ? 'block' : 'none'}">
          <AppComponent tab={tab} />
        </div>
      {/each}
    </div>

  </div>
{/if}
