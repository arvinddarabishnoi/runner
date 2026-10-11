/**
 * Screen manager: menu, characters shop, settings, how-to, pause and
 * game-over. Handles the animated character preview and shop rendering.
 */
import { CHARACTERS } from '../core/config.js';
import { tintImage } from '../render/textures.js';
import * as save from '../core/save.js';

const $ = (id) => document.getElementById(id);

const TIPS = [
  'Slide to duck under a fireball — it flies at chest height.',
  'Tap once and the whole fire line is behind you: jump the low gaps.',
  'Vines and banners hang high: slide, do not jump.',
  'Statues and tiki idols are tall — switch lane instead of jumping.',
  'The golden idol is worth 500 points and 25 coins.',
  'Turbo smashes through obstacles — use it on a crowded stretch.',
  'Clipping the edge of an obstacle only makes you stumble… the beasts close in.',
  'A shield survives one hit, including a fireball.',
  'Magnet + Score ×2 is the richest combination in the game.',
  'The temple gets faster. So do you.',
];

/** Small canvas that plays the 4-frame run cycle for a character. */
export class CharPreview {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.frames = [];
    this.t = 0;
    this.i = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.setCharacter(CHARACTERS[0]);
  }

  setCharacter(cfg) {
    const frames = [];
    for (let i = 0; i < 4; i++) {
      const img = this.assets.images[`run_${i}`];
      if (!img) continue;
      frames.push(tintImage(img, { hue: cfg.hue, sat: cfg.sat, bright: cfg.bright, tint: cfg.tint }));
    }
    this.frames = frames;
    this.i = 0;
  }

  tick(dt) {
    if (!this.frames.length) return;
    this.t += dt;
    const fps = 9;
    const i = Math.floor(this.t * fps) % this.frames.length;
    if (i === this.i && this.drawn) return;
    this.i = i;
    this.drawn = true;
    const c = this.canvas;
    const w = c.width;
    const h = c.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    const img = this.frames[i];
    const scale = Math.min((w * 0.86) / img.width, (h * 0.94) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, h - dh - h * 0.03, dw, dh);
  }
}

export class Screens {
  constructor({ assets, on } = {}) {
    this.assets = assets;
    this.on = on || {};
    this.screens = {};
    for (const id of ['loading', 'menu', 'shop', 'settings', 'howto', 'pause', 'gameover']) {
      this.screens[id] = $(`screen-${id}`);
    }
    this.current = 'loading';
    this.preview = assets ? new CharPreview($('char-preview'), assets) : null;
    this.shopBuilt = false;
    this._wire();
  }

  show(name) {
    for (const key in this.screens) {
      const el = this.screens[key];
      if (!el) continue;
      const on = key === name;
      el.classList.toggle('visible', on);
      el.style.pointerEvents = on ? 'auto' : 'none';
    }
    this.current = name;
  }

  hideAll() { this.show(null); }

  // ----------------------------------------------------------------- menu
  syncSave() {
    const d = save.get();
    $('stat-best').textContent = d.best.toLocaleString();
    $('stat-dist').textContent = `${d.bestDistance.toLocaleString()} m`;
    $('stat-coins').textContent = d.coins.toLocaleString();
    $('btn-sound').textContent = d.sound || d.music ? '🔊' : '🔇';
    const cfg = CHARACTERS.find((c) => c.id === d.selected) || CHARACTERS[0];
    $('char-name').textContent = cfg.name;
    $('char-desc').textContent = cfg.desc;
    if (this.preview) this.preview.setCharacter(cfg);
    if ($('set-music')) {
      toggleState($('set-music'), d.music);
      toggleState($('set-sound'), d.sound);
      toggleState($('set-tilt'), d.tilt);
    }
  }

  setLoading(pct, text) {
    const fill = $('load-fill');
    if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
    if (text) $('load-hint').textContent = text;
  }

  // --------------------------------------------------------------- shop
  buildShop() {
    const grid = $('shop-grid');
    if (!grid) return;
    const d = save.get();
    grid.innerHTML = '';
    for (const cfg of CHARACTERS) {
      const owned = d.unlocked.includes(cfg.id);
      const selected = d.selected === cfg.id;
      const card = document.createElement('div');
      card.className = `shop-card ${selected ? 'selected' : ''} ${owned ? '' : 'locked'}`;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      card.appendChild(canvas);
      const name = document.createElement('b');
      name.textContent = cfg.name;
      const desc = document.createElement('small');
      desc.textContent = cfg.desc;
      card.appendChild(name);
      card.appendChild(desc);

      const btn = document.createElement('button');
      btn.className = owned ? (selected ? 'chip active' : 'btn') : 'btn';
      if (owned) {
        btn.textContent = selected ? 'Selected' : 'Select';
        btn.addEventListener('click', () => {
          save.set('selected', cfg.id);
          this.on.selectCharacter && this.on.selectCharacter(cfg);
          this.buildShop();
          this.syncSave();
        });
      } else {
        btn.innerHTML = `Unlock · ${cfg.cost.toLocaleString()} <img src="assets/sprites/coin.png" class="coin-icon small" alt="coins" style="vertical-align:-3px">`;
        btn.disabled = d.coins < cfg.cost;
        btn.addEventListener('click', () => {
          if (!save.spendCoins(cfg.cost)) { btn.disabled = true; return; }
          save.unlock(cfg.id);
          save.set('selected', cfg.id);
          this.on.selectCharacter && this.on.selectCharacter(cfg);
          this.on.buy && this.on.buy(cfg);
          this.buildShop();
          this.syncSave();
        });
      }
      card.appendChild(btn);
      grid.appendChild(card);

      // animated preview on the card
      const ctx = canvas.getContext('2d');
      const frames = [];
      for (let i = 0; i < 4; i++) {
        const img = this.assets && this.assets.images[`run_${i}`];
        if (img) frames.push(tintImage(img, { hue: cfg.hue, sat: cfg.sat, bright: cfg.bright, tint: cfg.tint }));
      }
      card._anim = { frames, ctx, t: Math.random() };
    }
    this._shopCards = [...grid.children];
  }

