/**
 * Track director. Emits "patterns" (small hand-designed chunks of track:
 * obstacle groups plus coin lines) at a fair, difficulty-scaled spacing.
 *
 * Fairness rules encoded here:
 *  - never block all three lanes with dodge-only obstacles
 *  - spacing is measured in *seconds* of reaction time, not meters, so the
 *    ramp stays beatable as speed rises
 *  - after a hard pattern, an easier one is forced (breather)
 */
import { LANES, DIFF } from '../core/config.js';
import { clamp, lerp } from '../core/rng.js';

const ZONE_OBSTACLES = {
  jungle: ['log', 'firepit', 'spikes', 'vines', 'rollinglog', 'stonewall'],
  ruins: ['stonewall', 'statue', 'tiki', 'ledge', 'firewall', 'vines', 'spikes'],
  temple: ['firegap', 'firewall', 'firepit', 'statue', 'ledge', 'spikes'],
};

const LANE_SETS = {
  one: [[0], [1], [2]],
  two: [[0, 1], [1, 2], [0, 2]],
};

export class Spawner {
  constructor(entities, rng, fx) {
    this.entities = entities;
    this.rng = rng;
    this.fx = fx;
    this.reset();
  }

  reset() {
    this.traveled = 0;
    this.nextSpawnAt = 26;      // meters of travel before the first group
    this.last = null;
    this.hardStreak = 0;
    this.powerupAt = 120;
    this.idolAt = 780;
    this.enemyAt = 380;
    this.groupIndex = 0;
  }

  difficulty() {
    return clamp(this.traveled / DIFF.rampMeters, 0, 1);
  }

  update(dt, ctx) {
    this.traveled += ctx.distance;
    this._speed = ctx.speed;
    let guard = 0;
    while (this.traveled >= this.nextSpawnAt && guard++ < 8) {
      this._emitGroup(ctx, this.nextSpawnAt);
      const d = this.difficulty();
      const timeGap = lerp(1.28, 0.66, d) * (0.9 + this.rng() * 0.22);
      const gapMeters = Math.max(11, ctx.speed * timeGap);
      this.nextSpawnAt += gapMeters;
    }

    // scheduled specials
    if (this.traveled >= this.powerupAt) {
      this.powerupAt = this.traveled + 260 + this.rng() * 220;
      this._powerup(ctx);
    }
    if (this.traveled >= this.idolAt) {
      this.idolAt = this.traveled + 900 + this.rng() * 700;
      this._idol(ctx);
    }
    if (this.traveled >= this.enemyAt && this.difficulty() > 0.12) {
      this.enemyAt = this.traveled + lerp(420, 200, this.difficulty());
      this._howler(ctx);
    }
  }

  /**
   * Spawn line: always about 4.3 seconds of track ahead of the player, so the
   * reaction window stays constant no matter how fast the run gets. Capped to
   * the world's spawn plane and floored so nothing appears in view.
   */
  _baseZ() {
    const lead = (this._speed || 16) * 4.3;
    return Math.max(-236, Math.min(-64, -lead));
  }

  /** Place a plan item as a live entity. `dz` pushes the item further away. */
  _place(item, ctx) {
    const z = this._baseZ() + (this.traveled - this._spawnTravel) - item.dz;
    const e = this.entities.spawn(item.type, {
      lane: item.lane != null ? item.lane : 1,
      x: item.x != null ? item.x : undefined,
      y: item.y != null ? item.y : undefined,
      z,
      meta: item.meta || {},
    });
    return e;
  }

  _emitGroup(ctx, atTravel = this.traveled) {
    this._spawnTravel = atTravel;
    const d = this.difficulty();
    const zone = ctx.zone;
    const rng = this.rng;
    const pool = ZONE_OBSTACLES[zone.obstacles] || ZONE_OBSTACLES.jungle;
    const plan = [];

    // pick a pattern; hard patterns need a breather afterwards
    const wantHard = this.hardStreak === 0 && d > 0.15 && rng.chance(0.32 + d * 0.3);
    const kind = wantHard ? rng.pick(this._hardPatterns(d)) : rng.pick(this._easyPatterns(d));
    this.hardStreak = kind.hard ? 2 : Math.max(0, this.hardStreak - 1);
    kind.build({ plan, rng, d, pool, zone, traveled: this.traveled, spawner: this });

    // always leave an escape route unless the pattern is "action" (jump/slide)
    for (const item of plan) this._place(item, ctx);

    // coins: sprinkle through a lane that is not blocked by this pattern
    const blocked = new Set(plan.filter((p) => p.type !== 'coin').map((p) => p.lane));
    const freeLanes = [0, 1, 2].filter((l) => !blocked.has(l));
    const coinLane = freeLanes.length ? rng.pick(freeLanes) : 1;
    const coinCount = rng.int(4, 8);
    const arc = rng.chance(0.28);
    for (let i = 0; i < coinCount; i++) {
      const dz = i * 2.1;
      const y = arc ? 1.05 + Math.sin((i / (coinCount - 1)) * Math.PI) * 2.2 : 1.05;
      plan.push({ type: 'coin', lane: coinLane, y, dz: -18 - dz, meta: {} });
      this._place({ type: 'coin', lane: coinLane, y, dz: -18 - dz }, ctx);
    }
    this.groupIndex++;
  }

