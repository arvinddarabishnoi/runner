/**
 * Asset loader. Images are decoded once and shared between the DOM UI
 * (plain <img>) and WebGL (THREE.Texture). Every load has a procedural
 * fallback so a missing file can never break the run.
 */
import * as THREE from '../../vendor/three.module.js';
import { tintImage } from '../render/textures.js';

export const MANIFEST = {
  textures: {
    stone_path: 'assets/textures/stone_path.jpg',
    stone_wall: 'assets/textures/stone_wall.jpg',
    ground_jungle: 'assets/textures/ground_jungle.jpg',
    wood: 'assets/textures/wood.jpg',
    sky_pano: 'assets/textures/sky_pano.jpg',
    glow: 'assets/sprites/glow.png',
    shadow: 'assets/sprites/shadow.png',
    spark: 'assets/sprites/spark.png',
    dust: 'assets/sprites/dust.png',
    flame: 'assets/sprites/flame.png',
    streak: 'assets/sprites/streak.png',
    coin: 'assets/sprites/coin.png',
    fireball: 'assets/sprites/fireball.png',
    foliage: 'assets/sprites/foliage.png',
    tree: 'assets/sprites/tree.png',
  },
  images: {
    run_0: 'assets/sprites/run_0.png',
    run_1: 'assets/sprites/run_1.png',
    run_2: 'assets/sprites/run_2.png',
    run_3: 'assets/sprites/run_3.png',
    title_bg: 'assets/ui/title_bg.jpg',
    demon_idol: 'assets/ui/demon_idol.png',
  },
};

function fallbackTexture(kind = 'noise') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (kind === 'flat') {
    g.fillStyle = '#6b6f5a'; g.fillRect(0, 0, 64, 64);
  } else {
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = 90 + ((x * 7 + y * 13) % 60);
        g.fillStyle = `rgb(${v},${v + 6},${v - 12})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Assets {
  constructor() {
    this.textures = {};
    this.images = {};
    this.three = {};
    this.missing = new Set();
  }

  image(name) { return this.images[name]; }
  tex(name) { return this.three[name]; }

  async load(onProgress = () => {}) {
    const texEntries = Object.entries(MANIFEST.textures);
    const imgEntries = Object.entries(MANIFEST.images);
    const total = texEntries.length + imgEntries.length;
    let done = 0;
    const tick = () => onProgress(++done / total);

    const loader = new THREE.TextureLoader();
    const texJobs = texEntries.map(async ([key, url]) => {
      try {
        const t = await loader.loadAsync(url);
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        this.three[key] = t;
      } catch (e) {
        this.missing.add(key);
        this.three[key] = fallbackTexture(key === 'stone_path' || key === 'sky_pano' ? 'flat' : 'noise');
      }
      tick();
    });

    const imgJobs = imgEntries.map(([key, url]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images[key] = img; tick(); resolve(); };
      img.onerror = () => { this.missing.add(key); this.images[key] = null; tick(); resolve(); };
      img.src = url;
    }));

    await Promise.all([...texJobs, ...imgJobs]);

    // sprite sheets for animation need clamped (non repeating) filtering
    ['glow', 'shadow', 'spark', 'dust', 'flame', 'streak', 'coin', 'fireball', 'foliage', 'tree'].forEach((k) => {
      const t = this.three[k];
      if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; }
    });
    return this;
  }

  /**
   * Character run-cycle frames, optionally recoloured (hue/sat/bright via
   * canvas filters) so unlockable skins need no extra art. The run frames are
   * loaded as images, so they are always wrapped into textures here (cached).
   */
  characterFrames(opts = {}) {
    const { hue = 0, sat = 1, bright = 1, tint = null } = opts;
    const cacheKey = `${hue}|${sat}|${bright}|${tint}`;
    this._charCache = this._charCache || new Map();
    if (this._charCache.has(cacheKey)) return this._charCache.get(cacheKey);

    const frames = [];
    for (let i = 0; i < 4; i++) {
      const img = this.images[`run_${i}`];
      if (!img) continue;
      const src = tintImage(img, { hue, sat, bright, tint });
      const t = new THREE.CanvasTexture(src);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 8;
      t.needsUpdate = true;
      frames.push(t);
    }
    this._charCache.set(cacheKey, frames);
    return frames;
  }
}
