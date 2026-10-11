/**
 * All gameplay entities: obstacles, coins, power-up orbs, the golden idol,
 * flying demon monkeys and their fireballs.
 *
 * Every entity comes from a pool (no allocation during play) and knows how to
 * move itself, animate itself and expose a hitbox to the collision solver.
 */
import * as THREE from '../../vendor/three.module.js';
import { LANES, WORLD } from '../core/config.js';
import { cloneTex, canvasTexture } from '../render/textures.js';

/** Hitbox table. `action` documents how a skilled player beats the obstacle. */
export const OBSTACLES = {
  firepit: { halfW: 1.02, yMin: 0.0, yMax: 1.35, depth: 1.15, action: 'jump' },
  log: { halfW: 4.0, yMin: 0.0, yMax: 1.05, depth: 1.0, action: 'jump' },
  rollinglog: { halfW: 1.02, yMin: 0.0, yMax: 1.05, depth: 1.0, action: 'jump', extraSpeed: 4.5 },
  stonewall: { halfW: 1.02, yMin: 0.0, yMax: 1.12, depth: 0.75, action: 'jump' },
  firegap: { halfW: 1.02, yMin: 0.0, yMax: 1.55, depth: 1.35, action: 'jump' },
  spikes: { halfW: 1.02, yMin: 0.0, yMax: 0.95, depth: 1.05, action: 'jump' },
  statue: { halfW: 0.92, yMin: 0.0, yMax: 3.0, depth: 0.95, action: 'dodge' },
  firewall: { halfW: 1.02, yMin: 0.0, yMax: 2.7, depth: 1.05, action: 'dodge' },
  vines: { halfW: 1.02, yMin: 1.12, yMax: 3.6, depth: 0.7, action: 'slide' },
  ledge: { halfW: 1.02, yMin: 1.18, yMax: 2.8, depth: 0.85, action: 'slide' },
  tiki: { halfW: 0.95, yMin: 0.0, yMax: 2.2, depth: 0.8, action: 'dodge' },
};

export const POWERUP_KINDS = ['magnet', 'boost', 'shield', 'x2'];
const POWERUP_COLORS = { magnet: 0xff6a4a, boost: 0xffd24a, shield: 0x62c8ff, x2: 0xa8ff6a };

// ---------------------------------------------------------------------------
// icon textures drawn procedurally (no extra files needed)
// ---------------------------------------------------------------------------
function iconTexture(kind) {
  return canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 14;
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    const c = w / 2;
    if (kind === 'magnet') {
      g.beginPath();
      g.arc(c, c + 6, 34, Math.PI, 0, false);
      g.stroke();
      g.fillRect(c - 41, c + 6, 14, 26);
      g.fillRect(c + 27, c + 6, 14, 26);
    } else if (kind === 'boost') {
      g.beginPath();
      g.moveTo(c + 10, 18); g.lineTo(c - 26, c + 8); g.lineTo(c - 2, c + 8);
      g.lineTo(c - 12, h - 18); g.lineTo(c + 28, c - 4); g.lineTo(c + 2, c - 4);
      g.closePath(); g.fill();
    } else if (kind === 'shield') {
      g.beginPath();
      g.moveTo(c, 16); g.lineTo(c + 34, 32); g.lineTo(c + 30, c + 18);
      g.quadraticCurveTo(c, h - 12, c - 30, c + 18); g.lineTo(c - 34, 32);
      g.closePath(); g.fill();
    } else if (kind === 'x2') {
      g.font = 'bold 82px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('2x', c, c + 4);
    }
  });
}

// ---------------------------------------------------------------------------
// pooled factory
// ---------------------------------------------------------------------------
class EntityPool {
  constructor(factory, size) {
    this.items = [];
    this.factory = factory;
    this.size = size;
    this.free = [];
  }
  take() {
    if (this.free.length) return this.free.pop();
    if (this.items.length < this.size) {
      const it = this.factory();
      it.alive = false;
      it.group.visible = false;
      this.items.push(it);
      return it;
    }
    return null;
  }
  release(it) {
    it.alive = false;
    it.group.visible = false;
    this.free.push(it);
  }
}