  _easyPatterns(d) {
    return [
      {
        name: 'single',
        build: ({ plan, rng, pool }) => {
          const lane = rng.int(0, 2);
          const type = rng.pick(pool);
          plan.push({ type, lane, dz: 0, meta: {} });
        },
      },
      {
        name: 'jumpRow',
        build: ({ plan, rng }) => {
          // three low obstacles -> one clean jump
          const type = rng.pick(['log', 'spikes', 'firepit', 'stonewall']);
          for (let l = 0; l < 3; l++) plan.push({ type, lane: l, dz: rng() * 0.6, meta: {} });
        },
      },
      {
        name: 'slideRow',
        build: ({ plan, rng }) => {
          const type = rng.pick(['vines', 'ledge']);
          for (let l = 0; l < 3; l++) plan.push({ type, lane: l, dz: rng() * 0.4, meta: {} });
          plan.push({ type: 'coin', lane: rng.int(0, 2), y: 0.62, dz: 5, meta: {} });
        },
      },
      {
        name: 'sideDodge',
        build: ({ plan, rng, pool }) => {
          const lane = rng.int(0, 2);
          const type = rng.pick(pool.filter((t) => t !== 'log' && t !== 'rollinglog'));
          plan.push({ type, lane, dz: 0, meta: {} });
          const coinLane = lane === 1 ? 0 : 1;
          for (let i = 0; i < 4; i++) plan.push({ type: 'coin', lane: coinLane, y: 1.05, dz: -6 - i * 2, meta: {} });
        },
      },
    ];
  }

  _hardPatterns(d) {
    return [
      {
        name: 'doubleGap',
        hard: true,
        build: ({ plan, rng, pool }) => {
          const set = rng.pick(LANE_SETS.two);
          const type = rng.pick(pool.filter((t) => t !== 'log' && t !== 'rollinglog' && t !== 'spikes'));
          set.forEach((lane) => plan.push({ type, lane, dz: rng() * 0.8, meta: {} }));
          const free = [0, 1, 2].find((l) => !set.includes(l));
          for (let i = 0; i < 3; i++) plan.push({ type: 'coin', lane: free, y: 1.05, dz: -5 - i * 2, meta: {} });
        },
      },
      {
        name: 'combo',
        hard: true,
        build: ({ plan, rng, pool }) => {
          // jump obstacle + a dodge obstacle in another lane, staggered
          const low = rng.pick(['log', 'spikes', 'firepit']);
          const high = rng.pick(pool.filter((t) => t !== 'log' && t !== 'rollinglog'));
          const lowLane = rng.int(0, 2);
          plan.push({ type: low, lane: lowLane, dz: 0, meta: {} });
          const highLane = (lowLane + 1 + rng.int(0, 1)) % 3;
          if (highLane !== lowLane) plan.push({ type: high, lane: highLane, dz: -9 - rng() * 4, meta: {} });
        },
      },
      {
        name: 'rolling',
        hard: true,
        build: ({ plan, rng }) => {
          plan.push({ type: 'rollinglog', lane: rng.int(0, 2), dz: 0, meta: {} });
          plan.push({ type: 'rollinglog', lane: rng.int(0, 2), dz: -13, meta: {} });
        },
      },
      {
        name: 'fireWalls',
        hard: true,
        build: ({ plan, rng }) => {
          const free = rng.int(0, 2);
          for (let l = 0; l < 3; l++) if (l !== free) plan.push({ type: 'firewall', lane: l, dz: rng() * 0.5, meta: {} });
          for (let i = 0; i < 4; i++) plan.push({ type: 'coin', lane: free, y: 1.05, dz: -4 - i * 2, meta: {} });
        },
      },
      {
        name: 'templeGauntlet',
        hard: true,
        build: ({ plan, rng }) => {
          const seq = rng.shuffle(['firegap', 'vines', 'firewall']);
          seq.forEach((type, i) => {
            if (type === 'vines') {
              for (let l = 0; l < 3; l++) plan.push({ type, lane: l, dz: i * 17, meta: {} });
            } else {
              const free = rng.int(0, 2);
              for (let l = 0; l < 3; l++) {
                if (l !== free) plan.push({ type, lane: l, dz: i * 17 + rng() * 0.4, meta: {} });
              }
            }
          });
        },
      },
    ];
  }

  _powerup(ctx) {
    const lane = this.rng.int(0, 2);
    const power = this.rng.pick(['magnet', 'boost', 'shield', 'x2']);
    this._spawnTravel = this.traveled;
    this._place({ type: 'powerup', lane, y: 1.25, dz: 0, meta: { power } }, ctx);
  }

  _idol(ctx) {
    const lane = this.rng.int(0, 2);
    this._spawnTravel = this.traveled;
    this._place({ type: 'idol', lane, y: 1.5, dz: 0, meta: {} }, ctx);
    for (let i = 0; i < 10; i++) {
      this._place({ type: 'coin', lane, y: 1.05, dz: -6 - i * 2, meta: {} }, ctx);
    }
  }

  _howler(ctx) {
    const lane = this.rng.int(0, 2);
    this._spawnTravel = this.traveled;
    this._place({
      type: 'howler', lane, y: 1.75, dz: 0,
      meta: { targetX: LANES[this.rng.int(0, 2)] },
    }, ctx);
    if (this.difficulty() > 0.45 && this.rng.chance(0.4)) {
      const lane2 = (lane + 1) % 3;
      this._place({ type: 'howler', lane: lane2, y: 1.75, dz: -12, meta: {} }, ctx);
    }
  }
}
