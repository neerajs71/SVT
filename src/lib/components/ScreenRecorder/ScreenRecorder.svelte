<script>
  import { GIFEncoder, quantize, applyPalette } from 'gifenc';

  // ── state ─────────────────────────────────────────────────────────────────
  let recording  = $state(false);
  let encoding   = $state(false);
  let countdown  = $state(0);   // seconds remaining shown on button
  let gifUrl     = $state(null);
  let error      = $state('');
  let expanded   = $state(false);

  // Settings
  let fps        = $state(8);
  let maxSecs    = $state(10);

  // ── internals ─────────────────────────────────────────────────────────────
  let stream     = null;
  let video      = null;
  let canvas     = null;
  let ctx        = null;
  let frames     = [];   // { data: Uint8ClampedArray, delay: number }
  let rafId      = null;
  let startTime  = 0;
  let lastFrame  = 0;

  const MS_PER_FRAME = $derived(Math.round(1000 / fps));

  // ── helpers ───────────────────────────────────────────────────────────────

  function cleanup() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (video)  { video.srcObject = null; video = null; }
    canvas = null; ctx = null; frames = [];
  }

  function tick(now) {
    if (!recording) return;

    const elapsed = now - startTime;
    countdown = Math.max(0, maxSecs - Math.floor(elapsed / 1000));

    // Capture frame at target fps
    if (now - lastFrame >= MS_PER_FRAME) {
      lastFrame = now;
      if (canvas && ctx && video) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        frames.push({ data: imageData.data, width: canvas.width, height: canvas.height });
      }
    }

    if (elapsed >= maxSecs * 1000) {
      stopRecording();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  async function startRecording() {
    error = '';
    gifUrl = null;
    frames = [];

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: fps, max: fps }, cursor: 'always' },
        audio: false
      });

      // Build offscreen video + canvas
      video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      // Use a fixed 1280×720 canvas (scale down if needed)
      const vw = video.videoWidth  || 1280;
      const vh = video.videoHeight || 720;
      const scale = Math.min(1, 800 / vw, 600 / vh);  // cap at 800×600 for file size
      canvas = document.createElement('canvas');
      canvas.width  = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      ctx = canvas.getContext('2d', { willReadFrequently: true });

      recording = true;
      startTime = performance.now();
      lastFrame = startTime;
      rafId = requestAnimationFrame(tick);

      // Stop if user ends share via browser UI
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (recording) stopRecording();
      });

    } catch (e) {
      error = e.name === 'NotAllowedError' ? 'Screen capture was cancelled.' : e.message;
      cleanup();
    }
  }

  async function stopRecording() {
    recording = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }

    if (frames.length === 0) { cleanup(); return; }

    encoding = true;
    gifUrl = null;

    // Encode in a microtask to let the UI update first
    await new Promise(r => setTimeout(r, 0));

    try {
      const { width, height } = frames[0];
      const encoder = GIFEncoder();

      for (const frame of frames) {
        const palette = quantize(frame.data, 256);
        const index   = applyPalette(frame.data, palette);
        encoder.writeFrame(index, width, height, { palette, delay: MS_PER_FRAME });
      }

      encoder.finish();
      const blob = new Blob([encoder.bytes()], { type: 'image/gif' });
      gifUrl = URL.createObjectURL(blob);
    } catch (e) {
      error = `GIF encoding failed: ${e.message}`;
    } finally {
      encoding = false;
      cleanup();
      frames = [];
    }
  }

  function downloadGif() {
    if (!gifUrl) return;
    const a = document.createElement('a');
    a.href = gifUrl;
    a.download = `recording-${Date.now()}.gif`;
    a.click();
  }

  function reset() {
    if (gifUrl) { URL.revokeObjectURL(gifUrl); gifUrl = null; }
    error = '';
  }
</script>

<!-- ── Floating button ────────────────────────────────────────────────────── -->
<div class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">

  <!-- GIF preview / download panel -->
  {#if gifUrl}
    <div class="bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex flex-col gap-1 w-56">
      <img src={gifUrl} alt="Recording" class="w-full rounded border border-gray-100" />
      <div class="flex gap-1">
        <button
          onclick={downloadGif}
          class="flex-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-1"
        >Download GIF</button>
        <button
          onclick={reset}
          class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded px-2 py-1"
        >✕</button>
      </div>
    </div>
  {/if}

  <!-- Error -->
  {#if error}
    <div class="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-2 py-1 max-w-48">
      {error}
      <button onclick={() => error = ''} class="ml-1 font-bold">✕</button>
    </div>
  {/if}

  <!-- Settings panel -->
  {#if expanded && !recording && !encoding}
    <div class="bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-44 flex flex-col gap-2 text-xs">
      <label class="flex items-center justify-between">
        <span class="text-gray-600">FPS</span>
        <input type="range" min="4" max="15" step="1" bind:value={fps}
          class="w-20 accent-blue-600" />
        <span class="w-4 text-right text-gray-700">{fps}</span>
      </label>
      <label class="flex items-center justify-between">
        <span class="text-gray-600">Max sec</span>
        <input type="range" min="3" max="30" step="1" bind:value={maxSecs}
          class="w-20 accent-blue-600" />
        <span class="w-4 text-right text-gray-700">{maxSecs}</span>
      </label>
    </div>
  {/if}

  <!-- Main record button -->
  <div class="flex gap-1 items-center">

    <!-- Settings cog (only when idle) -->
    {#if !recording && !encoding}
      <button
        onclick={() => expanded = !expanded}
        title="Recording settings"
        class="w-7 h-7 rounded-full bg-white border border-gray-300 shadow flex items-center justify-center text-gray-500 hover:bg-gray-50 text-sm"
      >⚙</button>
    {/if}

    <!-- Record / Stop / Encoding button -->
    {#if encoding}
      <button disabled
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-500 text-white text-xs font-medium shadow-lg cursor-wait"
      >
        <span class="animate-spin">⟳</span> Encoding…
      </button>
    {:else if recording}
      <button
        onclick={stopRecording}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-lg animate-pulse"
      >
        ■ Stop&nbsp;<span class="tabular-nums">{countdown}s</span>
      </button>
    {:else}
      <button
        onclick={startRecording}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium shadow-lg"
        title="Record screen as GIF"
      >
        ⏺ Record
      </button>
    {/if}

  </div>
</div>
