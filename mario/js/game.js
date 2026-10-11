// Game rules and state machine. Pure JavaScript: no DOM, no timers, no audio.
// The renderer and UI read from it; sounds are driven by the `events` queue.
import { PHYS, RULES, SCORE, TILE } from './config.js';
import { parseLevel, overlaps, touchesHazard, tileAt } from './level.js';
import { moveBody } from './physics.js';
import { Hero, Enemy, CoinPop, Mushroom, Debris } from './entities.js';

export const STATES = Object.freeze({ PLAYING: 'playing', CLEARING: 'clearing', CLEARED: 'cleared', DYING: 'dying', LOST: 'lost' });

export class Game {
  /**
   * @param {object} data     level definition from the server
   * @param {object} session  shared across levels: { lives, score, coins }
   */
  constructor(data, session) {
    this.level = parseLevel(data);
    this.session = session;
    this.hero = new Hero(this.level.spawn.x, this.level.spawn.y);
    this.enemies = this.level.enemies.map((e) => new Enemy(e.kind, e.tx, e.ty));
    this.coins = this.level.coins;
    this.mushrooms = [];
    this.popups = [];
    this.debris = [];
    this.timeLeft = this.level.timeLimit;
    this.state = STATES.PLAYING;
    this.stateT = 0;
    this.deathReason = null;
    this.events = [];
    this.clearBonus = 0;
    this.landed = false;
    this.stompCount = 0;
  }

  get timeUsed() { return this.level.timeLimit - this.timeLeft; }

  /** Pops the queued gameplay events (for sound and UI). */
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  /** @param input {left,right,run,jumpHeld,jumpPressed} */
  update(rawDt, input) {
    const dt = Math.min(Math.max(rawDt, 0), 1 / 30);
    if (this.state === STATES.PLAYING) this.stateT += dt;
    else if (this.state === STATES.CLEARING || this.state === STATES.DYING) this.stateT += dt;
    else return;

    if (this.state === STATES.PLAYING) this.#play(dt, input);
    else if (this.state === STATES.CLEARING) this.#clearing(dt);
    else if (this.state === STATES.DYING) this.#dying(dt);
  }

  #play(dt, input) {
    const { hero, level } = this;
    if (hero.update(input, dt)) this.emit('jump');

    const prevBottom = hero.y + hero.h;
    moveBody(hero, level, dt);
    if (hero.hitHead) this.#hitBlock(hero.hitHead.tx, hero.hitHead.ty);

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.#kill('time'); return; }

    this.enemies = this.enemies.filter((e) => !e.removable);
    for (const e of this.enemies) e.update(level, dt);
    this.#collideEnemies(prevBottom);
    if (this.state !== STATES.PLAYING) return;

    for (const c of this.coins) {
      if (!c.taken && overlaps(hero, c)) { c.taken = true; this.#addCoin(SCORE.coin, c.x + c.w / 2, c.y); }
    }

    for (const m of this.mushrooms) {
      m.update(level, dt);
      if (m.alive && overlaps(hero, m)) {
        m.alive = false;
        hero.setBig(true);
        this.session.score += SCORE.powerup;
        this.emit('powerup');
      }
    }
    this.mushrooms = this.mushrooms.filter((m) => m.alive);

    for (const p of this.popups) p.update(dt);
    this.popups = this.popups.filter((p) => !p.done);
    for (const d of this.debris) d.update(dt);
    this.debris = this.debris.filter((d) => !d.done);

    if (touchesHazard(level, hero)) { this.#hurt('spikes'); if (this.state !== STATES.PLAYING) return; }
    if (hero.y > level.pxH) { this.#kill('fall'); return; }
    if (level.goals.some((g) => overlaps(hero, g))) this.#startClear();
  }

  #collideEnemies(prevBottom) {
    const { hero } = this;
    for (const e of this.enemies) {
      if (!e.alive || !overlaps(hero, e)) continue;
      const stomping = hero.vy >= 0 && prevBottom <= e.y + 14;
      if (stomping) {
        e.stomp();
        hero.vy = -PHYS.stompV;
        hero.onGround = false;
        this.session.score += SCORE.stomp;
        this.stompCount++;
        this.emit('stomp', { x: e.x + e.w / 2, y: e.y, points: SCORE.stomp });
      } else {
        this.#hurt('enemy');
        if (this.state !== STATES.PLAYING) return;
      }
    }
  }

  #hurt(cause) {
    const { hero } = this;
    if (hero.invuln > 0) return;
    if (hero.big) {
      hero.setBig(false);
      hero.invuln = RULES.invulnTime;
      this.emit('hurt');
      return;
    }
    this.#kill(cause);
  }

