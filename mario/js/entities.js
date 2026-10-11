// Moving things: the Hero, enemies, power-ups, pop-up coins and debris.
import { PHYS, RULES, TILE } from './config.js';
import { moveBody } from './physics.js';
import { isSolid } from './level.js';

export const ENEMY_STATS = {
  slime: { w: 40, h: 22, speed: 70, flying: false },
  snail: { w: 42, h: 24, speed: 55, flying: false },
  fly: { w: 50, h: 26, speed: 85, flying: true },
};

export class Hero {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 30; this.h = 44;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.big = false;
    this.onGround = false;
    this.blockedX = false;
    this.hitHead = null;
    this.coyote = 0; this.jumpBuf = 0; this.jumping = false;
    this.invuln = 0; this.animT = 0;
    this.dead = false;
  }

  setBig(big) {
    if (big === this.big) return;
    const bottom = this.y + this.h;
    this.big = big;
    this.h = big ? 62 : 44;
    this.y = bottom - this.h; // grow/shrink from the feet
  }

  /** Returns true if a jump started this frame. */
  update(input, dt) {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const cap = input.run ? PHYS.runMax : PHYS.walkMax;
    if (dir !== 0) {
      this.facing = dir;
      const accel = this.onGround ? PHYS.groundAccel : PHYS.airAccel;
      if (Math.abs(this.vx) > cap && Math.sign(this.vx) === dir) {
        // above the cap (e.g. after releasing run): ease down to it
        this.vx -= dir * 1200 * dt;
        if (Math.abs(this.vx) < cap) this.vx = cap * dir;
      } else {
        this.vx = Math.max(-cap, Math.min(cap, this.vx + dir * accel * dt));
      }
    } else {
      const fr = (this.onGround ? PHYS.friction : PHYS.airFriction) * dt;
      if (Math.abs(this.vx) <= fr) this.vx = 0; else this.vx -= Math.sign(this.vx) * fr;
    }

    this.vy = Math.min(this.vy + PHYS.gravity * dt, PHYS.maxFall);

    if (input.jumpPressed) this.jumpBuf = PHYS.jumpBuffer;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    if (this.onGround) this.coyote = PHYS.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);

    let jumped = false;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = -PHYS.jumpV;
      this.jumpBuf = 0; this.coyote = 0; this.jumping = true;
      jumped = true;
    }
    // variable jump height: letting go early shortens the hop
    if (this.jumping && !input.jumpHeld && this.vy < 0) {
      this.vy *= PHYS.jumpCut; this.jumping = false;
    }
    if (this.vy >= 0) this.jumping = false;

    this.invuln = Math.max(0, this.invuln - dt);
    this.animT += dt;
    return jumped;
  }
}

export class Enemy {
  constructor(kind, tx, ty) {
    const s = ENEMY_STATS[kind];
    this.kind = kind;
    this.w = s.w; this.h = s.h;
    this.speed = s.speed;
    this.flying = s.flying;
    this.x = tx * TILE + (TILE - this.w) / 2;
    this.y = this.flying ? ty * TILE + (TILE - this.h) / 2 : (ty + 1) * TILE - this.h;
    this.baseY = this.y;
    this.startX = this.x;
    this.vx = 0; this.vy = 0;
    this.dir = -1;
    this.alive = true;
    this.squashT = 0;     // > 0 while showing the squashed corpse
    this.animT = (tx * 0.37) % 2; // deterministic phase so every run plays the same
    this.blockedX = false; this.onGround = false; this.hitHead = null;
  }

  get removable() { return !this.alive && this.squashT <= 0; }

  update(level, dt) {
    this.animT += dt;
    if (!this.alive) {
      this.squashT -= dt;
      this.vy = Math.min(this.vy + PHYS.gravity * dt, PHYS.maxFall);
      this.y += this.vy * dt;
      return;
    }
    if (this.flying) {
      this.vx = this.dir * this.speed;
      this.x += this.vx * dt;
      if (this.x < this.startX - 150 || this.x > this.startX + 150) this.dir *= -1;
      this.y = this.baseY + Math.sin(this.animT * 3) * 14;
      const front = this.dir > 0 ? Math.floor((this.x + this.w + 2) / TILE) : Math.floor((this.x - 2) / TILE);
      if (isSolid(level, front, Math.floor((this.y + this.h / 2) / TILE))) this.dir *= -1;
      return;
    }
    this.vx = this.dir * this.speed;
    moveBody(this, level, dt);
    if (this.blockedX) this.dir *= -1;
    if (this.onGround) {
      // turn around at ledges
      const ahead = this.dir > 0 ? Math.floor((this.x + this.w + 2) / TILE) : Math.floor((this.x - 2) / TILE);
      const under = Math.floor((this.y + this.h + 4) / TILE);
      if (!isSolid(level, ahead, under)) this.dir *= -1;
    }
  }

  stomp() {
    this.alive = false;
    this.squashT = 0.5;
    this.vx = 0; this.vy = -120;
  }
}

export class CoinPop {
  constructor(x, y) { this.x = x + TILE / 2 - 12; this.y = y - 6; this.vy = -330; this.t = 0; }
  get done() { return this.t > 0.55; }
  update(dt) { this.t += dt; this.vy += 1200 * dt; this.y += this.vy * dt; }
}

export class Mushroom {
  constructor(tx, ty) {
    this.w = 40; this.h = 40;
    this.x = tx * TILE + 4;
    this.y = ty * TILE + 2;
    this.targetY = this.y - TILE;
    this.rising = true;
    this.vx = 0; this.vy = 0;
    this.dir = 1;
    this.alive = true;
    this.blockedX = false; this.onGround = false; this.hitHead = null;
  }
  update(level, dt) {
    if (this.rising) {
      this.y -= 90 * dt;
      if (this.y <= this.targetY) { this.y = this.targetY; this.rising = false; }
      return;
    }
    this.vx = this.dir * 95;
    this.vy = Math.min(this.vy + PHYS.gravity * dt, PHYS.maxFall);
    moveBody(this, level, dt);
    if (this.blockedX) this.dir *= -1;
    if (this.y > level.pxH + 200) this.alive = false;
  }
}

export class Debris {
  constructor(x, y, img, rnd = Math.random) {
    this.x = x; this.y = y; this.img = img;
    this.vx = (rnd() - 0.5) * 320; this.vy = -200 - rnd() * 200;
    this.t = 0; this.rot = 0;
  }
  get done() { return this.t > 0.9; }
  update(dt) { this.t += dt; this.vy += 1400 * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.rot += dt * 8; }
}
