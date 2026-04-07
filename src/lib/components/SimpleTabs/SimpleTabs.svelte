<script>
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { getApp } from '$lib/apps/registry.js';
</script>

{#if tabStore.tabs.length === 0}
<div class="h-full overflow-y-auto select-none" style="background:#f1f5f9">

  <!-- ══ Dark hero ══════════════════════════════════════════════════════════ -->
  <div style="background:linear-gradient(155deg,#0c1628 0%,#162236 55%,#0a1f38 100%);
              padding:24px 16px 28px;display:flex;flex-direction:column;align-items:center;
              position:relative;overflow:hidden">

    <!-- dot-grid texture -->
    <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0.18"
         preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="dotpat" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1" fill="#60a5fa"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dotpat)"/>
    </svg>

    <!-- logo + title -->
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:3px;position:relative;z-index:1">
      <svg viewBox="0 0 30 24" width="28" height="22" xmlns="http://www.w3.org/2000/svg">
        <polygon points="15,1 28,7.5 15,14 2,7.5" fill="#7a9090"/>
        <polygon points="15,7 28,13.5 15,20 2,13.5" fill="#9b7aa0" opacity="0.92"/>
        <polygon points="15,13 28,19.5 15,26 2,19.5" fill="#b8a882" opacity="0.88" transform="translate(0,-1)"/>
      </svg>
      <span style="font-size:1.6rem;font-weight:800;color:#f8fafc;letter-spacing:-0.025em;line-height:1">SVTC</span>
    </div>
    <p style="font-size:10.5px;color:#64748b;letter-spacing:0.06em;text-transform:uppercase;
              margin-bottom:18px;position:relative;z-index:1">
      Subsurface Visualisation &amp; Interpretation
    </p>

    <!-- ── 3-D Geological block ────────────────────────────────────────── -->
    <div style="width:100%;max-width:360px;position:relative;z-index:1;
                filter:drop-shadow(0 12px 40px rgba(155,122,160,0.3)) drop-shadow(0 4px 12px rgba(0,0,0,0.6))">
      <svg viewBox="0 0 290 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
        <defs>
          <!-- front-face horizontal gradients (brighter centre = dome lit) -->
          <linearGradient id="brnF" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stop-color="#7a4f1a"/>
            <stop offset="45%"  stop-color="#b07830"/>
            <stop offset="100%" stop-color="#7a4f1a"/>
          </linearGradient>
          <linearGradient id="mveF" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stop-color="#6a4a88"/>
            <stop offset="45%"  stop-color="#a870d0"/>
            <stop offset="100%" stop-color="#6a4a88"/>
          </linearGradient>
          <linearGradient id="khkF" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stop-color="#907040"/>
            <stop offset="45%"  stop-color="#d0a858"/>
            <stop offset="100%" stop-color="#907040"/>
          </linearGradient>
          <linearGradient id="sgeF" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stop-color="#3a6868"/>
            <stop offset="45%"  stop-color="#5a9898"/>
            <stop offset="100%" stop-color="#3a6868"/>
          </linearGradient>
          <!-- right face (darker, one stop each) -->
          <linearGradient id="brnR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#6a4010"/>
            <stop offset="100%" stop-color="#4a2808"/>
          </linearGradient>
          <linearGradient id="mveR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#5a3878"/>
            <stop offset="100%" stop-color="#3a1858"/>
          </linearGradient>
          <linearGradient id="khkR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#786030"/>
            <stop offset="100%" stop-color="#584818"/>
          </linearGradient>
          <linearGradient id="sgeR" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#305858"/>
            <stop offset="100%" stop-color="#183838"/>
          </linearGradient>
          <!-- top face -->
          <linearGradient id="topF" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stop-color="#9a7228" stop-opacity="0.85"/>
            <stop offset="100%" stop-color="#6a4810" stop-opacity="0.7"/>
          </linearGradient>
          <!-- dome glow -->
          <filter id="dmGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        <!-- ─── Front face layers ─────────────────────────────────────── -->
        <!-- Brown (flat top band) -->
        <path d="M22,55 L210,55 L210,83 L22,83 Z" fill="url(#brnF)"/>
        <!-- Purple / mauve dome -->
        <path d="M22,83 L210,83 L210,115 Q116,94 22,115 Z" fill="url(#mveF)" opacity="0.95"/>
        <!-- Khaki (follows dome) -->
        <path d="M22,115 Q116,94 210,115 L210,142 Q116,122 22,142 Z" fill="url(#khkF)"/>
        <!-- Sage / basement -->
        <path d="M22,142 Q116,122 210,142 L210,172 L22,172 Z" fill="url(#sgeF)"/>

        <!-- Interface lines (thin dark hairlines between formations) -->
        <line x1="22" y1="83" x2="210" y2="83" stroke="rgba(0,0,0,0.25)" stroke-width="0.7"/>
        <path d="M22,115 Q116,94 210,115" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="0.7"/>
        <path d="M22,142 Q116,122 210,142" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="0.7"/>

        <!-- ─── Top face ───────────────────────────────────────────────── -->
        <polygon points="22,55 60,26 248,26 210,55" fill="url(#topF)"/>
        <!-- Dome cap on top (mauve glow) -->
        <ellipse cx="154" cy="37" rx="44" ry="11" fill="#8860c0" opacity="0.22" filter="url(#dmGlow)"/>
        <ellipse cx="154" cy="37" rx="26" ry="7"  fill="#c090e0" opacity="0.5"/>
        <ellipse cx="154" cy="37" rx="12" ry="3.5" fill="#e0b8f8" opacity="0.6"/>
        <!-- Contour ring -->
        <ellipse cx="154" cy="37" rx="40" ry="10" fill="none" stroke="#c090e0" stroke-width="0.6" stroke-dasharray="3,2" opacity="0.35"/>

        <!-- ─── Right face layers ──────────────────────────────────────── -->
        <polygon points="210,55 248,26 248,60 210,83"  fill="url(#brnR)"/>
        <polygon points="210,83 248,60 248,92 210,115" fill="url(#mveR)"/>
        <polygon points="210,115 248,92 248,118 210,142" fill="url(#khkR)"/>
        <polygon points="210,142 248,118 248,172 210,172" fill="url(#sgeR)"/>

        <!-- ─── Wireframe ──────────────────────────────────────────────── -->
        <!-- Front face border -->
        <rect x="22" y="55" width="188" height="117" fill="none" stroke="rgba(200,220,255,0.35)" stroke-width="1.3"/>
        <!-- Top face border -->
        <polygon points="22,55 60,26 248,26 210,55" fill="none" stroke="rgba(200,220,255,0.35)" stroke-width="1.3"/>
        <!-- Right outer edges -->
        <line x1="248" y1="26" x2="248" y2="172" stroke="rgba(200,220,255,0.35)" stroke-width="1.3"/>
        <line x1="210" y1="172" x2="248" y2="172" stroke="rgba(200,220,255,0.35)" stroke-width="1.3"/>
        <!-- Right face layer lines -->
        <line x1="210" y1="83"  x2="248" y2="60"  stroke="rgba(200,220,255,0.18)" stroke-width="0.7"/>
        <line x1="210" y1="115" x2="248" y2="92"  stroke="rgba(200,220,255,0.18)" stroke-width="0.7"/>
        <line x1="210" y1="142" x2="248" y2="118" stroke="rgba(200,220,255,0.18)" stroke-width="0.7"/>

        <!-- ─── Dashed borehole ────────────────────────────────────────── -->
        <line x1="116" y1="26"  x2="116" y2="55"  stroke="rgba(255,255,255,0.2)"  stroke-width="1" stroke-dasharray="2,2"/>
        <line x1="116" y1="55"  x2="116" y2="172" stroke="rgba(255,255,255,0.55)" stroke-width="1.2" stroke-dasharray="3,2.5"/>

        <!-- ─── Formation labels (inside front face, never clip) ───────── -->
        <text x="28" y="73"  font-size="8" font-family="system-ui,sans-serif" fill="rgba(255,235,185,0.9)">Brown Fm</text>
        <text x="28" y="102" font-size="8" font-family="system-ui,sans-serif" fill="rgba(240,210,255,0.92)">Mauve Fm</text>
        <text x="28" y="131" font-size="8" font-family="system-ui,sans-serif" fill="rgba(255,240,190,0.85)">Khaki Fm</text>
        <text x="28" y="160" font-size="8" font-family="system-ui,sans-serif" fill="rgba(180,230,230,0.88)">Basement</text>

        <!-- Depth tick marks on left -->
        <line x1="16" y1="83"  x2="22" y2="83"  stroke="rgba(180,200,255,0.4)" stroke-width="0.8"/>
        <line x1="16" y1="115" x2="22" y2="115" stroke="rgba(180,200,255,0.4)" stroke-width="0.8"/>
        <line x1="16" y1="142" x2="22" y2="142" stroke="rgba(180,200,255,0.4)" stroke-width="0.8"/>
      </svg>
    </div>
  </div>

  <!-- ══ Feature cards ══════════════════════════════════════════════════════ -->
  <div style="padding:14px 12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:420px;margin:0 auto;width:100%;box-sizing:border-box">

    <!-- .dgeo -->
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08),0 0 0 1px rgba(0,0,0,0.06)">
      <div style="height:4px;background:linear-gradient(90deg,#16a34a,#4ade80)"></div>
      <div style="padding:10px">
        <svg viewBox="0 0 80 56" style="width:100%;height:auto;display:block;margin-bottom:7px;border-radius:4px;overflow:hidden">
          <rect width="80" height="56" fill="#0c1628"/>
          <!-- formations -->
          <rect x="0" y="0" width="80" height="12" fill="#9a6820"/>
          <path d="M0,12 L80,12 L80,30 Q40,22 0,30 Z" fill="#8050a8"/>
          <path d="M0,30 Q40,22 80,30 L80,44 Q40,37 0,44 Z" fill="#b88c40"/>
          <path d="M0,44 Q40,37 80,44 L80,56 L0,56 Z" fill="#3a7878"/>
          <!-- borehole -->
          <line x1="40" y1="0" x2="40" y2="56" stroke="rgba(255,255,255,0.45)" stroke-width="0.9" stroke-dasharray="2.5,2"/>
          <!-- subtle layer lines -->
          <line x1="0" y1="12" x2="80" y2="12" stroke="rgba(0,0,0,0.2)" stroke-width="0.5"/>
          <path d="M0,30 Q40,22 80,30" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>
          <path d="M0,44 Q40,37 80,44" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="0.5"/>
        </svg>
        <span style="display:inline-block;font-size:9.5px;font-weight:700;color:#15803d;background:#f0fdf4;border-radius:4px;padding:1px 5px;margin-bottom:3px">.dgeo</span>
        <div style="font-size:10px;color:#475569;line-height:1.3">Geological Cross-Section</div>
      </div>
    </div>

    <!-- .las / .dlis -->
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08),0 0 0 1px rgba(0,0,0,0.06)">
      <div style="height:4px;background:linear-gradient(90deg,#d97706,#fbbf24)"></div>
      <div style="padding:10px">
        <svg viewBox="0 0 80 56" style="width:100%;height:auto;display:block;margin-bottom:7px;border-radius:4px;overflow:hidden">
          <rect width="80" height="56" fill="#f8fafc"/>
          <!-- depth track -->
          <rect x="0" y="0" width="10" height="56" fill="#f1f5f9"/>
          <!-- 3 tracks -->
          <rect x="11" y="0" width="22" height="56" fill="#f0fdf4"/>
          <rect x="34" y="0" width="22" height="56" fill="#fff7ed"/>
          <rect x="57" y="0" width="23" height="56" fill="#eff6ff"/>
          <!-- track borders -->
          <line x1="10" y1="0" x2="10" y2="56" stroke="#e2e8f0" stroke-width="0.6"/>
          <line x1="33" y1="0" x2="33" y2="56" stroke="#e2e8f0" stroke-width="0.6"/>
          <line x1="56" y1="0" x2="56" y2="56" stroke="#e2e8f0" stroke-width="0.6"/>
          <!-- depth ticks -->
          <line x1="7" y1="14" x2="10" y2="14" stroke="#94a3b8" stroke-width="0.7"/>
          <line x1="7" y1="28" x2="10" y2="28" stroke="#94a3b8" stroke-width="0.7"/>
          <line x1="7" y1="42" x2="10" y2="42" stroke="#94a3b8" stroke-width="0.7"/>
          <!-- GR curve (green) -->
          <polyline points="12,4 17,12 13,21 20,30 14,39 19,48 13,54"
                    fill="none" stroke="#16a34a" stroke-width="1.6" stroke-linejoin="round"/>
          <!-- Res curve (amber) -->
          <polyline points="35,5 44,16 37,26 46,35 38,43 45,52"
                    fill="none" stroke="#d97706" stroke-width="1.6" stroke-linejoin="round"/>
          <!-- Density (blue) -->
          <polyline points="59,6 66,17 59,28 68,38 61,46 70,54"
                    fill="none" stroke="#2563eb" stroke-width="1.4" stroke-linejoin="round"/>
        </svg>
        <span style="display:inline-block;font-size:9.5px;font-weight:700;color:#b45309;background:#fffbeb;border-radius:4px;padding:1px 5px;margin-bottom:3px">.las / .dlis</span>
        <div style="font-size:10px;color:#475569;line-height:1.3">Well Log Curves</div>
      </div>
    </div>

    <!-- .wson -->
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08),0 0 0 1px rgba(0,0,0,0.06)">
      <div style="height:4px;background:linear-gradient(90deg,#2563eb,#60a5fa)"></div>
      <div style="padding:10px">
        <svg viewBox="0 0 80 56" style="width:100%;height:auto;display:block;margin-bottom:7px;border-radius:4px;overflow:hidden">
          <rect width="80" height="56" fill="#f8fafc"/>
          <!-- formation bands -->
          <rect x="0" y="0"  width="80" height="18" fill="#e8f0f8"/>
          <rect x="0" y="18" width="80" height="18" fill="#d8e4f0"/>
          <rect x="0" y="36" width="80" height="20" fill="#fef9c3" opacity="0.8"/>
          <line x1="0" y1="36" x2="80" y2="36" stroke="#ca8a04" stroke-width="0.6" stroke-dasharray="3,2"/>
          <!-- conductor casing -->
          <rect x="28" y="1"  width="24" height="14" rx="1" fill="none" stroke="#334155" stroke-width="2"/>
          <!-- surface casing -->
          <rect x="33" y="1"  width="14" height="28" rx="0.5" fill="none" stroke="#475569" stroke-width="1.6"/>
          <!-- production casing -->
          <rect x="36" y="4"  width="8"  height="38" rx="0.5" fill="none" stroke="#1d4ed8" stroke-width="1.3"/>
          <!-- tubing -->
          <rect x="38" y="8"  width="4"  height="32" rx="0.3" fill="none" stroke="#3b82f6" stroke-width="1"/>
          <!-- cement -->
          <rect x="29" y="10" width="4"  height="8" rx="1" fill="#94a3b8" opacity="0.8"/>
          <rect x="47" y="10" width="4"  height="8" rx="1" fill="#94a3b8" opacity="0.8"/>
          <!-- perforations -->
          <line x1="36" y1="45" x2="32" y2="45" stroke="#dc2626" stroke-width="1.6"/>
          <line x1="44" y1="48" x2="48" y2="48" stroke="#dc2626" stroke-width="1.6"/>
          <line x1="36" y1="50" x2="32" y2="50" stroke="#dc2626" stroke-width="1.6"/>
          <text x="4" y="52" font-size="6" fill="#92400e" font-family="system-ui" opacity="0.85">Reservoir</text>
        </svg>
        <span style="display:inline-block;font-size:9.5px;font-weight:700;color:#1d4ed8;background:#eff6ff;border-radius:4px;padding:1px 5px;margin-bottom:3px">.wson</span>
        <div style="font-size:10px;color:#475569;line-height:1.3">Well Schematic</div>
      </div>
    </div>

    <!-- .tpl / .wflow -->
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,0.08),0 0 0 1px rgba(0,0,0,0.06)">
      <div style="height:4px;background:linear-gradient(90deg,#7c3aed,#a78bfa)"></div>
      <div style="padding:10px">
        <svg viewBox="0 0 80 56" style="width:100%;height:auto;display:block;margin-bottom:7px;border-radius:4px;overflow:hidden">
          <rect width="80" height="56" fill="#fafafa"/>
          <!-- Grid -->
          <line x1="0" y1="18" x2="80" y2="18" stroke="#e2e8f0" stroke-width="0.7"/>
          <line x1="0" y1="36" x2="80" y2="36" stroke="#e2e8f0" stroke-width="0.7"/>
          <line x1="27" y1="0" x2="27" y2="56" stroke="#e2e8f0" stroke-width="0.7"/>
          <line x1="54" y1="0" x2="54" y2="56" stroke="#e2e8f0" stroke-width="0.7"/>
          <!-- area fill under blue curve -->
          <path d="M4,48 C16,44 24,12 40,15 C56,18 64,44 76,48 L76,56 L4,56 Z"
                fill="#818cf8" opacity="0.12"/>
          <!-- blue curve -->
          <path d="M4,48 C16,44 24,12 40,15 C56,18 64,44 76,48"
                fill="none" stroke="#4f46e5" stroke-width="1.8" stroke-linecap="round"/>
          <!-- orange dashed trend -->
          <path d="M4,32 C24,26 56,36 76,28"
                fill="none" stroke="#f59e0b" stroke-width="1.4" stroke-dasharray="4,2.5" stroke-linecap="round"/>
          <!-- scatter dots -->
          <circle cx="16" cy="44" r="2.2" fill="#7c3aed"/>
          <circle cx="40" cy="15" r="2.2" fill="#7c3aed"/>
          <circle cx="58" cy="20" r="2.2" fill="#7c3aed"/>
          <circle cx="72" cy="44" r="2.2" fill="#7c3aed"/>
        </svg>
        <span style="display:inline-block;font-size:9.5px;font-weight:700;color:#6d28d9;background:#faf5ff;border-radius:4px;padding:1px 5px;margin-bottom:3px">.tpl / .wflow</span>
        <div style="font-size:10px;color:#475569;line-height:1.3">Plots &amp; Workflows</div>
      </div>
    </div>

  </div>

  <!-- hint -->
  <p style="font-size:11px;color:#94a3b8;text-align:center;padding:0 20px 20px;line-height:1.6">
    Open the <strong style="color:#64748b;font-weight:600">file explorer</strong> ← to browse well data,
    or load a sample from <strong style="color:#64748b;font-weight:600">⊞ menu</strong>
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
