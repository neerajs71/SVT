/*!
 * virtual-mouse.js — drop-in mobile cursor emulator
 * Include anywhere with <script src="/virtual-mouse.js"></script>
 * On mobile a toggle button appears; tap it to enter mouse mode.
 * In mouse mode your finger moves a visible cursor and fires real
 * mouse events. Tap to click, tap-and-hold to drag.
 * Input / textarea / select elements always behave natively.
 */
(function () {
  'use strict';

  // Only activate on touch-capable devices
  if (!('ontouchstart' in window)) return;

  /* ── constants ──────────────────────────────────────────────── */
  const SKIP_TAGS   = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const HOLD_MS     = 300;   // ms before touch-hold becomes a drag
  const BTN_SIZE    = 34;    // toggle button px

  const DBLCLICK_MS  = 350;  // max ms between two taps for dblclick
  const DBLCLICK_PX  = 20;   // max pixel distance between the two taps

  /* ── state ──────────────────────────────────────────────────── */
  let mouseMode = false;
  let holdTimer  = null;
  let isDragging = false;
  let lastX = 0, lastY = 0;
  let lastTapTime = 0, lastTapX = 0, lastTapY = 0;

  /* ── cursor dot ─────────────────────────────────────────────── */
  const cursor = document.createElement('div');
  cursor.id = '__vm_cursor';
  Object.assign(cursor.style, {
    position:      'fixed',
    width:         '18px',
    height:        '18px',
    borderRadius:  '50%',
    background:    'rgba(0,0,0,0.55)',
    border:        '2px solid rgba(255,255,255,0.8)',
    boxShadow:     '0 0 4px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
    zIndex:        '2147483646',
    transform:     'translate(-50%,-50%)',
    display:       'none',
    transition:    'background 0.15s',
  });
  document.body.appendChild(cursor);

  /* ── toggle button ──────────────────────────────────────────── */
  const btn = document.createElement('button');
  btn.id = '__vm_toggle';
  btn.title = 'Toggle mouse mode';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"
         viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 0l16 12.279-6.951 1.17 4.325 8.373-1.496.772
               -4.325-8.373-3.553 5.023z"/>
    </svg>`;
  Object.assign(btn.style, {
    position:     'fixed',
    bottom:       '14px',
    right:        '58px',   /* sits left of the AI chat button (34px + 10px gap + 14px) */
    width:        BTN_SIZE + 'px',
    height:       BTN_SIZE + 'px',
    borderRadius: '50%',
    border:       'none',
    background:   '#1e293b',
    color:        '#fff',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    boxShadow:    '0 2px 10px rgba(0,0,0,0.35)',
    cursor:       'pointer',
    zIndex:       '2147483647',
    touchAction:  'none',
    userSelect:   'none',
    transition:   'background 0.2s, transform 0.15s',
  });
  document.body.appendChild(btn);

  function setActive(on) {
    mouseMode = on;
    cursor.style.display = on ? 'block' : 'none';
    btn.style.background = on ? '#2563eb' : '#1e293b';
    btn.style.transform  = on ? 'scale(1.1)' : 'scale(1)';
  }

  btn.addEventListener('touchend', e => {
    e.preventDefault();
    e.stopPropagation();
    setActive(!mouseMode);
  });

  /* ── helpers ────────────────────────────────────────────────── */
  function moveCursor(x, y) {
    lastX = x; lastY = y;
    cursor.style.left = x + 'px';
    cursor.style.top  = y + 'px';
  }

  function isNativeTarget(el) {
    if (!el) return false;
    // Always let native inputs handle their own events
    return SKIP_TAGS.has(el.tagName) || el.isContentEditable;
  }

  function fireAt(type, x, y, extra) {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true,
      clientX: x, clientY: y,
      screenX: x, screenY: y,
      view: window,
      ...extra,
    }));
  }

  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  }

  /* ── touch → mouse translation ──────────────────────────────── */
  document.addEventListener('touchstart', e => {
    if (!mouseMode) return;

    const t = e.touches[0];

    // Let native inputs keep native behaviour
    if (isNativeTarget(document.elementFromPoint(t.clientX, t.clientY))) return;

    e.preventDefault();
    isDragging = false;
    moveCursor(t.clientX, t.clientY);

    // Short tap → click; hold → drag start
    holdTimer = setTimeout(() => {
      isDragging = true;
      cursor.style.background = 'rgba(37,99,235,0.75)';
      fireAt('mousedown', lastX, lastY);
    }, HOLD_MS);

    fireAt('mousemove', t.clientX, t.clientY);
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!mouseMode) return;

    const t = e.touches[0];
    if (isNativeTarget(document.elementFromPoint(t.clientX, t.clientY))) return;

    e.preventDefault();
    cancelHold();          // moved too much — not a tap
    moveCursor(t.clientX, t.clientY);
    fireAt('mousemove', t.clientX, t.clientY);

    if (isDragging) {
      // Keep firing mousemove so drag handlers track correctly
      fireAt('mousemove', t.clientX, t.clientY, { buttons: 1 });
    }
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!mouseMode) return;

    const t = e.changedTouches[0];
    if (isNativeTarget(document.elementFromPoint(t.clientX, t.clientY))) return;

    e.preventDefault();

    if (isDragging) {
      // End drag
      fireAt('mouseup', t.clientX, t.clientY);
      isDragging = false;
      cursor.style.background = 'rgba(0,0,0,0.55)';
    } else {
      cancelHold();
      // Normal tap → click sequence
      fireAt('mousedown', t.clientX, t.clientY);
      fireAt('mouseup',   t.clientX, t.clientY);
      fireAt('click',     t.clientX, t.clientY);

      // Double-tap → dblclick
      const now = Date.now();
      const dx = t.clientX - lastTapX, dy = t.clientY - lastTapY;
      if (now - lastTapTime < DBLCLICK_MS &&
          Math.sqrt(dx*dx + dy*dy) < DBLCLICK_PX) {
        fireAt('dblclick', t.clientX, t.clientY);
        lastTapTime = 0;  // reset so triple-tap doesn't fire again
      } else {
        lastTapTime = now;
        lastTapX = t.clientX;
        lastTapY = t.clientY;
      }
    }
  }, { passive: false });

  document.addEventListener('touchcancel', e => {
    if (!mouseMode) return;
    cancelHold();
    isDragging = false;
    cursor.style.background = 'rgba(0,0,0,0.55)';
  }, { passive: false });

})();
