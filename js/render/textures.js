/**
 * Small procedural canvases (glow strips, shadow blobs, UI glyph textures)
 * plus texture/mesh helpers shared by the world builders.
 */
import * as THREE from '../../vendor/three.module.js';

export function canvasTexture(w, h, draw, { srgb = true, wrap = false } = {}) {
  // headless (tests) — callers tolerate a null map
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** Soft glowing strip used for the energy lines along the track edges. */
export function makeEdgeStripTexture(color = '#ffd27a') {
  return canvasTexture(16, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.28, color);
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(0.72, color);
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

/** Vertical gradient (transparent → colour) for decals / fog walls. */
export function makeGradientTexture(color = 'rgba(0,0,0,1)', power = 1) {
  return canvasTexture(4, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      grad.addColorStop(t, color.replace(/[\d.]+\)$/, `${Math.pow(1 - t, power).toFixed(3)})`));
    }
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
}

/** Round soft blob, tinted — used for shadows, dust and glows. */
export function makeBlobTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.45)'));
    grad.addColorStop(1, outer);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
}

/** Simulated soft shadow ellipse (radial falloff, slightly squashed). */
export function makeShadowTexture() {
  return canvasTexture(128, 64, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.62)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill();
  }, { srgb: false });
}

/** Recolour an image (canvas filters) — used for skins and shop previews. */
export function tintImage(img, { hue = 0, sat = 1, bright = 1, tint = null } = {}) {
  if (!img || typeof document === 'undefined') return img;
  const needs = hue || sat !== 1 || bright !== 1 || tint;
  if (!needs) return img;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  const parts = [];
  if (hue) parts.push(`hue-rotate(${Math.round(hue * 360)}deg)`);
  if (sat !== 1) parts.push(`saturate(${Number(sat.toFixed(3))})`);
  if (bright !== 1) parts.push(`brightness(${Number(bright.toFixed(3))})`);
  try { g.filter = parts.join(' ') || 'none'; } catch (e) { /* filter unsupported */ }
  g.drawImage(img, 0, 0);
  g.filter = 'none';
  if (tint) {
    g.globalCompositeOperation = 'color';
    g.fillStyle = `#${tint.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

export function setRepeat(tex, x, y) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(x, y);
  return t;
}

export function cloneTex(tex, repeatX, repeatY) {
  if (!tex) return null;
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** Billboarding that keeps the sprite upright (cylindrical billboard). */
export function makeUprightBillboard(mesh) {
  mesh.onBeforeRender = (renderer, scene, camera) => {
    const q = camera.quaternion;
    mesh.rotation.set(0, Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.x * q.x),
    ), 0);
  };
  return mesh;
}

export function makeSpriteMaterial(map, { color = 0xffffff, opacity = 1, additive = false, depthTest = true } = {}) {
  return new THREE.SpriteMaterial({
    map,
    color,
    opacity,
    transparent: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthTest,
    depthWrite: false,
    toneMapped: false,
  });
}
