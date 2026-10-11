/**
 * Input: keyboard, swipe/tap (pointer + touch), and optional tilt steering.
 * Swipes are direction-locked so a diagonal flick still reads clearly.
 */
const SWIPE_MIN = 26;          // px
const TAP_MAX = 220;           // ms
const TAP_MOVE = 14;           // px

export class Input {
  constructor({ target = window, canvas = document.body, onAction = () => {}, onPause = () => {}, onFirstTouch = () => {} } = {}) {
    this.onAction = onAction;
    this.onPause = onPause;
    this.onFirstTouch = onFirstTouch;
    this.canvas = canvas;
    this.enabled = true;
    this.tiltEnabled = false;
    this.tiltBaseline = null;
    this.tiltArmed = true;
    this._touches = new Map();
    this._handlers = [];
    this._bind(target);
  }

  _add(el, evt, fn, opts) {
    el.addEventListener(evt, fn, opts);
    this._handlers.push([el, evt, fn, opts]);
  }

  _bind(target) {
    // ------------------------------------------------------------ keyboard
    this._add(window, 'keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
      this.onFirstTouch();
      if (!this.enabled) {
        if (k === 'p' || k === 'escape') this.onPause();
        return;
      }
      switch (k) {
        case 'arrowleft': case 'a': case 'q': this.onAction('left'); break;
        case 'arrowright': case 'd': this.onAction('right'); break;
        case 'arrowup': case 'w': case 'z': case ' ': this.onAction('jump'); break;
        case 'arrowdown': case 's': this.onAction('slide'); break;
        case 'p': case 'escape': this.onPause(); break;
        default: break;
      }
    }, { passive: false });

    // --------------------------------------------------- pointer / touch
    const down = (e) => {
      this.onFirstTouch();
      const id = e.pointerId != null ? e.pointerId : 'mouse';
      this._touches.set(id, { x: e.clientX, y: e.clientY, t: performance.now(), used: false });
    };
    const move = (e) => {
      const id = e.pointerId != null ? e.pointerId : 'mouse';
      const t = this._touches.get(id);
      if (!t || t.used || !this.enabled) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
      t.used = true;
      if (Math.abs(dx) > Math.abs(dy)) this.onAction(dx > 0 ? 'right' : 'left');
      else this.onAction(dy > 0 ? 'slide' : 'jump');
    };
    const up = (e) => {
      const id = e.pointerId != null ? e.pointerId : 'mouse';
      const t = this._touches.get(id);
      this._touches.delete(id);
      if (!t || t.used || !this.enabled) return;
      const dt = performance.now() - t.t;
      const dist = Math.hypot(e.clientX - t.x, e.clientY - t.y);
      if (dt < TAP_MAX && dist < TAP_MOVE) this.onAction('jump');   // tap = jump
    };
    this._add(this.canvas, 'pointerdown', down, { passive: true });
    this._add(window, 'pointermove', move, { passive: true });
    this._add(window, 'pointerup', up, { passive: true });
    this._add(window, 'pointercancel', up, { passive: true });

    // ------------------------------------------------------------ tilt
    this._tilt = (e) => {
      if (!this.tiltEnabled || !this.enabled) return;
      const g = e.gamma; // -90..90 left/right
      if (g == null) return;
      if (this.tiltBaseline == null) this.tiltBaseline = g;
      const rel = g - this.tiltBaseline;
      if (Math.abs(rel) < 11) { this.tiltArmed = true; return; }
      if (!this.tiltArmed) return;
      this.tiltArmed = false;
      this.onAction(rel > 0 ? 'right' : 'left');
      // re-centre so a held tilt keeps working naturally
      this.tiltBaseline = g - Math.sign(rel) * 8;
    };
    this._add(window, 'deviceorientation', this._tilt);
  }

  setTilt(on) {
    this.tiltEnabled = !!on;
    if (!on) this.tiltBaseline = null;
    if (on && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  }

  /** Re-centre the tilt control (called when a run starts). */
  recentreTilt() { this.tiltBaseline = null; this.tiltArmed = true; }

  setEnabled(on) { this.enabled = !!on; }

  dispose() {
    for (const [el, evt, fn, opts] of this._handlers) el.removeEventListener(evt, fn, opts);
    this._handlers.length = 0;
  }
}