  #kill(reason) {
    if (this.state !== STATES.PLAYING) return;
    this.state = STATES.DYING;
    this.stateT = 0;
    this.deathReason = reason;
    this.hero.dead = true;
    this.hero.vx = 0;
    this.hero.vy = reason === 'fall' ? 0 : -RULES.deathHop;
    this.emit('death', { reason });
  }

  #dying(dt) {
    const { hero } = this;
    hero.vy = Math.min(hero.vy + PHYS.gravity * dt, PHYS.maxFall);
    hero.y += hero.vy * dt;
    hero.animT += dt;
    const duration = this.deathReason === 'fall' ? 0.9 : RULES.deathTime;
    if (this.stateT >= duration) { this.state = STATES.LOST; this.emit('lost'); }
  }

  #addCoin(points, x, y) {
    this.session.coins += 1;
    this.session.score += points;
    if (this.session.coins >= RULES.coinsPerLife) {
      this.session.coins -= RULES.coinsPerLife;
      this.session.lives += 1;
      this.emit('oneup', { x, y });
    } else {
      this.emit('coin', { x, y, points });
    }
  }

  #hitBlock(tx, ty) {
    const { level } = this;
    const c = tileAt(level, tx, ty);
    if (c === '?') {
      level.grid[ty][tx] = 'x';
      this.popups.push(new CoinPop(tx * TILE, ty * TILE));
      this.#addCoin(SCORE.coin, tx * TILE + TILE / 2, ty * TILE - 6);
    } else if (c === 'M') {
      level.grid[ty][tx] = 'x';
      this.mushrooms.push(new Mushroom(tx, ty));
      this.emit('reveal');
    } else if (c === 'B') {
      if (this.hero.big) {
        level.grid[ty][tx] = '.';
        const keys = ['particleBrick1a', 'particleBrick1b', 'particleBrick2a', 'particleBrick2b'];
        keys.forEach((k, i) => this.debris.push(new Debris(tx * TILE + 8 + i * 10, ty * TILE + 8, k)));
        this.session.score += SCORE.brick;
        this.emit('break');
      } else {
        this.emit('bump');
      }
    } else if (c === 'x') {
      this.emit('bump');
    }
  }

  #startClear() {
    this.state = STATES.CLEARING;
    this.stateT = 0;
    const goal = this.level.goals[0];
    const hero = this.hero;
    hero.x = goal.x - hero.w + 10; // hang from the pole
    hero.vx = 0; hero.vy = 0;
    hero.facing = 1;
    this.emit('flag');
  }

  #clearing(dt) {
    const { hero, level } = this;
    if (!this.landed) {
      hero.vy = 260; // slide down the pole
      moveBody(hero, level, dt);
      hero.animT += dt;
      if (hero.onGround) {
        this.landed = true;
        this.landedAt = this.stateT;
        hero.vy = 0;
        hero.x += 20;
      }
      return;
    }
    hero.vx = 130;
    hero.vy = Math.min(hero.vy + PHYS.gravity * dt, PHYS.maxFall);
    moveBody(hero, level, dt);
    hero.animT += dt;
    if (this.stateT - this.landedAt >= RULES.clearDelay) {
      this.state = STATES.CLEARED;
      this.clearBonus = SCORE.flagBase + Math.round(this.timeLeft) * SCORE.timePerSecond;
      this.session.score += this.clearBonus;
      this.emit('cleared');
    }
  }
}

export { parseLevel };
