// Turns a level definition (ASCII rows) into a playable, mutable level.
import { TILE } from './config.js';

// Tiles that block movement.
export const SOLID = new Set(['#', '=', 'B', '?', 'M', 'x', 'P']);
// Hazard tiles (spikes): hurt on contact, not solid.
export const HAZARD = new Set(['w']);

export function parseLevel(data) {
  const rows = data.rows.map((r) => r.split(''));
  const cols = rows[0].length;
  const grid = rows; // mutated as blocks get hit / bricks break
  const level = {
    id: data.id,
    name: data.name,
    theme: data.theme ?? 'grass',
    timeLimit: data.timeLimit,
    cols,
    rowCount: rows.length,
    pxW: cols * TILE,
    pxH: rows.length * TILE,
    grid,
    spawn: null,
    enemies: [],
    coins: [],
    goals: [],
  };

  for (let ty = 0; ty < rows.length; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const c = grid[ty][tx];
      const x = tx * TILE;
      const bottom = (ty + 1) * TILE;
      switch (c) {
        case '@':
          level.spawn = { x: x + (TILE - 30) / 2, y: bottom - 44 };
          grid[ty][tx] = '.';
          break;
        case 'o':
          level.coins.push({ x: x + TILE / 2 - 12, y: ty * TILE + TILE / 2 - 12, w: 24, h: 24, taken: false });
          grid[ty][tx] = '.';
          break;
        case 'e': case 'n': case 'f':
          level.enemies.push({ kind: { e: 'slime', n: 'snail', f: 'fly' }[c], tx, ty });
          grid[ty][tx] = '.';
          break;
        case 'F':
          level.goals.push({ x: x + TILE / 2 - 6, y: ty * TILE, w: 12, h: TILE });
          break;
        default:
          break;
      }
    }
  }
  if (!level.spawn) throw new Error(`Level ${data.id} has no spawn (@)`);
  return level;
}

/** Solid test in tile coordinates. Walls at the sides and ceiling; open pit at the bottom. */
export function isSolid(level, tx, ty) {
  if (tx < 0 || tx >= level.cols || ty < 0) return true;
  if (ty >= level.rowCount) return false;
  return SOLID.has(level.grid[ty][tx]);
}

export function tileAt(level, tx, ty) {
  if (tx < 0 || tx >= level.cols || ty < 0 || ty >= level.rowCount) return '.';
  return level.grid[ty][tx];
}

/** Does the box overlap any hazard tile? */
export function touchesHazard(level, box) {
  const tx0 = Math.floor(box.x / TILE), tx1 = Math.floor((box.x + box.w - 0.01) / TILE);
  const ty0 = Math.floor(box.y / TILE), ty1 = Math.floor((box.y + box.h - 0.01) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (HAZARD.has(tileAt(level, tx, ty))) return true;
  }
  return false;
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
