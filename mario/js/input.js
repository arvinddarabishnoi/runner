// Keyboard + on-screen touch buttons, merged into one per-frame snapshot.
const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'ArrowUp', 'KeyW', 'KeyZ'],
  run: ['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyJ'],
  pause: ['KeyP', 'Escape'],
  mute: ['KeyM'],
};
const PREVENT = new Set([...Object.values(KEYMAP).flat(), 'ArrowDown']);

export class Input {
  constructor(target = window) {
    this.down = new Set();    // physical keys currently held
    this.touch = new Set();   // on-screen buttons currently held
    this.edges = new Set();   // actions pressed since last endFrame()
    this.enabled = true;
    this._onDown = (e) => {
      if (!this.enabled) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        for (const [action, codes] of Object.entries(KEYMAP)) if (codes.includes(e.code)) this.edges.add(action);
      }
    };
    this._onUp = (e) => { this.down.delete(e.code); };
    this._onBlur = () => { this.down.clear(); this.touch.clear(); };
    target.addEventListener('keydown', this._onDown);
    target.addEventListener('keyup', this._onUp);
    target.addEventListener('blur', this._onBlur);
    this.target = target;
  }

  /** Bind on-screen buttons: <button data-action="left">. */
  bindTouch(root) {
    const buttons = root.querySelectorAll('[data-action]');
    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      const press = (e) => {
        e.preventDefault();
        this.touch.add(action);
        if (action === 'jump' || action === 'pause' || action === 'mute') this.edges.add(action);
      };
      const release = () => this.touch.delete(action);
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    });
  }

  held(action) {
    if (this.touch.has(action)) return true;
    return KEYMAP[action].some((c) => this.down.has(c));
  }

  /** Snapshot consumed by Game.update(). */
  snapshot() {
    return {
      left: this.held('left'),
      right: this.held('right'),
      run: this.held('run'),
      jumpHeld: this.held('jump'),
      jumpPressed: this.edges.has('jump'),
      pausePressed: this.edges.has('pause'),
      mutePressed: this.edges.has('mute'),
    };
  }

  /** Call once per frame after reading the snapshot. */
  endFrame() { this.edges.clear(); }

  destroy() {
    this.target.removeEventListener('keydown', this._onDown);
    this.target.removeEventListener('keyup', this._onUp);
    this.target.removeEventListener('blur', this._onBlur);
  }
}
