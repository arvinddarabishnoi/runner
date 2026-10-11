/**
 * Procedural audio engine: all SFX and the soundtrack are synthesized with
 * WebAudio (no audio files needed). The music is a generative "jungle temple"
 * groove that gains layers as the run gets faster and shifts mood per zone.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.soundOn = true;
    this.musicOn = true;
    this.intensity = 0;
    this.zone = 'jungle';
    this._timer = null;
    this._step = 0;
    this._nextTime = 0;
    this._bpm = 126;
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.soundOn ? 0.9 : 0;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // gentle reverb-ish feedback delay for leads
    this.delay = ctx.createDelay(0.5);
    this.delay.delayTime.value = 0.22;
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.32;
    this.delay.connect(this.fb); this.fb.connect(this.delay);
    this.delay.connect(this.musicBus);
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setSound(on) { this.soundOn = on; if (this.sfxBus) this.sfxBus.gain.value = on ? 0.9 : 0; }
  setMusic(on) {
    this.musicOn = on;
    if (!this.musicBus) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.linearRampToValueAtTime(on ? 0.5 : 0, t + 0.4);
  }

  // ---------------------------------------------------------------- helpers
  _tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.2, gain = 0.2, at = 0, detune = 0, bus = null, curve = 'exp' }) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 != null && f1 !== f0) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      else osc.frequency.linearRampToValueAtTime(Math.max(20, f1), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(bus || this.sfxBus);
    osc.start(t); osc.stop(t + dur + 0.03);
  }

  _noise({ dur = 0.2, gain = 0.2, at = 0, type = 'lowpass', f0 = 2000, f1 = null, q = 1, bus = null, attack = 0.005 }) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.setValueAtTime(f0, t); filt.Q.value = q;
    if (f1 != null) filt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(bus || this.sfxBus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------- sfx
  play(name, opt = {}) {
    if (!this.ready || !this.soundOn) return;
    const p = opt.pitch || 0; // semitone offset
    const r = (s) => 1 * Math.pow(2, (p + s) / 12);
    switch (name) {
      case 'jump':
        this._tone({ type: 'triangle', f0: 320 * r(0), f1: 700 * r(0), dur: 0.18, gain: 0.16 });
        this._noise({ dur: 0.12, gain: 0.05, f0: 900, f1: 300 });
        break;
      case 'land':
        this._noise({ dur: 0.16, gain: 0.14, f0: 420, f1: 90 });
        this._tone({ type: 'sine', f0: 140, f1: 70, dur: 0.14, gain: 0.14 });
        break;
      case 'slide':
        this._noise({ dur: 0.4, gain: 0.14, f0: 2600, f1: 320, q: 1.4 });
        break;
      case 'coin': {
        const k = Math.min(opt.combo || 0, 14);
        this._tone({ type: 'sine', f0: 880 * r(k), dur: 0.075, gain: 0.13 });
        this._tone({ type: 'sine', f0: 1318 * r(k), dur: 0.14, gain: 0.11, at: 0.055 });
        break;
      }
      case 'gem':
        this._tone({ type: 'sine', f0: 1046, dur: 0.1, gain: 0.13 });
        this._tone({ type: 'sine', f0: 1568, dur: 0.16, gain: 0.12, at: 0.07 });
        this._tone({ type: 'sine', f0: 2093, dur: 0.22, gain: 0.1, at: 0.14 });
        break;
      case 'powerup': {
        const notes = [523, 659, 784, 1046];
        notes.forEach((f, i) => this._tone({ type: 'triangle', f0: f, dur: 0.22, gain: 0.13, at: i * 0.06 }));
        break;
      }
      case 'shield':
        this._tone({ type: 'sine', f0: 700, f1: 1500, dur: 0.3, gain: 0.1 });
        this._noise({ dur: 0.3, gain: 0.06, type: 'highpass', f0: 2200 });
        break;
      case 'hit':
        this._noise({ dur: 0.34, gain: 0.3, f0: 1400, f1: 120 });
        this._tone({ type: 'sawtooth', f0: 220, f1: 55, dur: 0.4, gain: 0.22 });
        this._tone({ type: 'sine', f0: 90, f1: 40, dur: 0.5, gain: 0.24 });
        break;
      case 'growl':
        this._tone({ type: 'sawtooth', f0: 110, f1: 74, dur: 0.9, gain: 0.16 });
        this._tone({ type: 'sawtooth', f0: 55, f1: 37, dur: 1.1, gain: 0.14 });
        this._noise({ dur: 0.7, gain: 0.07, f0: 300, f1: 140, q: 4 });
        break;
      case 'magic':
        this._noise({ dur: 0.5, gain: 0.08, type: 'highpass', f0: 1200, f1: 4200 });
        [880, 1174, 1568, 2093].forEach((f, i) =>
          this._tone({ type: 'sine', f0: f, dur: 0.3, gain: 0.07, at: i * 0.05 }));
        break;
      case 'idol': {
        const notes = [392, 523, 659, 784, 1046];
        notes.forEach((f, i) => this._tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.14, at: i * 0.09 }));
        this._noise({ dur: 0.7, gain: 0.07, type: 'highpass', f0: 3000 });
        break;
      }
      case 'gameover': {
        const notes = [440, 415, 392, 330];
        notes.forEach((f, i) => {
          this._tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.15, at: i * 0.18 });
          this._tone({ type: 'sine', f0: f / 2, dur: 0.7, gain: 0.12, at: i * 0.18 });
        });
        break;
      }
      case 'revive':
        [262, 330, 392, 523, 659].forEach((f, i) =>
          this._tone({ type: 'triangle', f0: f, dur: 0.4, gain: 0.13, at: i * 0.07 }));
        break;
      case 'button':
        this._tone({ type: 'square', f0: 660, f1: 880, dur: 0.07, gain: 0.07 });
        break;
      case 'zone': {
        this._tone({ type: 'sine', f0: 98, f1: 98, dur: 1.6, gain: 0.2 });
        this._tone({ type: 'sine', f0: 147, f1: 146, dur: 1.4, gain: 0.12 });
        this._noise({ dur: 1.2, gain: 0.06, type: 'lowpass', f0: 900, f1: 200 });
        break;
      }
      case 'whoosh':
        this._noise({ dur: 0.5, gain: 0.1, type: 'bandpass', f0: 400, f1: 2600, q: 1.2 });
        break;
      case 'fire':
        this._noise({ dur: 0.35, gain: 0.09, type: 'lowpass', f0: 1800, f1: 500 });
        break;
      default: break;
    }
  }

  // ----------------------------------------------------------------- music
  _chordFor(bar) {
    // Am – F – C – G  (two bars each)  -> jungle-temple mood
    const prog = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 261.63], [196, 233.08, 293.66]];
    return prog[Math.floor(bar / 2) % prog.length];
  }

  _pent() {
    // A minor pentatonic across two octaves
    return [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 784];
  }

  startMusic() {
    if (!this.ready || this._timer) return;
    this._step = 0;
    this._nextTime = this.ctx.currentTime + 0.08;
    this.setMusic(this.musicOn);
    this._timer = setInterval(() => this._scheduler(), 25);
  }

  stopMusic(fade = 0.6) {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.musicBus) {
      const t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
      this.musicBus.gain.linearRampToValueAtTime(0, t + fade);
    }
  }

  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }
  setZone(zone) { this.zone = zone; }

  _scheduler() {
    if (!this.ctx) return;
    const spb = 60 / this._bpm / 4; // 16th note
    while (this._nextTime < this.ctx.currentTime + 0.12) {
      this._scheduleStep(this._step, this._nextTime - this.ctx.currentTime);
      this._step++;
      this._nextTime += spb;
    }
  }

  _scheduleStep(step, at) {
    const s = step % 32;
    const bar = Math.floor(step / 16);
    const I = this.intensity;
    const ch = this._chordFor(bar);
    const bus = this.musicBus;
    const dark = this.zone === 'temple' ? -2 : 0;

    // --- percussion
    if (s % 4 === 0) this._kick(at);
    if (s === 4 || s === 12 || s === 20 || s === 28) this._clap(at, 0.06 + 0.04 * I);
    if (s % 2 === 1 && I > 0.12) this._shaker(at, 0.02 + 0.035 * I);
    if (I > 0.6 && (s === 6 || s === 14 || s === 22 || s === 30)) this._tom(at, 0.05 + 0.05 * I);

    // --- bass
    const bassPat = [0, 0, 7, 0, 0, 0, 3, 0, 0, 0, 7, 0, 5, 0, 3, 0];
    const root = ch[0] / 2;
    if (s % 2 === 0 || I > 0.45) {
      const semi = bassPat[s % 16];
      const f = root * Math.pow(2, (semi + dark) / 12);
      this._musicVoice({ type: 'triangle', f0: f, dur: 0.22, gain: 0.16 + 0.06 * I, at, bus, lp: 420 });
    }

    // --- pad on each bar
    if (s === 0) {
      ch.forEach((f, i) => this._musicVoice({
        type: 'sawtooth', f0: f * (dark ? 0.5 : 1), dur: 1.6, gain: 0.035 + 0.02 * I, at,
        bus, lp: 1200, detune: (i - 1) * 7, attack: 0.35, pad: true,
      }));
    }

    // --- melody (marimba-ish) once things get going
    if (I > 0.3) {
      const mel = [0, 3, 5, 7, 5, 3, 2, 0, 0, 5, 7, 8, 7, 5, 3, 5];
      if (s % 2 === 0) {
        const p = mel[(s / 2) % mel.length];
        const notes = this._pent();
        const idx = (p + (bar % 2 === 0 ? 3 : 1)) % notes.length;
        const f = notes[idx] * (this.zone === 'temple' ? 0.5 : 1);
        this._musicVoice({ type: 'sine', f0: f, dur: 0.34, gain: 0.10 + 0.05 * I, at, bus, lp: 4000, send: 0.35, fm: f * 3.01 });
      }
    }
    // --- 16th sparkle arps at full intensity
    if (I > 0.75 && s % 4 === 3) {
      const notes = this._pent();
      const f = notes[(step * 3) % notes.length] * 2;
      this._musicVoice({ type: 'triangle', f0: f, dur: 0.14, gain: 0.05, at, bus, lp: 6000, send: 0.5 });
    }
  }

  _kick(at) {
    const ctx = this.ctx; const t = ctx.currentTime + at;
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(g); g.connect(this.musicBus);
    osc.start(t); osc.stop(t + 0.26);
  }

  _clap(at, gain) {
    this._noise({ dur: 0.16, gain, at, type: 'bandpass', f0: 1500, q: 1.1, bus: this.musicBus, attack: 0.002 });
  }

  _shaker(at, gain) {
    this._noise({ dur: 0.06, gain, at, type: 'highpass', f0: 5200, bus: this.musicBus, attack: 0.002 });
  }

  _tom(at, gain) {
    this._tone({ type: 'sine', f0: 220, f1: 130, dur: 0.22, gain, at, bus: this.musicBus });
  }

  _musicVoice({ type, f0, dur, gain, at, bus, lp = 3000, detune = 0, attack = 0.006, send = 0.15, fm = 0, pad = false }) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type; osc.detune.value = detune;
    osc.frequency.setValueAtTime(f0, t);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = lp; filt.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let mod = null;
    if (fm) {
      mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = fm;
      const mg = ctx.createGain(); mg.gain.value = f0 * 1.6;
      mod.connect(mg); mg.connect(osc.frequency);
      mod.start(t); mod.stop(t + dur + 0.05);
    }
    osc.connect(filt); filt.connect(g); g.connect(bus);
    if (send > 0 && this.delay) { const sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(this.delay); }
    osc.start(t); osc.stop(t + dur + 0.05);
  }
}
