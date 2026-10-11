// Sound effects (Kenney CC0 .ogg files) plus a tiny synthesized chiptune loop.
// The music is generated with WebAudio, so the repo ships no music files.
const NOTE = { C3: 131, D3: 147, E3: 165, F3: 175, G3: 196, A3: 220, B3: 247, C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, C5: 523, D5: 587, E5: 659, G5: 784, _: 0 };

// 2 bars of a bouncy 4/4 melody (16 eighth notes) over a walking bass.
const LEAD = ['E5', '_', 'G5', '_', 'E5', '_', 'C5', '_', 'D5', '_', 'E5', '_', 'C5', '_', 'A4', '_'];
const BASS = ['C3', 'C3', 'G3', 'G3', 'A3', 'A3', 'E3', 'E3', 'F3', 'F3', 'C3', 'C3', 'G3', 'G3', 'D3', 'D3'];

export class SoundBank {
  constructor(sounds) {
    this.sounds = sounds;
    this.muted = false;
    this.ctx = null;
    this.timer = null;
    this.step = 0;
    this.nextTime = 0;
    this.musicOn = false;
  }

  play(name, volume = 0.6) {
    if (this.muted) return;
    const base = this.sounds[name];
    if (!base) return;
    const a = base.cloneNode ? base.cloneNode() : base;
    a.volume = volume;
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.#schedule(), 60);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  #schedule() {
    const ctx = this.ctx;
    const stepDur = 60 / 132 / 2; // 132 bpm, eighth notes
    while (this.nextTime < ctx.currentTime + 0.15) {
      const i = this.step % LEAD.length;
      this.#tone(NOTE[LEAD[i]], this.nextTime, stepDur * 0.85, 'square', 0.035);
      this.#tone(NOTE[BASS[i]], this.nextTime, stepDur * 0.9, 'triangle', 0.09);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  #tone(freq, t, dur, type, vol) {
    if (!freq) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