export class Entities {
  constructor(scene, assets, fx, quality = 1) {
    this.scene = scene;
    this.assets = assets;
    this.fx = fx;
    this.quality = quality;
    this.time = 0;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.active = [];

    this.mats = this._materials();
    this.iconTex = {};
    POWERUP_KINDS.forEach((k) => { this.iconTex[k] = iconTexture(k); });

    const n = (v) => Math.max(3, Math.round(v * quality));
    this.pools = {
      coin: new EntityPool(() => this._makeCoin(), n(90)),
      powerup: new EntityPool(() => this._makePowerup(), 8),
      idol: new EntityPool(() => this._makeIdol(), 2),
      firepit: new EntityPool(() => this._makeFirepit(), n(12)),
      log: new EntityPool(() => this._makeLog(), n(6)),
      rollinglog: new EntityPool(() => this._makeLog(true), n(6)),
      stonewall: new EntityPool(() => this._makeWall(), n(12)),
      firegap: new EntityPool(() => this._makeFiregap(), n(10)),
      spikes: new EntityPool(() => this._makeSpikes(), n(10)),
      statue: new EntityPool(() => this._makeStatue(), n(10)),
      firewall: new EntityPool(() => this._makeFirewall(), n(8)),
      vines: new EntityPool(() => this._makeVines(), n(10)),
      ledge: new EntityPool(() => this._makeLedge(), n(10)),
      tiki: new EntityPool(() => this._makeTiki(), n(8)),
      howler: new EntityPool(() => this._makeHowler(), n(4)),
      fireball: new EntityPool(() => this._makeFireball(), n(12)),
    };
  }

