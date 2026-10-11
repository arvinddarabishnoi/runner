// Axis-separated tile collision. Each body is moved along X, resolved against
// the tiles, then moved along Y and resolved again. Bodies carry these flags
// afterwards: onGround, blockedX, hitHead (the tile whose underside was struck).
import { TILE } from './config.js';
import { isSolid } from './level.js';

const EPS = 0.01;

export function moveBody(body, level, dt) {
  body.blockedX = false;
  body.hitHead = null;

  // ---- X axis
  body.x += body.vx * dt;
  const ty0 = Math.floor((body.y + EPS) / TILE);
  const ty1 = Math.floor((body.y + body.h - EPS) / TILE);
  if (body.vx > 0) {
    const tx = Math.floor((body.x + body.w - EPS) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (isSolid(level, tx, ty)) { body.x = tx * TILE - body.w; body.vx = 0; body.blockedX = true; break; }
    }
  } else if (body.vx < 0) {
    const tx = Math.floor((body.x + EPS) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (isSolid(level, tx, ty)) { body.x = (tx + 1) * TILE; body.vx = 0; body.blockedX = true; break; }
    }
  }

  // ---- Y axis
  body.y += body.vy * dt;
  const tx0 = Math.floor((body.x + EPS) / TILE);
  const tx1 = Math.floor((body.x + body.w - EPS) / TILE);
  if (body.vy > 0) {
    const ty = Math.floor((body.y + body.h - EPS) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolid(level, tx, ty)) { body.y = ty * TILE - body.h; body.vy = 0; break; }
    }
  } else if (body.vy < 0) {
    const ty = Math.floor((body.y + EPS) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolid(level, tx, ty)) { body.y = (ty + 1) * TILE; body.vy = 0; body.hitHead = { tx, ty }; break; }
    }
  }

  // ---- ground probe: is there solid directly under the feet?
  body.onGround = false;
  if (body.vy >= 0) {
    const row = Math.floor((body.y + body.h + 0.5) / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (isSolid(level, tx, row)) { body.onGround = true; break; }
    }
  }
  return body;
}
