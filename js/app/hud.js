/**
 * In-run HUD: score, distance, coins, combo, power-up timers, zone banners,
 * toasts, boost vignette, hit flash and the first-run tutorial.
 * All DOM writes are diffed so we never touch the layout needlessly.
 */
import { POWERUPS } from '../core/config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      score: $('score'), distance: $('distance'), coins: $('coins'),
      coinBlock: document.querySelector('.coin-block'),
      combo: $('combo'), comboMult: $('combo-mult'), comboFill: $('combo-bar-fill'),
      powers: $('powers'), banner: $('zone-banner'), bannerName: $('zone-name'), bannerSub: $('zone-sub'),
      toasts: $('toasts'), record: $('record-banner'), tutorial: $('tutorial'),
      boost: $('boost-vignette'), flash: $('hit-flash'),
    };
    this._last = { score: -1, coins: -1, distance: -1, combo: -1, comboPct: -1 };
    this._powerEls = new Map();
    this._bannerTimer = null;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  update(snap) {
    const score = snap.score | 0;
    if (score !== this._last.score) { this.el.score.textContent = score.toLocaleString(); this._last.score = score; }
    const dist = `${(snap.distance | 0).toLocaleString()} m`;
    const dnum = snap.distance | 0;
    if (dnum !== this._last.distance) { this.el.distance.textContent = dist; this._last.distance = dnum; }
    if (snap.coins !== this._last.coins) {
      this.el.coins.textContent = snap.coins.toLocaleString();
      this._last.coins = snap.coins;
      this.el.coinBlock.classList.remove('bump');
      void this.el.coinBlock.offsetWidth;
      this.el.coinBlock.classList.add('bump');
    }
    // combo
    const showCombo = snap.combo >= 8;
    this.el.combo.classList.toggle('hidden', !showCombo);
    if (showCombo) {
      const mult = Math.max(2, Math.floor(snap.combo / 8) + 1);
      if (mult !== this._last.combo) { this.el.comboMult.textContent = `x${mult}`; this._last.combo = mult; }
    }
    this._renderPowers(snap.power);
  }

  _renderPowers(power) {
    const specs = [
      ['magnet', power.magnet, POWERUPS.magnet],
      ['boost', power.boost, POWERUPS.boost],
      ['x2', power.x2, POWERUPS.x2],
    ];
    for (const [key, time, cfg] of specs) {
      let el = this._powerEls.get(key);
      const active = time > 0;
      if (active && !el) {
        el = document.createElement('div');
        el.className = 'power';
        el.innerHTML = `<span class="dot" style="background:${dotColor(key)}">${iconFor(key)}</span>
          <span class="bar"><i></i></span><span>${cfg.label}</span>`;
        this.el.powers.appendChild(el);
        this._powerEls.set(key, el);
      }
      if (el) {
        if (!active) {
          el.remove();
          this._powerEls.delete(key);
        } else {
          el.querySelector('i').style.width = `${Math.max(0, Math.min(100, (time / cfg.time) * 100))}%`;
        }
      }
    }
    // shield is boolean
    let sh = this._powerEls.get('shield');
    if (power.shield && !sh) {
      sh = document.createElement('div');
      sh.className = 'power';
      sh.innerHTML = `<span class="dot" style="background:#62c8ff">⛨</span><span>Shield ready</span>`;
      this.el.powers.appendChild(sh);
      this._powerEls.set('shield', sh);
    } else if (!power.shield && sh) {
      sh.remove();
      this._powerEls.delete('shield');
    }
  }

  toast(text, ms = 2200) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), ms);
    if (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  zoneBanner(name, sub = '') {
    this.el.bannerName.textContent = name;
    this.el.bannerSub.textContent = sub;
    this.el.banner.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.el.banner.classList.remove('show'), 2600);
  }

  setRecord(on) { this.el.record.classList.toggle('hidden', !on); }

  setBoost(on) { this.el.boost.classList.toggle('on', !!on); }

  flashHit() {
    this.el.flash.classList.remove('on');
    void this.el.flash.offsetWidth;
    this.el.flash.classList.add('on');
  }

  tutorial(on) { this.el.tutorial.classList.toggle('hidden', !on); }
}

function dotColor(key) {
  return { magnet: '#ff6a4a', boost: '#ffd24a', x2: '#a8ff6a', shield: '#62c8ff' }[key] || '#ffd24a';
}
function iconFor(key) {
  return { magnet: '⌾', boost: '⚡', x2: '2x' }[key] || '★';
}
