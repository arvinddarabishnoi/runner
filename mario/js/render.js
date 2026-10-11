// Canvas renderer. Reads the Game object; never mutates gameplay state.
import { TILE, VIEW_W, VIEW_H } from './config.js';
import { tileAt } from './level.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const THEMES = {
  grass: { top: '#5cb8ff', bottom: '#d6f1ff', bg: 'bgGrass' },
  castle: { top: '#1d2140', bottom: '#4b4f78', bg: 'bgCastle' },
};

export class Renderer {
  constructor(canvas, images) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = images;
    this.camX = 0;
    this.camY = 0;
    this.shake = 0;
    this.floats = [];
    this.time = 0;
  }

  resetCamera() { this.camX = 0; this.camY = 0; this.floats = []; this.shake = 0; }

  addFloat(text, x, y) { this.floats.push({ text, x, y, t: 0 }); }

  triggerShake(amount) { this.shake = Math.max(this.shake, amount); }

  draw(game, dt) {
    const ctx = this.ctx;
    const L = game.level;
    const hero = game.hero;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt);

    // smooth chase camera
    const tx = clamp(hero.x + hero.w / 2 - VIEW_W * 0.45, 0, Math.max(0, L.pxW - VIEW_W));
    const ty = clamp(hero.y + hero.h / 2 - VIEW_H * 0.55, 0, Math.max(0, L.pxH - VIEW_H));
    const k = Math.min(1, dt * 10);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    const ox = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 18 : 0;
    const oy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 18 : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    this.#background(L);

    ctx.save();
    ctx.translate(-Math.round(this.camX) + ox, -Math.round(this.camY) + oy);
    this.#tiles(L);
    this.#goal(L);
    for (const c of L.coins) if (!c.taken) this.#coin(c.x, c.y, c.w, c.h, this.time);
    for (const p of game.popups) this.#coin(p.x, p.y, 26, 26, this.time, 1 - p.t / 0.55);
    for (const m of game.mushrooms) this.#image('mushroomRed', m.x, m.y, 42, 42);
    for (const e of game.enemies) this.#enemy(e);
    for (const d of game.debris) this.#debris(d);
    this.#hero(game.hero);
    ctx.restore();

    this.#floats(dt);
  }

  // ---------- background ----------
  #background(L) {
    const ctx = this.ctx;
    const theme = THEMES[L.theme] ?? THEMES.grass;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, theme.top);
    g.addColorStop(1, theme.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const bg = this.img[theme.bg];
    if (bg) {
      const s = VIEW_H / bg.naturalHeight * 1.0;
      const tw = bg.naturalWidth * s;
      const off = -((this.camX * 0.15) % tw);
      for (let x = off - tw; x < VIEW_W + tw; x += tw) ctx.drawImage(bg, Math.round(x), 0, Math.ceil(tw), VIEW_H);
    }

    // clouds (far)
    this.#parallax('cloud1', 0.25, 430, (k) => 60 + (k % 3) * 34, 1.1);
    this.#parallax('cloud2', 0.35, 560, (k) => 130 + (k % 2) * 40, 1.0);
    // hills (near), standing on the ground line
    const groundY = L.rowCount >= 10 ? (10 * TILE) - this.camY : VIEW_H - TILE;
    this.#parallax(null, 0.5, 340, () => 0, 0, (k, x) => {
      const img = this.img[k % 2 ? 'hillLarge' : 'hillSmall'];
      if (!img) return;
      const s = 2;
      ctx.drawImage(img, x, groundY + 20 - img.naturalHeight * s + 20, img.naturalWidth * s, img.naturalHeight * s);
    });
  }

  #parallax(key, factor, spacing, yFn, scale, custom) {
    const ctx = this.ctx;
    const img = key ? this.img[key] : null;
    const shift = this.camX * factor;
    const k0 = Math.floor(shift / spacing) - 1;
    const k1 = k0 + Math.ceil(VIEW_W / spacing) + 3;
    for (let k = k0; k <= k1; k++) {
      const x = Math.round(k * spacing - shift + ((k * 97) % 60) - 30);
      if (custom) { custom(k, x); continue; }
      if (img) ctx.drawImage(img, x, yFn(k), img.naturalWidth * scale, img.naturalHeight * scale);
    }
  }

  // ---------- world ----------
  #tiles(L) {
    const tx0 = Math.max(0, Math.floor(this.camX / TILE) - 1);
    const tx1 = Math.min(L.cols - 1, Math.ceil((this.camX + VIEW_W) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(this.camY / TILE) - 1);
    const ty1 = Math.min(L.rowCount - 1, Math.ceil((this.camY + VIEW_H) / TILE) + 1);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = L.grid[ty][tx];
        if (c === '.') continue;
        this.#cell(L, c, tx, ty);
      }
    }
  }

  #cell(L, c, tx, ty) {
    const x = tx * TILE, y = ty * TILE;
    switch (c) {
      case '#': case '=': {
        // Pick edge/centre art from the neighbours; grass caps dirt that has air above it.
        const same = (ax, ay) => tileAt(L, ax, ay) === c;
        const leftEdge = !same(tx - 1, ty);
        const rightEdge = !same(tx + 1, ty);
        const side = c === '#' ? 'dirt' : 'stone';
        if (c === '#' && !same(tx, ty - 1)) {
          this.#image(rightEdge && !leftEdge ? 'grassRight' : leftEdge && !rightEdge ? 'grassLeft' : 'grassMid', x, y, TILE, TILE);
          return;
        }
        const key = leftEdge && !rightEdge ? `${side}Left` : rightEdge && !leftEdge ? `${side}Right` : (c === '#' ? 'dirtCenter' : 'stoneMid');
        this.#image(key, x, y, TILE, TILE);
        return;
      }
      case 'B': this.#image('brickWall', x, y, TILE, TILE); return;
      case '?': this.#image('boxItem', x, y, TILE, TILE); return;
      case 'M': this.#image('boxItemAlt', x, y, TILE, TILE); return;
      case 'x': this.#image('boxEmpty', x, y, TILE, TILE); return;
      case 'w': this.#image('spikes', x, y, TILE, TILE); return;
      case 'P': this.#pipe(L, tx, ty); return;
      default: return;
    }
  }

  #pipe(L, tx, ty) {
    const ctx = this.ctx;
    const x = tx * TILE, y = ty * TILE;
    const capped = tileAt(L, tx, ty - 1) !== 'P';
    const bodyY = capped ? y + 16 : y;
    const g = ctx.createLinearGradient(x, 0, x + TILE, 0);
    g.addColorStop(0, '#1f7a2a'); g.addColorStop(0.35, '#51c35a'); g.addColorStop(1, '#17571f');
    ctx.fillStyle = g;
    ctx.fillRect(x + 6, bodyY, TILE - 12, y + TILE - bodyY);
    if (capped) {
      ctx.fillStyle = g;
      ctx.fillRect(x - 3, y, TILE + 6, 16);
      ctx.strokeStyle = '#0f3d15';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 3, y, TILE + 6, 16);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 10, bodyY + 2, 5, y + TILE - bodyY - 2);
  }

  #goal(L) {
    const ctx = this.ctx;
    const tops = new Set();
    for (let ty = 0; ty < L.rowCount; ty++) for (let tx = 0; tx < L.cols; tx++) {
      if (L.grid[ty][tx] !== 'F') continue;
      const x = tx * TILE + TILE / 2;
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(x - 3, ty * TILE, 6, TILE);
      ctx.strokeStyle = '#7a7a7a'; ctx.lineWidth = 1;
      ctx.strokeRect(x - 3.5, ty * TILE, 7, TILE);
      if (tileAt(L, tx, ty - 1) !== 'F' && !tops.has(tx)) {
        tops.add(tx);
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath(); ctx.arc(x, ty * TILE + 2, 6, 0, Math.PI * 2); ctx.fill();
        this.#image('flagGreen', x + 2, ty * TILE + 4, 40, 40);
      }
    }
  }

  #coin(x, y, w, h, t, fade = 1) {
    const ctx = this.ctx;
    const img = this.img.coinGold;
    if (!img) return;
    const cx = x + w / 2;
    const squash = Math.max(0.15, Math.abs(Math.cos(t * 5 + x * 0.03)));
    const dw = 26 * squash;
    ctx.globalAlpha = Math.max(0, fade);
    ctx.drawImage(img, cx - dw / 2, y + h / 2 - 13 + Math.sin(t * 4 + x) * 2, dw, 26);
    ctx.globalAlpha = 1;
  }

  #enemy(e) {
    const kind = e.kind;
    const anim = Math.floor(e.animT * 5) % 2;
    let key;
    if (kind === 'slime') key = e.alive ? (anim ? 'slimeWalk2' : 'slimeWalk1') : 'slimeDead';
    else if (kind === 'snail') key = e.alive ? (anim ? 'snailWalk2' : 'snailWalk1') : 'snailShell';
    else key = e.alive ? (anim ? 'flyFly2' : 'flyFly1') : 'flyDead';
    const img = this.img[key];
    if (!img) return;
    const s = 0.8;
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    const ctx = this.ctx;
    const cx = e.x + e.w / 2;
    const bottom = e.y + e.h;
    ctx.save();
    ctx.translate(cx, bottom);
    if (e.dir > 0) ctx.scale(-1, 1);
    ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx.restore();
  }

  #debris(d) {
    const ctx = this.ctx;
    const img = this.img[d.img];
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - d.t / 0.9);
    ctx.translate(d.x + 10, d.y + 7);
    ctx.rotate(d.rot);
    ctx.drawImage(img, -img.naturalWidth * 0.8, -img.naturalHeight * 0.8, img.naturalWidth * 1.6, img.naturalHeight * 1.6);
    ctx.restore();
  }

  #hero(hero) {
    const ctx = this.ctx;
    let key;
    if (hero.dead) key = 'hurt';
    else if (!hero.onGround) key = 'jump';
    else if (Math.abs(hero.vx) > 25) key = `walk${(Math.floor(hero.animT * 14) % 11) + 1}`;
    else key = 'stand';
    const img = this.img[key];
    if (!img) return;
    const s = hero.big ? 0.82 : 0.62;
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    const cx = hero.x + hero.w / 2;
    const bottom = hero.y + hero.h;
    const blink = hero.invuln > 0 && Math.floor(hero.animT * 18) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.translate(cx, bottom);
    if (hero.facing < 0) ctx.scale(-1, 1);
    ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx.restore();
  }

  #image(key, x, y, w, h, flip = false) {
    const img = this.img[key];
    if (!img) return;
    const ctx = this.ctx;
    if (flip) {
      ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, w, h); ctx.restore();
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
  }

  #floats(dt) {
    const ctx = this.ctx;
    this.floats = this.floats.filter((f) => (f.t += dt) < 0.9);
    ctx.save();
    ctx.font = 'bold 18px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      const sx = f.x - this.camX, sy = f.y - this.camY - f.t * 60;
      ctx.globalAlpha = Math.max(0, 1 - f.t / 0.9);
      ctx.lineWidth = 4; ctx.strokeStyle = '#1b1b1b';
      ctx.strokeText(f.text, sx, sy);
      ctx.fillStyle = '#fff6a8';
      ctx.fillText(f.text, sx, sy);
    }
    ctx.restore();
  }
}