  _materials() {
    const a = this.assets;
    return {
      stone: new THREE.MeshStandardMaterial({ map: cloneTex(a.tex('stone_wall'), 1, 1), roughness: 0.95 }),
      stoneDark: new THREE.MeshStandardMaterial({ map: cloneTex(a.tex('stone_wall'), 2, 2), color: 0x8d8878, roughness: 0.95 }),
      wood: new THREE.MeshStandardMaterial({ map: cloneTex(a.tex('wood'), 1, 3), roughness: 0.95 }),
      woodDark: new THREE.MeshStandardMaterial({ map: cloneTex(a.tex('wood'), 2, 1), color: 0x9a7d54, roughness: 1 }),
      cloth: new THREE.MeshStandardMaterial({ color: 0x8c3b2a, roughness: 1, side: THREE.DoubleSide }),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.3, metalness: 0.85, emissive: 0x552200 }),
      spike: new THREE.MeshStandardMaterial({ color: 0x6f6a5c, roughness: 0.8 }),
      vine: new THREE.MeshStandardMaterial({
        map: cloneTex(a.tex('foliage'), 1, 1), transparent: true, alphaTest: 0.25,
        side: THREE.DoubleSide, roughness: 1, color: 0x7fae63,
      }),
    };
  }

  _sprite(map, { color = 0xffffff, opacity = 1, additive = true, scale = 1 } = {}) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map, color, opacity, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
    }));
    s.scale.set(scale, scale, 1);
    return s;
  }

  // ---------------------------------------------------------------- makers
  _makeCoin() {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.PlaneGeometry(0.66, 0.66),
      new THREE.MeshBasicMaterial({ map: this.assets.tex('coin'), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, toneMapped: false }),
    );
    const glow = this._sprite(this.assets.tex('glow'), { color: 0xffd76a, opacity: 0.45, scale: 1.5 });
    g.add(disc, glow);
    g.userData.disc = disc;
    g.userData.glow = glow;
    return { kind: 'coin', group: g, alive: false };
  }

  _makePowerup() {
    const g = new THREE.Group();
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.25, transparent: true, opacity: 0.55 }),
    );
    const halo = this._sprite(this.assets.tex('glow'), { color: 0xffffff, opacity: 0.8, scale: 2.2 });
    const icon = this._sprite(this.iconTex.magnet, { color: 0xffffff, opacity: 1, scale: 0.75 });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.7;
    g.add(orb, halo, icon, ring);
    g.userData = { orb, halo, icon, ring };
    return { kind: 'powerup', group: g, alive: false };
  }

  _makeIdol() {
    const g = new THREE.Group();
    const model = this._makeIdolModel();
    model.position.y = -0.35;
    const halo = this._sprite(this.assets.tex('glow'), { color: 0xffd27a, opacity: 0.85, scale: 3.2 });
    halo.position.z = -0.6;
    const beam = this._sprite(this.assets.tex('streak'), { color: 0xffe9a8, opacity: 0.5, scale: 1.2 });
    beam.scale.set(0.7, 3.4, 1);
    beam.position.y = 0.4;
    beam.material.rotation = Math.PI / 2;
    const ground = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.5, 26),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.45;
    g.add(model, halo, beam, ground);
    const light = new THREE.PointLight(0xffc45a, 1.6, 9, 2);
    g.add(light);
    g.userData = { model, halo, beam, ground, light };
    return { kind: 'idol', group: g, alive: false };
  }

  _makeFirepit() {
    const g = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2.0, 8), this.mats.wood);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = i * Math.PI / 2;
      log.position.y = 0.22;
      log.castShadow = true;
      g.add(log);
    }
    const ember = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 20),
      new THREE.MeshBasicMaterial({ map: this.assets.tex('glow'), color: 0xff7a2a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    ember.rotation.x = -Math.PI / 2;
    ember.position.y = 0.03;
    g.add(ember);
    g.userData = { emitter: true, y: 0.6, rate: 0.10 };
    return { kind: 'obstacle', type: 'firepit', group: g, alive: false };
  }

  _makeLog(rolling = false) {
    const g = new THREE.Group();
    const isWide = !rolling;
    const len = isWide ? 8.4 : 2.4;
    const r = 0.42;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), this.mats.woodDark);
    log.rotation.z = Math.PI / 2;
    log.position.y = r;
    log.castShadow = true;
    g.add(log);
    for (let i = 0; i < (isWide ? 5 : 2); i++) {
      const leaf = this._sprite(this.assets.tex('foliage'), { color: 0x6f9a4a, opacity: 1, additive: false, scale: 1.4 });
      leaf.material.alphaTest = 0.3;
      leaf.position.set((i - (isWide ? 2 : 0.5)) * 1.7, 0.9, 0);
      g.add(leaf);
    }
    g.userData = { spin: rolling ? 6 : 0, mesh: log };
    return { kind: 'obstacle', type: rolling ? 'rollinglog' : 'log', group: g, alive: false };
  }

  _makeWall() {
    const g = new THREE.Group();
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 0.6), this.mats.stoneDark);
    w.position.y = 0.5;
    w.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.75), this.mats.stone);
    cap.position.y = 1.0;
    cap.castShadow = true;
    g.add(w, cap);
    return { kind: 'obstacle', type: 'stonewall', group: g, alive: false };
  }

  _makeFiregap() {
    const g = new THREE.Group();
    const scorch = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 2.4),
      new THREE.MeshBasicMaterial({ map: this.assets.tex('dust'), color: 0x1a1208, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.02;
    g.add(scorch);
    const ember = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 1.6),
      new THREE.MeshBasicMaterial({ map: this.assets.tex('glow'), color: 0xff5a18, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    ember.rotation.x = -Math.PI / 2;
    ember.position.y = 0.04;
    g.add(ember);
    const jets = [];
    for (let i = -1; i <= 1; i += 2) {
      const j = this._sprite(this.assets.tex('flame'), { color: 0xffb060, opacity: 0.95, scale: 2.4 });
      j.position.set(i * 0.75, 0.9, 0);
      j.scale.set(1.6, 2.4, 1);
      jets.push(j);
      g.add(j);
    }
    g.userData = { emitter: true, y: 0.4, rate: 0.06, jets };
    return { kind: 'obstacle', type: 'firegap', group: g, alive: false };
  }

  _makeSpikes() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.85, 6), this.mats.spike);
      s.position.set(-0.8 + i * 0.4, 0.42, (i % 2) * 0.3 - 0.15);
      s.castShadow = true;
      g.add(s);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 0.8), this.mats.stoneDark);
    base.position.y = 0.06;
    g.add(base);
    return { kind: 'obstacle', type: 'spikes', group: g, alive: false };
  }

  _makeStatue() {
    const g = new THREE.Group();
    const stone = this.mats.stone;
    const dark = this.mats.stoneDark;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 1.1), dark);
    plinth.position.y = 0.21;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.5, 8), stone);
    col.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.85, 0.9), stone);
    head.position.y = 2.25;
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.5), dark);
    jaw.position.set(0, 1.95, 0.3);
    g.add(plinth, col, head, jaw);
    for (const sx of [-1, 1]) {
      const eye = this._sprite(this.assets.tex('glow'), { color: 0xffb040, opacity: 0.5, scale: 0.4 });
      eye.position.set(sx * 0.24, 2.34, 0.48);
      g.add(eye);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.3), stone);
      arm.position.set(sx * 0.62, 1.2, 0.05);
      arm.rotation.z = sx * 0.12;
      g.add(arm);
    }
    for (const m of g.children) {
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    }
    return { kind: 'obstacle', type: 'statue', group: g, alive: false };
  }

  _makeFirewall() {
    const g = new THREE.Group();
    const jets = [];
    for (let i = -1; i <= 1; i++) {
      const j = this._sprite(this.assets.tex('flame'), { color: 0xffc070, opacity: 0.95, scale: 3 });
      j.position.set(i * 0.62, 1.5, 0);
      j.scale.set(1.3, 3.1, 1);
      jets.push(j);
      g.add(j);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.25, 0.9), this.mats.stoneDark);
    base.position.y = 0.12;
    g.add(base);
    g.userData = { emitter: true, y: 0.4, rate: 0.07, jets };
    return { kind: 'obstacle', type: 'firewall', group: g, alive: false };
  }

  _makeVines() {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.6), this.mats.vine);
      v.position.set(0, 2.45, (i - 1) * 0.22);
      v.rotation.y = (i - 1) * 0.5;
      v.castShadow = true;
      g.add(v);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.3, 8), this.mats.wood);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 3.7;
    g.add(bar);
    return { kind: 'obstacle', type: 'vines', group: g, alive: false };
  }

  _makeLedge() {
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.55, 1.1), this.mats.stone);
    slab.position.y = 1.5;
    slab.castShadow = true;
    g.add(slab);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.1), this.mats.cloth);
    cloth.position.set(0, 1.05, 0.56);
    g.add(cloth);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.9, 6), this.mats.wood);
      p.position.set(sx * 1.0, 0.75, 0);
      g.add(p);
    }
    return { kind: 'obstacle', type: 'ledge', group: g, alive: false };
  }

  _makeTiki() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.9, 8), this.mats.woodDark);
    body.position.y = 1.0;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.8, 0.8), this.mats.stone);
    head.position.y = 2.1;
    head.castShadow = true;
    g.add(head);
    return { kind: 'obstacle', type: 'tiki', group: g, alive: false };
  }

  /**
   * A demon monkey: flying jungle beast assembled from primitives so it needs
   * no sprite art. Charcoal fur, burning eyes, bat wings that flap and a
   * lashing tail — reads clearly as a fast-moving silhouette.
   */
  _makeHowler() {
    const g = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0x241d1a, roughness: 0.95 });
    const furDark = new THREE.MeshStandardMaterial({ color: 0x140f0e, roughness: 1 });
    const eyes = new THREE.MeshBasicMaterial({ color: 0xff3a14, toneMapped: false });
    const fang = new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.5 });
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x1b1512, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    });
    const paint = new THREE.MeshStandardMaterial({ color: 0xb0301c, roughness: 0.9 });

    // torso, head, snout
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 12), fur);
    torso.scale.set(1, 0.92, 1.15);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.30, 14, 12), fur);
    head.position.set(0, 0.38, 0.26);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.20, 0.24), furDark);
    snout.position.set(0, 0.31, 0.52);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.2), furDark);
    jaw.position.set(0, 0.2, 0.5);
    jaw.rotation.x = 0.35;
    g.add(torso, head, snout, jaw);

    // burning eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), eyes);
      eye.position.set(sx * 0.115, 0.42, 0.5);
      g.add(eye);
      const glint = this._sprite(this.assets.tex('glow'), { color: 0xff4a20, opacity: 0.85, scale: 0.55 });
      glint.position.set(sx * 0.115, 0.42, 0.52);
      g.add(glint);
    }
    // fangs
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 5), fang);
      f.position.set(sx * 0.07, 0.24, 0.58);
      f.rotation.x = Math.PI;
      g.add(f);
    }
    // ears + spiky mane
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), furDark);
      ear.position.set(sx * 0.29, 0.44, 0.22);
      ear.scale.set(0.6, 1, 0.8);
      g.add(ear);
    }
    for (let i = 0; i < 7; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.3, 5), furDark);
      const a = (i / 6) * Math.PI - Math.PI / 2;
      spike.position.set(Math.sin(a) * 0.22, 0.5 + Math.cos(a) * 0.08, -0.05 - Math.abs(Math.sin(a)) * 0.05);
      spike.rotation.z = -a * 0.7;
      spike.rotation.x = -0.5;
      g.add(spike);
    }
    // war paint stripe
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 14, Math.PI), paint);
    stripe.position.set(0, 0.36, 0.2);
    stripe.rotation.set(0.4, 0, 0);
    g.add(stripe);

    // limbs: arms reaching forward, legs tucked back
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.62, 7), fur);
      arm.position.set(sx * 0.36, 0.02, 0.3);
      arm.rotation.set(1.15, 0, sx * 0.35);
      g.add(arm);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), furDark);
      fist.position.set(sx * 0.46, -0.16, 0.6);
      g.add(fist);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.52, 7), fur);
      leg.position.set(sx * 0.2, -0.28, -0.22);
      leg.rotation.set(-0.7, 0, sx * 0.2);
      g.add(leg);
    }

    // bat wings (flap in update)
    const wings = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.28, 0.22, -0.05);
      const half = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.46), wingMat);
      half.position.set(sx * 0.42, 0.05, 0);
      half.rotation.y = sx * -0.25;
      pivot.add(half);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.86, 5), furDark);
      strut.rotation.z = Math.PI / 2;
      strut.position.set(sx * 0.42, 0.18, 0);
      pivot.add(strut);
      g.add(pivot);
      wings.push({ pivot, sx });
    }

    // lashing tail
    const tailPts = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      tailPts.push(new THREE.Vector3(0, -0.24 - t * 0.34, -0.42 - t * 0.5 + Math.sin(t * 3) * 0.2));
    }
    const tail = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tailPts), 10, 0.05, 5, false),
      furDark,
    );
    g.add(tail);

    // menacing red aura
    const aura = this._sprite(this.assets.tex('glow'), { color: 0xff2a10, opacity: 0.28, scale: 2.6 });
    aura.position.z = -0.3;
    g.add(aura);

    g.userData = { wings, tail, anim: 0, creature: true };
    return { kind: 'enemy', type: 'howler', group: g, alive: false };
  }

  /** Golden jaguar idol — the rare high-value pickup. */
  _makeIdolModel() {
    const gold = new THREE.MeshStandardMaterial({
      color: 0xffc94a, roughness: 0.25, metalness: 0.9, emissive: 0x6a3a00, emissiveIntensity: 0.5,
    });
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.22, 10), gold);
    base.position.y = -0.85;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.44, 0.9, 10), gold);
    body.position.y = -0.3;
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), gold);
    chest.position.y = 0.15;
    chest.scale.set(1.1, 0.9, 0.8);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), gold);
    head.position.y = 0.55;
    head.scale.set(1, 0.92, 0.9);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.18), gold);
    snout.position.set(0, 0.5, 0.2);
    g.add(base, body, chest, head, snout);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 6), gold);
      ear.position.set(sx * 0.19, 0.76, 0);
      g.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x2a1200, toneMapped: false }));
      eye.position.set(sx * 0.1, 0.6, 0.22);
      g.add(eye);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.6, 7), gold);
      arm.position.set(sx * 0.32, -0.1, 0.02);
      arm.rotation.z = sx * 0.28;
      g.add(arm);
    }
    return g;
  }

  _makeFireball() {
    const g = new THREE.Group();
    const core = this._sprite(this.assets.tex('fireball'), { color: 0xffffff, opacity: 1, scale: 1.0 });
    const halo = this._sprite(this.assets.tex('glow'), { color: 0xff8a2a, opacity: 0.85, scale: 1.7 });
    g.add(core, halo);
    g.userData = { core };
    return { kind: 'projectile', type: 'fireball', group: g, alive: false };
  }

  // ---------------------------------------------------------------- spawn
  spawn(type, { lane = 1, x = null, y = null, z = WORLD.spawnZ, meta = {} } = {}) {
    const pool = this.pools[type];
    if (!pool) return null;
    const e = pool.take();
    if (!e) return null;
    e.alive = true;
    e.pool = pool;
    e.type = type;
    e.lane = lane;
    e.meta = meta;
    e.age = 0;
    e.group.visible = true;
    e.group.position.set(x != null ? x : LANES[lane], y != null ? y : 0, z);
    e.group.rotation.set(0, 0, 0);
    e.group.scale.setScalar(1);
    if (type === 'coin') {
      e.group.position.y = y != null ? y : 1.05;
      e.meta.baseY = e.group.position.y;
      e.radius = 0.55;
    } else if (type === 'powerup') {
      e.group.position.y = y != null ? y : 1.25;
      e.power = meta.power || 'magnet';
      e.radius = 0.7;
      const u = e.group.userData;
      const col = POWERUP_COLORS[e.power];
      u.orb.material.color.setHex(col);
      u.orb.material.emissive.setHex(col);
      u.halo.material.color.setHex(col);
      u.ring.material.color.setHex(col);
      u.icon.material.map = this.iconTex[e.power];
      u.icon.material.needsUpdate = true;
      u.spin = 0;
    } else if (type === 'idol') {
      e.group.position.y = 1.5;
      e.radius = 1.0;
    } else if (type === 'fireball') {
      e.group.position.y = y != null ? y : 1.32;
      e.radius = 0.45;
      e.vz = meta.vz || 6;
    } else if (type === 'howler') {
      e.group.position.y = y != null ? y : 1.75;
      e.vx = meta.vx || 0;
      e.wobble = meta.wobble || 2;
      e.meta.baseY = e.group.position.y;
      e.targetX = meta.targetX != null ? meta.targetX : (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 1.6);
      e.fireTimer = 1.1 + Math.random() * 1.2;
      e.radius = 0.8;
    } else if (OBSTACLES[type]) {
      const hb = OBSTACLES[type];
      e.hitbox = hb;
      e.radius = hb.halfW;
      e.emitterTimer = 0;
      if (e.group.userData && e.group.userData.spin) e.group.rotation.x = 0;
    }
    this.active.push(e);
    this.group.add(e.group);
    return e;
  }

  release(e) {
    if (e.pool) e.pool.release(e);
    const i = this.active.indexOf(e);
    if (i >= 0) this.active.splice(i, 1);
    this.group.remove(e.group);
  }

  releaseAll() {
    for (const e of [...this.active]) this.release(e);
  }

  // --------------------------------------------------------------- update
  update(dt, ctx) {
    this.time += dt;
    const { speed, distance } = ctx;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.age += dt;
      const g = e.group;

      // world sliding
      let extra = 0;
      if (e.kind === 'projectile') extra = e.vz || 0;
      if (e.hitbox && e.hitbox.extraSpeed) extra = e.hitbox.extraSpeed;
      if (e.kind === 'enemy') extra = 2.5;
      g.position.z += distance + extra * dt;

      switch (e.type) {
        case 'coin': {
          const u = g.userData;
          u.disc.rotation.y += dt * 3.4;
          const bob = Math.sin(this.time * 3 + g.position.z * 0.6) * 0.08;
          g.position.y = (e.meta.baseY != null ? e.meta.baseY : 1.05) + bob;
          u.glow.material.opacity = 0.32 + Math.sin(this.time * 6 + g.position.z) * 0.12;
          break;
        }
        case 'powerup': {
          const u = g.userData;
          g.rotation.y += dt * 1.4;
          g.position.y = 1.25 + Math.sin(this.time * 2.4 + g.position.z * 0.4) * 0.14;
          u.ring.scale.setScalar(1 + Math.sin(this.time * 3) * 0.12);
          if (Math.random() < dt * 6) {
            this.fx.spawn('glow', { x: g.position.x + (Math.random() - 0.5) * 0.6, y: g.position.y + (Math.random() - 0.5) * 0.6, z: g.position.z, vz: 1, life: 0.5, size: 0.3, color: u.orb.material.color.getHex() });
          }
          break;
        }
        case 'idol': {
          const u = g.userData;
          g.rotation.y += dt * 1.1;
          u.halo.material.opacity = 0.7 + Math.sin(this.time * 4) * 0.2;
          if (Math.random() < dt * 24) {
            this.fx.spawn('spark', { x: g.position.x + (Math.random() - 0.5), y: g.position.y + (Math.random() - 0.5) * 1.5, z: g.position.z, vy: 1.2, life: 0.7, size: 0.22, color: 0xffd27a });
          }
          break;
        }
        case 'howler': {
          const u = g.userData;
          u.anim += dt * 8;
          if (u.wings) {
            const flap = Math.sin(this.time * 11 + g.position.z * 0.3) * 0.75;
            for (const w of u.wings) w.pivot.rotation.z = w.sx * flap;
            if (u.tail) u.tail.rotation.y = Math.sin(this.time * 5) * 0.35;
            g.rotation.x = Math.sin(this.time * 7) * 0.08;
          }
          g.position.y = (e.meta.baseY != null ? e.meta.baseY : 1.75) + Math.sin(this.time * 3 + g.position.z * 0.3) * 0.18;
          // lock into the chosen lane while still far away, then hold a straight
          // line so the player can read and dodge it
          if (g.position.z < -70) {
            g.position.x += (e.targetX != null ? Math.sign(e.targetX - g.position.x) * Math.min(2.2, Math.abs(e.targetX - g.position.x) * 2.4) : 0) * dt;
          }
          e.fireTimer -= dt;
          if (e.fireTimer <= 0 && g.position.z < -8 && g.position.z > -120) {
            e.fireTimer = 1.5 + Math.random() * 1.6;
            const p = g.position;
            const b = this.spawn('fireball', { x: p.x, y: 1.32, z: p.z + 0.7, meta: { vz: (ctx.speed || 20) * 0.5 } });
            if (b && ctx.audio) ctx.audio.play('fire');
          }
          break;
        }
        case 'fireball': {
          const u = g.userData;
          u.core.material.rotation += dt * 6;
          u.core.scale.setScalar(1 + Math.sin(this.time * 18) * 0.12);
          if (Math.random() < dt * 30) {
            this.fx.spawn('flame', { x: g.position.x, y: g.position.y, z: g.position.z, vz: 2, life: 0.35, size: 0.8, color: 0xffa040 });
          }
          break;
        }
        default: {
          // obstacles
          const u = g.userData || {};
          if (u.spin) g.rotation.x -= dt * u.spin;
          if (u.emitter && g.position.z > -95 && g.position.z < 4) {
            e.emitterTimer -= dt;
            if (e.emitterTimer <= 0) {
              e.emitterTimer = u.rate;
              this.fx.spawn('flame', {
                x: g.position.x + (Math.random() - 0.5) * 1.4,
                y: u.y + Math.random() * 0.3,
                z: g.position.z + (Math.random() - 0.5) * 0.5,
                vy: 3.4 + Math.random() * 2.2, vz: 1.2,
                life: 0.42, size: 1.5 + Math.random(), color: 0xffb060, stretch: 1.5,
              });
            }
          }
          if (u.jets) {
            for (const j of u.jets) {
              const s = j.userData.seed || (j.userData.seed = Math.random() * 10);
              j.scale.y = 2.3 + Math.sin(this.time * 7 + s) * 0.4;
              j.material.opacity = 0.75 + Math.sin(this.time * 9 + s) * 0.2;
            }
          }
          break;
        }
      }

      // magnet attraction handled by Run (needs player state) — flagged via meta
      if (g.position.z > WORLD.despawnZ) this.release(e);
    }
  }

  /** Closest active coin to a point (used by the magnet). */
  nearestCoin(x, z, maxZ = 12) {
    let best = null; let bestD = Infinity;
    for (const e of this.active) {
      if (e.type !== 'coin' || e.meta.taken) continue;
      const dz = e.group.position.z - z;
      if (dz < -1 || dz > maxZ) continue;
      const dx = Math.abs(e.group.position.x - x);
      if (dx > 4.5) continue;
      const d = Math.hypot(dz, dx);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  counts() {
    const c = {};
    for (const e of this.active) c[e.type] = (c[e.type] || 0) + 1;
    return c;
  }
}

