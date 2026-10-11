/**
 * Pooled particle / sprite FX system.
 * Everything is pre-allocated and recycled — no per-frame allocation, no GC hits.
 */
import * as THREE from '../../vendor/three.module.js';
import { makeBlobTexture, makeShadowTexture } from './textures.js';

const DEG = Math.PI / 180;

class Pool {
  constructor(factory, size) {
    this.items = [];
    this.free = [];
    for (let i = 0; i < size; i++) {
      const it = factory();
      it.alive = false;
      it.visible = false;
      this.items.push(it);
      this.free.push(it);
    }
  }
  take() { return this.free.pop() || null; }
  release(it) { it.alive = false; it.visible = false; this.free.push(it); }
}

export class FX {
  constructor(scene, assets, quality = 1) {
    this.scene = scene;
    this.assets = assets;
    this.q = quality;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.blobTex = this.assets.tex('glow') || makeBlobTexture();
    this.dustTex = this.assets.tex('dust') || makeBlobTexture();
    this.sparkTex = this.assets.tex('spark') || makeBlobTexture();
    this.flameTex = this.assets.tex('flame');
    this.streakTex = this.assets.tex('streak');
    this.coinTex = this.assets.tex('coin');
    this.fireTex = this.assets.tex('fireball');
    this.shadowTex = this.assets.tex('shadow') || makeShadowTexture();

    const n = (base) => Math.max(6, Math.round(base * this.q));
    this.pools = {
      glow: new Pool(() => this._sprite(this.blobTex, true), n(120)),
      dust: new Pool(() => this._sprite(this.dustTex, false), n(70)),
      spark: new Pool(() => this._sprite(this.sparkTex, true), n(110)),
      flame: new Pool(() => this._sprite(this.flameTex, true), n(90)),
      streak: new Pool(() => this._sprite(this.streakTex, true), n(40)),
      coin: new Pool(() => this._sprite(this.coinTex, false), n(28)),
      fireballSprite: new Pool(() => this._sprite(this.fireTex, true), n(24)),
      ring: new Pool(() => this._ring(), n(10)),
      debris: new Pool(() => this._debris(), n(24)),
    };
    this.rings = this.pools.ring;
    this.shake = 0;
    this._runDustTimer = 0;
    this._lineTimer = 0;
  }

  _sprite(map, additive) {
    const mat = new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    const s = new THREE.Sprite(mat);
    s.scale.set(1, 1, 1);
    this.group.add(s);
    return s;
  }

  _ring() {
    const geo = new THREE.RingGeometry(0.42, 0.62, 28);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    this.group.add(m);
    return m;
  }

