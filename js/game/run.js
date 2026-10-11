/**
 * A single run: physics, spawning, collisions, coins, power-ups, zones,
 * demon-monkey chases, death and revive. Contains no rendering code, so the
 * whole simulation can be exercised headlessly (see tools/headless_test.mjs).
 */
import * as THREE from '../../vendor/three.module.js';
import { LANES, SPEED, POWERUPS, SCORE, ZONES, PLAYER } from '../core/config.js';
import { clamp, damp, lerp } from '../core/rng.js';
import { Player } from './player.js';
import { Entities, OBSTACLES } from './entities.js';
import { Spawner } from './spawner.js';
import { createBus } from '../core/store.js';

const INTRO_TIME = 3.4;

export class Run {
  constructor({ scene, assets, fx, audio = null, env = null, camera = null, quality = 'high', seed = 1337, rng }) {
    this.scene = scene;
    this.assets = assets;
    this.fx = fx;
    this.audio = audio;
    this.env = env;
    this.camera = camera;
    this.rng = rng;
    this.bus = createBus();

    this.player = new Player(scene ? scene : new THREE.Scene(), assets, fx);
    this.entities = new Entities(scene || new THREE.Scene(), assets, fx, 1);
    this.spawner = new Spawner(this.entities, rng, fx);
    this.powers = { magnet: 0, boost: 0, shield: false, x2: 0 };
    this.chasers = [];
    this.state = 'idle';
    this.reset(seed);
  }

  reset(seed) {
    this.player.reset();
    this.entities.releaseAll();
    this.spawner.reset();
    this.rng && (this.spawner.rng = this.rng);
    this.time = 0;
    this.timeScale = 1;
    this.distance = 0;
    this.score = 0;
    this.coins = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.nearMiss = 0;
    this.zoneIndex = 0;
    this.speed = SPEED.start;
    this.baseSpeed = SPEED.start;
    this.powers = { magnet: 0, boost: 0, shield: false, x2: 0 };
    this.invuln = 0;
    this.state = 'idle';
    this.deathReason = null;
    this.deathTimer = 0;
    this.introT = 0;
    this.stumbleFx = 0;
    this.chaseGrowl = 0;
    for (const c of this.chasers) this.entities.release(c);
    this.chasers = [];
    this.stats = { nearMiss: 0, jumps: 0, slides: 0, powerups: 0, idols: 0 };
  }

  start({ cinematic = true } = {}) {
    this.reset(this.seed);
    this.state = cinematic ? 'intro' : 'playing';
    this.introT = 0;
    if (this.audio) this.audio.setIntensity(0.1);
    if (cinematic) this._spawnChasers(3);
    return this;
  }

  get speedRatio() { return clamp((this.baseSpeed - SPEED.start) / (SPEED.max - SPEED.start), 0, 1); }
  get isPlaying() { return this.state === 'playing' || this.state === 'intro'; }
  get isOver() { return this.state === 'dead' || this.state === 'dying'; }
  get zone() { return ZONES[this.zoneIndex]; }
  get effectiveSpeed() {
    let s = this.baseSpeed;
    if (this.powers.boost > 0) s *= SPEED.boostMul;
    if (this.player.stumbleTimer > 0) s *= SPEED.stumbleMul;
    return s;
  }

  // -------------------------------------------------------------- controls
  input(action) {
    if (this.state !== 'playing' && this.state !== 'intro') return;
    const p = this.player;
    switch (action) {
      case 'left': if (p.moveLane(-1)) this.audio && this.audio.play('whoosh'); break;
      case 'right': if (p.moveLane(1)) this.audio && this.audio.play('whoosh'); break;
      case 'jump':
        if (this.state === 'intro') break;
        if (p.jump()) { this.stats.jumps++; this.audio && this.audio.play('jump'); }
        break;
      case 'slide':
        if (this.state === 'intro') break;
        if (p.slide()) { this.stats.slides++; this.audio && this.audio.play('slide'); }
        break;
      default: break;
    }
  }