  tickShop(dt) {
    if (!this._shopCards) return;
    for (const card of this._shopCards) {
      const a = card._anim;
      if (!a || !a.frames.length) continue;
      a.t += dt;
      const img = a.frames[Math.floor(a.t * 9) % a.frames.length];
      const c = a.ctx.canvas;
      a.ctx.clearRect(0, 0, c.width, c.height);
      const s = Math.min((c.width * 0.8) / img.width, (c.height * 0.92) / img.height);
      a.ctx.drawImage(img, (c.width - img.width * s) / 2, c.height - img.height * s - 4, img.width * s, img.height * s);
    }
  }

  // ----------------------------------------------------------- game over
  showGameOver({ score, distance, coins, best, isRecord, reviveCost, canRevive, reason }) {
    $('go-score').textContent = score.toLocaleString();
    $('go-dist').textContent = `${distance.toLocaleString()} m`;
    $('go-coins').textContent = coins.toLocaleString();
    $('go-best').textContent = best.toLocaleString();
    const titles = {
      obstacle: ['CRASHED!', 'You slammed straight into the temple stone.'],
      fireball: ['BURNED!', 'A demon monkey fireball found you. Slide next time.'],
      howler: ['CAUGHT!', 'A demon monkey dragged you down.'],
    };
    const [title, sub] = titles[reason] || ['CAUGHT!', 'The temple beasts got you.'];
    $('go-title').textContent = isRecord ? 'NEW RECORD!' : title;
    $('go-sub').textContent = isRecord ? 'Best run yet — the temple is furious.' : sub;
    $('go-hint').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    const btn = $('btn-revive');
    $('revive-cost').textContent = reviveCost.toLocaleString();
    btn.disabled = !canRevive;
    btn.classList.toggle('hidden', !canRevive);
    this.show('gameover');
  }

  pauseStats(snap) {
    const el = $('pause-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="stat"><span class="label">SCORE</span><b>${snap.score.toLocaleString()}</b></div>
      <div class="stat"><span class="label">DISTANCE</span><b>${snap.distance.toLocaleString()} m</b></div>
      <div class="stat"><span class="label">COINS</span><b>${snap.coins}</b></div>`;
  }

  // -------------------------------------------------------------- wiring
  _wire() {
    const c = (id, fn, evt = 'click') => {
      const el = $(id);
      if (el) el.addEventListener(evt, (e) => { e.preventDefault(); fn(e); });
    };
    c('btn-play', () => this.on.play && this.on.play());
    c('btn-shop', () => { this.buildShop(); this.show('shop'); this.on.screen && this.on.screen('shop'); });
    c('btn-shop-back', () => { this.show('menu'); this.syncSave(); });
    c('btn-howto', () => this.show('howto'));
    c('btn-howto-back', () => this.show('menu'));
    c('btn-settings', () => { this.show('settings'); });
    c('btn-settings-back', () => { this.show(this._settingsReturn || 'menu'); });
    c('btn-pause-settings', () => { this._settingsReturn = 'pause'; this.show('settings'); });
    c('btn-pause-back', () => this.show('pause'));
    c('btn-sound', () => {
      const d = save.get();
      const on = !(d.sound && d.music);
      save.patch({ sound: on, music: on });
      this.on.toggleAudio && this.on.toggleAudio(on);
      this.syncSave();
    });
    c('set-music', () => {
      const d = save.get();
      save.set('music', !d.music);
      this.on.toggleMusic && this.on.toggleMusic(!d.music);
      this.syncSave();
    });
    c('set-sound', () => {
      const d = save.get();
      save.set('sound', !d.sound);
      this.on.toggleSound && this.on.toggleSound(!d.sound);
      this.syncSave();
    });
    c('set-tilt', () => {
      const d = save.get();
      save.set('tilt', !d.tilt);
      this.on.toggleTilt && this.on.toggleTilt(!d.tilt);
      this.syncSave();
    });
    const q = $('set-quality');
    if (q) {
      q.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-q]');
        if (!btn) return;
        [...q.children].forEach((b) => b.classList.toggle('active', b === btn));
        save.set('quality', btn.dataset.q);
        this.on.setQuality && this.on.setQuality(btn.dataset.q);
      });
    }
    c('btn-reset', () => {
      if (!confirm('Erase all progress (coins, unlocks, records)?')) return;
      save.resetAll();
      this.syncSave();
      this.buildShop();
      this.on.reset && this.on.reset();
    });

    c('btn-resume', () => this.on.resume && this.on.resume());
    c('btn-restart', () => this.on.restart && this.on.restart());
    c('btn-quit', () => this.on.quit && this.on.quit());
    c('btn-revive', () => this.on.revive && this.on.revive());
    c('btn-again', () => this.on.restart && this.on.restart());
    c('btn-menu', () => this.on.quit && this.on.quit());

    // sync initial quality chips
    const d = save.get();
    const q2 = $('set-quality');
    if (q2) [...q2.children].forEach((b) => b.classList.toggle('active', b.dataset.q === d.quality));
  }
}

function toggleState(btn, on) {
  btn.dataset.on = on ? 'true' : 'false';
  btn.textContent = on ? 'ON' : 'OFF';
}