  _debris() {
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a8368, roughness: 0.9 });
    const m = new THREE.Mesh(geo, mat);
    this.group.add(m);
    return m;
  }

  // ------------------------------------------------------------- spawning
  spawn(kind, opts = {}) {
    const pool = this.pools[kind];
    if (!pool) return null;
    const it = pool.take();
    if (!it) return null;
    const {
      x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, life = 0.6, size = 0.6,
      grow = 1, fade = 1, gravity = 0, color = 0xffffff, opacity = 1,
      spin = 0, drag = 0, stretch = 1, rotation = 0,
    } = opts;
    it.position.set(x, y, z);
    it.visible = true;
    it.alive = true;
    it.userData = it.userData || {};
    Object.assign(it.userData, { life, maxLife: life, vx, vy, vz, size, grow, fade, gravity, opacity, spin, drag, stretch });
    it.scale.set(size, size * stretch, 1);
    it.material.opacity = opacity;
    it.material.visible = true;
    if (it.material.color) it.material.color.setHex(color);
    it.material.rotation = rotation;
    if (kind === 'debris') {
      it.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      it.userData.rv = { x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 };
    }
    return it;
  }

  burst(kind, { x = 0, y = 0, z = 0, count = 8, speed = 3, spread = 0.4, life = 0.6, size = 0.5, up = 2, sizeVar = 0.5, color = 0xffffff, gravity = -6, additive = true } = {}) {
    const c = Math.min(count, 40);
    for (let i = 0; i < c; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      this.spawn(kind, {
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        z: z + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * r, vz: Math.sin(a) * r,
        vy: Math.random() * up,
        life: life * (0.7 + Math.random() * 0.6),
        size: size * (1 - sizeVar / 2 + Math.random() * sizeVar),
        gravity, color,
      });
    }
  }

  // --------------------------------------------------- gameplay fx presets
  coinPickup(pos, color = 0xffe07a) {
    this.burst('glow', { x: pos.x, y: pos.y, z: pos.z, count: 7, speed: 2.4, life: 0.42, size: 0.55, color, gravity: 1.2, up: 2.4 });
    this.burst('spark', { x: pos.x, y: pos.y, z: pos.z, count: 4, speed: 3.4, life: 0.3, size: 0.3, color: 0xfff2c0, gravity: 0 });
  }

  runDust(x, z, intensity = 1, color = 0xa89878) {
    this._runDustTimer -= intensity;
    if (this._runDustTimer > 0) return;
    this._runDustTimer = 0.65;
    this.spawn('dust', {
      x: x + (Math.random() - 0.5) * 0.5, y: 0.14, z: z + 0.2,
      vx: (Math.random() - 0.5) * 0.7, vy: 0.5 + Math.random() * 0.5, vz: 1.4 + Math.random(),
      life: 0.55, size: 0.7, gravity: -1.2, color, opacity: 0.55,
    });
  }

  strafePuff(x, z) {
    this.burst('dust', { x, y: 0.16, z: z + 0.1, count: 5, speed: 1.6, life: 0.4, size: 0.5, up: 1.2, gravity: -2, color: 0xb0a184 });
  }

  landPuff(x, z) {
    this.burst('dust', { x, y: 0.14, z, count: 12, speed: 3.4, life: 0.55, size: 0.8, up: 1.6, gravity: -3, color: 0xb4a488, sizeVar: 0.8 });
    this.ring(x, z, { size: 0.9, color: 0xd8c9a4 });
  }

  slideTrail(x, z) {
    this.spawn('dust', {
      x: x + (Math.random() - 0.5) * 0.5, y: 0.16, z: z + 0.3,
      vy: 0.7, vz: 2.2 + Math.random(), life: 0.45, size: 0.85, gravity: -1, color: 0x9c8f74, opacity: 0.5,
    });
  }

  ring(x, z, { size = 1, color = 0xffd27a, life = 0.5 } = {}) {
    const it = this.spawn('ring', { x, y: 0.05, z, life, size, color, grow: 2.6, fade: 1.4 });
    return it;
  }

  hitBurst(pos) {
    this.burst('glow', { x: pos.x, y: pos.y + 0.8, z: pos.z, count: 18, speed: 6, life: 0.7, size: 1.0, color: 0xffb060, gravity: -4, up: 4 });
    this.burst('debris', { x: pos.x, y: pos.y + 0.9, z: pos.z, count: 12, speed: 5, life: 1.2, up: 6, gravity: -14, size: 1 });
    this.ring(pos.x, pos.z, { size: 1.4, color: 0xff9a4a, life: 0.6 });
    this.shake = Math.min(1.2, this.shake + 0.9);
  }

  boostTrail(x, y, z, dt) {
    this.spawn('flame', {
      x: x + (Math.random() - 0.5) * 0.5, y: y + Math.random() * 0.3, z: z + 0.35,
      vz: 6 + Math.random() * 4, vy: 1.2, life: 0.35, size: 1.4, gravity: 0, color: 0xffc46a, opacity: 0.9, stretch: 1.6,
    });
  }

  firePuff(x, y, z) {
    this.burst('flame', { x, y, z, count: 3, speed: 1.2, life: 0.5, size: 1.2, up: 1.6, gravity: -1.2, color: 0xffa040, sizeVar: 0.9 });
  }

  trail(x, y, z, color = 0x8ff0ff) {
    this.spawn('glow', { x, y, z, vy: 0.4, vz: 3.5, life: 0.5, size: 0.5, color, opacity: 0.7 });
  }

  magicBurst(pos) {
    this.burst('spark', { x: pos.x, y: pos.y + 0.4, z: pos.z, count: 26, speed: 7, life: 1.0, size: 0.42, color: 0xa8f0ff, gravity: -1.5, up: 5 });
    this.burst('glow', { x: pos.x, y: pos.y + 0.6, z: pos.z, count: 12, speed: 4, life: 0.8, size: 1.1, color: 0x6fd0ff, gravity: 0, up: 3 });
    this.ring(pos.x, pos.z, { size: 1.2, color: 0x9fe8ff, life: 0.7 });
    this.shake = Math.min(1, this.shake + 0.4);
  }

  powerupBurst(pos, color = 0xffe066) {
    this.burst('spark', { x: pos.x, y: pos.y, z: pos.z, count: 22, speed: 6, life: 0.8, size: 0.4, color, gravity: -2, up: 4 });
    this.ring(pos.x, pos.z, { size: 1.1, color, life: 0.6 });
  }

  shieldHit(pos) {
    this.burst('spark', { x: pos.x, y: pos.y + 0.8, z: pos.z, count: 20, speed: 6, life: 0.6, size: 0.36, color: 0x9fd8ff, gravity: -2, up: 4 });
    this.ring(pos.x, pos.z, { size: 1.0, color: 0x9fd8ff, life: 0.5 });
  }

  speedLines(intensity, camPos) {
    this._lineTimer -= intensity;
    if (this._lineTimer > 0) return;
    this._lineTimer = 0.055;
    for (let i = 0; i < 2; i++) {
      this.spawn('streak', {
        x: camPos.x + (Math.random() - 0.5) * 9,
        y: camPos.y + (Math.random() - 0.5) * 3.2,
        z: camPos.z - 5 - Math.random() * 8,
        vz: 26 + Math.random() * 14,
        life: 0.34, size: 0.4, stretch: 0.14, color: 0xfff0d0, opacity: 0.5,
      });
    }
  }

  confetti(pos, count = 26) {
    const colors = [0xffd27a, 0xff7a5c, 0x9fe8ff, 0xa8f0a0, 0xffffff];
    for (let i = 0; i < count; i++) {
      this.spawn('glow', {
        x: pos.x + (Math.random() - 0.5) * 3, y: pos.y + 1, z: pos.z + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 5, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 5,
        life: 1.6, size: 0.34, gravity: -7, color: colors[i % colors.length],
      });
    }
  }

  // --------------------------------------------------------------- update
  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.4);
    for (const key in this.pools) {
      const pool = this.pools[key];
      for (const it of pool.items) {
        if (!it.alive) continue;
        const u = it.userData;
        u.life -= dt;
        if (u.life <= 0) { pool.release(it); continue; }
        if (u.drag) {
          const d = Math.exp(-u.drag * dt);
          u.vx *= d; u.vz *= d;
        }
        u.vy += (u.gravity || 0) * dt;
        it.position.x += u.vx * dt;
        it.position.y += u.vy * dt;
        it.position.z += u.vz * dt;
        const t = 1 - u.life / u.maxLife; // 0..1
        const scale = u.size * (1 + (u.grow - 1) * t);
        if (key === 'streak') it.scale.set(scale * 6, scale * 0.5, 1);
        else it.scale.set(scale, scale * (u.stretch || 1), 1);
        it.material.opacity = Math.max(0, u.opacity * (1 - Math.pow(t, u.fade)));
        if (key === 'debris' && u.rv) {
          it.rotation.x += u.rv.x * dt;
          it.rotation.y += u.rv.y * dt;
          it.rotation.z += u.rv.z * dt;
        }
        if (key === 'fireballSprite') {
          it.material.rotation += dt * 4;
        }
        if (key === 'coin' || key === 'ring') it.material.rotation += dt * (key === 'coin' ? 6 : 0);
        if (it.position.z > 30) pool.release(it);
      }
    }
  }

  clear() {
    for (const key in this.pools) {
      const pool = this.pools[key];
      for (const it of pool.items) if (it.alive) pool.release(it);
    }
    this.shake = 0;
  }

  setQuality(q) {
    this.q = q;
  }
}