  /**
   * Menu showcase: the character jogs along the track with idle lane changes
   * while the camera orbits. No spawning, no collisions, no scoring.
   */
  updateDemo(dt) {
    this.time += dt;
    this.demoLaneTimer = (this.demoLaneTimer || 2.5) - dt;
    if (this.demoLaneTimer <= 0) {
      this.demoLaneTimer = 2.4 + Math.random() * 3.2;
      const dir = Math.random() < 0.5 ? -1 : 1;
      if (!this.player.moveLane(dir)) this.player.moveLane(-dir);
      if (Math.random() < 0.35) this.player.jump();
      else if (Math.random() < 0.3) this.player.slide();
    }
    const speed = 11.5;
    const distance = speed * dt;
    if (this.env) this.env.update(dt, distance, speed, { x: this.player.x, z: 0 }, 0);
    this.player.update(dt, {
      speed, time: this.time, fx: this.fx, audio: null, powers: {}, dt,
    });
  }

  // ---------------------------------------------------------------- update
  update(dtRaw) {
    if (this.state === 'idle') return;
    const dt = Math.min(dtRaw, 1 / 30) * this.timeScale;
    this.time += dt;

    if (this.state === 'intro') {
      this.introT += dt;
      if (this.introT >= INTRO_TIME) {
        this.state = 'playing';
        this._releaseChasers(true);
      }
    }

    // --- speed ramp
    const targetBase = Math.min(SPEED.max, SPEED.start + SPEED.accel * this.time);
    this.baseSpeed = damp(this.baseSpeed, targetBase, 1.6, dt);
    this.speed = this.effectiveSpeed;
    const distance = this.speed * dt;
    this.distance += distance;

    // --- powers
    for (const k of ['magnet', 'boost', 'x2']) {
      if (this.powers[k] > 0) {
        this.powers[k] = Math.max(0, this.powers[k] - dt);
        if (this.powers[k] === 0) this.bus.emit('powerEnd', { power: k });
      }
    }
    if (this.invuln > 0) this.invuln -= dt;

    // --- zone progression
    let zi = 0;
    for (let i = 0; i < ZONES.length; i++) if (this.distance >= ZONES[i].at) zi = i;
    if (zi !== this.zoneIndex) {
      this.zoneIndex = zi;
      const zone = ZONES[zi];
      if (this.env) this.env.applyZone(zone);
      if (this.audio) this.audio.setZone(zone.id);
      this.bus.emit('zone', zone);
    }

    const ctx = {
      distance, speed: this.speed, time: this.time, dt,
      zone: this.zone, player: this.player, entities: this.entities,
      audio: this.audio, fx: this.fx, powers: this.powers,
      difficulty: this.spawner.difficulty(),
      onHardLand: () => this.fx && this.fx.landPuff(this.player.x, 0.4),
    };

    // --- world
    if (this.env) this.env.update(dt, distance, this.speed, { x: this.player.x, z: 0 }, this.speedRatio);
    if (this.state !== 'dying' && this.state !== 'dead') {
      this.spawner.update(dt, ctx);
    }
    this.entities.update(dt, ctx);

    // --- player
    const playerCtx = { ...ctx, speed: this.speed };
    this.player.update(dt, playerCtx);

    // --- magnet + pickups + collisions
    if (this.state === 'playing') {
      this._magnet(dt, ctx);
      this._collisions(ctx);
      this._nearMisses();
    } else if (this.state === 'intro') {
      this._magnet(dt, ctx);
    }

    // --- demon monkey chase behaviour
    this._updateChasers(dt);

    // --- scoring
    if (this.state === 'playing' || this.state === 'intro') {
      this.score += distance * SCORE.perUnit * (this.powers.boost > 0 ? 1.4 : 1);
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) { this.combo = 0; this.bus.emit('comboEnd', {}); }
      }
    }

    // --- death sequence
    if (this.state === 'dying') {
      this.deathTimer += dtRaw;
      this.timeScale = damp(this.timeScale, 0.25, 3, dt);
      if (this.deathTimer > 0.9) {
        this.state = 'dead';
        this.timeScale = 1;
        this.bus.emit('death', { reason: this.deathReason, stats: this.snapshot() });
      }
    }

    // --- audio intensity follows speed
    if (this.audio) this.audio.setIntensity(this.speedRatio);

    if (this.camera && this.state !== 'idle') {
      if (this.state === 'intro') {
        this.camera.introUpdate(this.introT / INTRO_TIME, this.player);
      } else {
        this.camera.update(dt, {
          player: this.player,
          speed: this.speed,
          speedRatio: this.speedRatio,
          boosting: this.powers.boost > 0,
          dead: this.isOver,
          shake: this.fx ? this.fx.shake : 0,
        });
      }
    }
    this.bus.emit('tick', this.snapshot());
  }

  // ------------------------------------------------------------- mechanics
  _magnet(dt, ctx) {
    const p = this.player;
    const magnetOn = this.powers.magnet > 0;
    for (const e of this.entities.active) {
      if (e.type !== 'coin' || e.meta.taken) continue;
      const g = e.group.position;
      const dz = g.z - 0;
      const dx = g.x - p.x;

      // pickup check (with slide/jump tolerance)
      const inZ = Math.abs(dz) < 1.15;
      const inX = Math.abs(dx) < 0.85;
      const py = p.y + (p.state === 'slide' ? PLAYER.slideHeight : PLAYER.height) * 0.55;
      const inY = Math.abs(g.y - Math.max(py, 0.75)) < 1.35;
      if (inZ && inX && inY) {
        this._collectCoin(e, ctx);
        continue;
      }
      if (magnetOn && dz > -1 && dz < 16 && Math.abs(dx) < 5.2) {
        const pull = (16 - dz) * 0.9;
        g.x += Math.sign(dx) * Math.min(Math.abs(dx), pull * dt);
        g.y += (1.0 - g.y) * Math.min(1, 3 * dt);
      }
    }

    // power-up orbs
    for (const e of this.entities.active) {
      if (e.type !== 'powerup' || e.meta.taken) continue;
      const g = e.group.position;
      if (Math.abs(g.z) < 1.4 && Math.abs(g.x - p.x) < 1.1 && p.y < 2.0) {
        this._collectPowerup(e, ctx);
      }
    }
    // golden idol
    for (const e of this.entities.active) {
      if (e.type !== 'idol' || e.meta.taken) continue;
      const g = e.group.position;
      if (Math.abs(g.z) < 1.8 && Math.abs(g.x - p.x) < 1.3 && p.y < 2.4) {
        e.meta.taken = true;
        this.stats.idols++;
        const bonus = SCORE.perIdol;
        this.score += bonus;
        this.coins += 25;
        this.bus.emit('idol', { bonus, coins: 25 });
        this.fx && this.fx.magicBurst({ x: g.x, y: g.y, z: g.z });
        this.fx && this.fx.confetti({ x: g.x, y: g.y, z: g.z }, 18);
        this.audio && this.audio.play('idol');
        this.entities.release(e);
      }
    }
  }

  _collectCoin(e, ctx) {
    e.meta.taken = true;
    const mult = this.powers.x2 > 0 ? 2 : 1;
    const value = 1 * mult;
    this.coins += value;
    this.score += SCORE.perCoin * value;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = 2.4;
    this.fx && this.fx.coinPickup(e.group.position, this.powers.x2 > 0 ? 0xa8ff8a : 0xffe07a);
    this.audio && this.audio.play('coin', { combo: Math.min(this.combo, 12) });
    this.bus.emit('coin', { total: this.coins, combo: this.combo, value });
    this.entities.release(e);
  }

  _collectPowerup(e, ctx) {
    e.meta.taken = true;
    const power = e.power;
    this.stats.powerups++;
    if (power === 'shield') {
      this.powers.shield = true;
    } else {
      this.powers[power] = POWERUPS[power].time;
    }
    this.score += SCORE.powerup;
    this.fx && this.fx.powerupBurst(e.group.position, e.group.userData.orb.material.color.getHex());
    this.audio && this.audio.play('powerup');
    this.bus.emit('powerup', { power, label: POWERUPS[power].label, time: POWERUPS[power].time });
    this.entities.release(e);
  }

  _collisions(ctx) {
    const p = this.player;
    const b = p.bounds();
    for (const e of this.entities.active) {
      if (e.kind !== 'obstacle') continue;
      const hb = e.hitbox || OBSTACLES[e.type];
      if (!hb) continue;
      const g = e.group.position;
      if (Math.abs(g.z) > hb.depth / 2 + b.halfD) continue;

      const overlapX = (hb.halfW + b.halfW) - Math.abs(g.x - b.x);
      if (overlapX <= 0) continue;
      const overlapY = Math.min(hb.yMax, b.yMax) - Math.max(hb.yMin, b.yMin);
      if (overlapY <= 0) continue;

      // clear hit. Decide outcome: glancing clip -> stumble, solid -> death.
      const glancing = overlapX < 0.34 && hb.action === 'dodge';
      if (glancing && this.powers.shield === false && this.invuln <= 0) {
        this._stumble(g);
        continue;
      }
      this._resolveHit(e, g, 'obstacle');
    }

    // flames and beasts
    for (const e of this.entities.active) {
      const g = e.group.position;
      if (e.type === 'fireball') {
        // a slide (low profile) or a leap lets a fireball whip overhead
        if (Math.abs(g.z) < 0.9 && Math.abs(g.x - b.x) < 0.72 && g.y > b.yMin + 0.25 && g.y < b.yMax + 0.10) {
          this._resolveHit(e, g, 'fireball');
        }
      } else if (e.type === 'howler' && !e.meta.chaser) {
        // dive under it, leap over it or switch lanes
        if (Math.abs(g.z) < 1.2 && Math.abs(g.x - b.x) < 1.0 && g.y > b.yMin + 0.15 && g.y < b.yMax + 0.25) {
          this._resolveHit(e, g, 'howler');
        }
      }
    }
  }

  _resolveHit(e, g, reason) {
    if (this.invuln > 0) return;
    // turbo smashes straight through anything
    if (this.powers.boost > 0) {
      this.entities.release(e);
      this.fx && this.fx.hitBurst({ x: g.x, y: Math.max(0.5, g.y), z: g.z });
      this.audio && this.audio.play('hit');
      this.score += 15;
      return;
    }
    if (this.powers.shield) {
      this.powers.shield = false;
      this.invuln = 1.0;
      this.fx && this.fx.shieldHit({ x: g.x, y: g.y, z: g.z });
      this.audio && this.audio.play('shield');
      this.bus.emit('shieldBreak', {});
      // shatter the obstacle out of the way
      if (e.kind === 'obstacle' || e.type === 'fireball' || e.type === 'howler') {
        this.entities.release(e);
      }
      return;
    }
    this._die(reason);
  }

  _stumble(g) {
    const p = this.player;
    p.stumble(0.85);
    this.invuln = 1.1;
    this.fx && this.fx.hitBurst({ x: g.x, y: 0.6, z: g.z });
    this.audio && this.audio.play('growl');
    this.bus.emit('stumble', {});
    this._spawnChasers(2, true);
  }

  _die(reason) {
    if (this.isOver) return;
    this.deathReason = reason;
    this.state = 'dying';
    this.deathTimer = 0;
    this.timeScale = 0.45;
    this.player.hit();
    this.audio && this.audio.play('hit');
    this.audio && this.audio.stopMusic(1.2);
    this.fx && this.fx.clear();
    this.fx && this.fx.hitBurst({ x: this.player.x, y: 1.0, z: 0 });
    this.bus.emit('dying', { reason });
    // demon monkeys pounce
    this._spawnChasers(3, true, true);
  }

  _nearMisses() {
    const p = this.player;
    for (const e of this.entities.active) {
      if (e.kind !== 'obstacle' || e.meta.nearMissed) continue;
      const g = e.group.position;
      if (Math.abs(g.z) < 1.6 && this.player.y > 1.2) {
        const dx = Math.abs(g.x - p.x);
        if (dx > p.bounds().halfW + (e.hitbox?.halfW || 1) - 0.05 && dx < 2.3) {
          e.meta.nearMissed = true;
          this.nearMiss += 1;
          this.stats.nearMiss++;
          this.score += SCORE.nearMiss;
          this.bus.emit('nearMiss', { total: this.nearMiss });
        }
      }
    }
  }

  // --------------------------------------------------------- demon monkeys
  _spawnChasers(count, lunge = false, pounce = false) {
    for (let i = 0; i < count; i++) {
      const e = this.entities.spawn('howler', {
        lane: this.rng.int(0, 2),
        y: 1.7 + Math.random() * 0.9,
        z: pounce ? (this.player.lane - 1) * -0.5 + 1.4 + Math.random() : 3.2 + i * 1.6 + Math.random(),
        meta: { chaser: true, targetX: LANES[Math.max(0, Math.min(2, this.player.lane + (i - 1)))] },
      });
      if (!e) continue;
      e.meta.chaser = true;
      e.meta.lunge = lunge;
      e.meta.pounce = pounce;
      e.meta.chaseTimer = pounce ? 1.6 : 2.6 + Math.random() * 1.4;
      this.chasers.push(e);
    }
    if (count && this.audio) this.audio.play('growl');
  }

  _releaseChasers(flee = false) {
    for (const c of this.chasers) {
      if (flee) {
        c.meta.fleeing = true;
        c.meta.chaseTimer = 1.1;
      } else {
        this.entities.release(c);
      }
    }
    this.chasers = this.chasers.filter((c) => c.meta.fleeing);
  }

  _updateChasers(dt) {
    for (let i = this.chasers.length - 1; i >= 0; i--) {
      const c = this.chasers[i];
      if (!c.alive) { this.chasers.splice(i, 1); continue; }
      c.meta.chaseTimer -= dt;
      const g = c.group.position;
      if (c.meta.fleeing) {
        g.y += dt * 7;
        g.z -= dt * 6;
        if (g.y > 12) { this.entities.release(c); this.chasers.splice(i, 1); }
        continue;
      }
      if (c.meta.pounce) {
        const target = new THREE.Vector3(this.player.x, 1.0, 0.4);
        g.lerp(target, Math.min(1, dt * 1.7));
      } else {
        // lurk just behind the player, weaving
        const tx = this.player.x + Math.sin(this.time * 2 + i) * 1.1;
        g.x = damp(g.x, tx, 2.2, dt);
        g.z = damp(g.z, 3.0 + i * 1.5, 1.6, dt);
      }
      if (c.meta.chaseTimer <= 0 && !c.meta.pounce) {
        this.entities.release(c);
        this.chasers.splice(i, 1);
      }
      if (Math.random() < dt * 3) {
        this.fx && this.fx.spawn('glow', {
          x: g.x + (Math.random() - 0.5), y: g.y, z: g.z,
          vz: 1, life: 0.4, size: 0.24, color: 0xff4a2a,
        });
      }
    }
  }

  // ----------------------------------------------------------------- misc
  snapshot() {
    return {
      state: this.state,
      score: Math.floor(this.score),
      coins: this.coins,
      distance: Math.floor(this.distance),
      combo: this.combo,
      maxCombo: this.maxCombo,
      speed: this.speed,
      speedRatio: this.speedRatio,
      zone: this.zone,
      power: this.powerSnapshot(),
      reason: this.deathReason,
    };
  }

  powerSnapshot() {
    return {
      magnet: this.powers.magnet,
      boost: this.powers.boost,
      shield: this.powers.shield,
      x2: this.powers.x2,
    };
  }

  /** Second-chance revive: clear the path and become briefly invulnerable. */
  revive() {
    if (!this.isOver) return;
    this.state = 'playing';
    this.timeScale = 1;
    this.invuln = 3.2;
    this.player.dead = false;
    this.player.vy = 0;
    this.player.y = 0;
    this.player.group.rotation.set(0, 0, 0);
    this.player.state = 'run';
    this.player.reset();
    // clear everything close to the player
    for (const e of [...this.entities.active]) {
      if (e.group.position.z > -34 && e.group.position.z < 20) this.entities.release(e);
    }
    this._releaseChasers(true);
    this.chasers = [];
    for (const e of this.entities.active) if (e.type === 'howler' && e.meta.pounce) this.entities.release(e);
    this.fx && this.fx.magicBurst({ x: this.player.x, y: 1, z: 0 });
    this.audio && this.audio.play('revive');
    this.audio && this.audio.startMusic();
    this.bus.emit('revive', {});
    this.baseSpeed = Math.max(SPEED.start, this.baseSpeed * 0.82);
  }

  dispose() {
    this.entities.releaseAll();
    this._releaseChasers();
  }
}
