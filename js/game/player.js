/**
 * The runner. Uses the 4-frame hand-keyed run cycle as a camera-facing
 * billboard (the classic Temple Run look), plus jump, slide, stumble,
 * death and power-up visuals.
 */
import * as THREE from '../../vendor/three.module.js';
import { LANES, PLAYER, JUMP, SLIDE } from '../core/config.js';
import { clamp, damp } from '../core/rng.js';

const FRAME_FPS_BASE = 9.5;

export class Player {
  constructor(scene, assets, fx) {
    this.scene = scene;
    this.assets = assets;
    this.fx = fx;

    this.group = new THREE.Group();
    this.group.position.set(0, 0, 0);
    scene.add(this.group);

    const frames = assets.characterFrames();
    this.frames = frames.length ? frames : [null];
    this.material = new THREE.SpriteMaterial({
      map: this.frames[0], transparent: true, alphaTest: 0.22,
      depthWrite: true, toneMapped: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    this.baseH = PLAYER.height;
    this.baseW = this.baseH * 0.94;
    this.sprite.scale.set(this.baseW, this.baseH, 1);
    this.sprite.center.set(0.5, 0.06);
    this.group.add(this.sprite);

    // shadow blob
    const shadowMat = new THREE.MeshBasicMaterial({
      map: assets.tex('shadow'), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.72), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.035;
    this.scene.add(this.shadow);

    // shield bubble
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);

    // magnet ring on the ground
    this.magnetRing = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.75, 32),
      new THREE.MeshBasicMaterial({ color: 0xff8a5c, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.magnetRing.rotation.x = -Math.PI / 2;
    this.magnetRing.position.y = 0.06;
    this.magnetRing.visible = false;
    this.scene.add(this.magnetRing);

    this.state = 'run';
    this.reset();
  }

  setSkin(frames) {
    if (frames && frames.length) {
      this.frames = frames;
      this.frame = 0;
      this.material.map = frames[0];
      this.material.needsUpdate = true;
    }
  }

  reset() {
    this.lane = 1;
    this.x = LANES[1];
    this.targetX = LANES[1];
    this.y = 0;
    this.vy = 0;
    this.state = 'run';
    this.stateTime = 0;
    this.slideTime = 0;
    this.animTime = 0;
    this.frame = 0;
    this.lean = 0;
    this.dead = false;
    this.deathTime = 0;
    this.stumbleTimer = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.group.position.set(this.x, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.sprite.position.y = 0;
    this.sprite.scale.set(this.baseW, this.baseH, 1);
    this.sprite.material.rotation = 0;
    this.material.rotation = 0;
    this.shadow.position.set(this.x, 0.035, 0.1);
    this.shadow.material.opacity = 0.55;
    this.shieldMesh.visible = false;
    this.magnetRing.visible = false;
    this.shieldMesh.scale.setScalar(1);
  }

  // ---------------------------------------------------------------- inputs
  moveLane(dir) {
    if (this.dead || this.stumbleTimer > 0) return false;
    const next = clamp(this.lane + dir, 0, LANES.length - 1);
    if (next === this.lane) return false;
    this.lane = next;
    this.targetX = LANES[next];
    this.fx.strafePuff(this.x, 0);
    return true;
  }

  jump() {
    if (this.dead) return false;
    if (this.state === 'slide') { this.slideTime = 0; this.state = 'run'; }
    if (this.y > 0.01) { this.jumpBuffer = JUMP.buffer; return false; }
    this.vy = JUMP.vy;
    this.y = 0.02;
    this.state = 'jump';
    this.stateTime = 0;
    this.jumpBuffer = 0;
    return true;
  }

  slide() {
    if (this.dead) return false;
    if (this.y > 0.01) {
      // fast-fall into a slide
      this.vy = Math.min(this.vy, -14);
      this.slideQueued = true;
      return false;
    }
    this.state = 'slide';
    this.slideTime = SLIDE.time;
    this.stateTime = 0;
    return true;
  }

  hit() {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    this.deathTime = 0;
    this.vy = 6.5;
    this.fx.hitBurst({ x: this.x, y: this.y, z: 0 });
  }

  stumble(duration = 0.7) {
    this.stumbleTimer = duration;
    this.state = 'stumble';
    this.stateTime = 0;
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    const { speed, audio } = ctx;
    this.stateTime += dt;

    if (this.stumbleTimer > 0) {
      this.stumbleTimer -= dt;
      if (this.stumbleTimer <= 0 && !this.dead) this.state = 'run';
    }

    // lateral movement
    const prevX = this.x;
    const lambda = PLAYER.laneLerp * (this.state === 'slide' ? 0.8 : 1);
    this.x = damp(this.x, this.targetX, lambda, dt);
    if (Math.abs(this.x - this.targetX) < 0.02) this.x = this.targetX;
    const lateralSpeed = (this.x - prevX) / Math.max(dt, 1e-4);
    this.lean = damp(this.lean, clamp(lateralSpeed / 14, -1, 1), 9, dt);

    // vertical
    if (this.y > 0 || this.vy > 0) {
      this.vy += JUMP.g * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        const hard = this.vy < -12;
        this.y = 0;
        this.vy = 0;
        if (this.state === 'jump' || this.state === 'dead') {
          if (!this.dead) {
            this.state = 'run';
            this.fx.landPuff(this.x, 0.1);
            if (audio) audio.play('land');
            if (hard && ctx.onHardLand) ctx.onHardLand();
          }
        }
        if (this.slideQueued && !this.dead) {
          this.slideQueued = false;
          this.slide();
        }
      }
    }

    // slide timer
    if (this.state === 'slide') {
      this.slideTime -= dt;
      if (this.slideTime <= 0) this.state = this.stumbleTimer > 0 ? 'stumble' : 'run';
      this.fx.slideTrail(this.x, 0.2);
    }

    // running dust
    if (this.state === 'run' && !this.dead) {
      this.fx.runDust(this.x, 0.15, 0.6 + ctx.speed / 40);
    }

    // animation frames
    const fps = FRAME_FPS_BASE * clamp(speed / 16, 0.85, 2.6);
    if (this.state === 'run' || this.state === 'stumble') {
      this.animTime += dt * fps;
      this.frame = Math.floor(this.animTime) % this.frames.length;
    } else if (this.state === 'jump') {
      this.frame = Math.min(3, this.frames.length - 1);
    } else if (this.state === 'slide') {
      this.frame = Math.min(1, this.frames.length - 1);
    }
    const targetMap = this.frames[this.frame % this.frames.length];
    if (targetMap && this.material.map !== targetMap) {
      this.material.map = targetMap;
      this.material.needsUpdate = true;
    }

    // squash / stretch + slide pose
    let sx = this.baseW;
    let sy = this.baseH;
    let rot = 0;
    if (this.state === 'slide') {
      sy = this.baseH * 0.56;
      sx = this.baseW * 1.18;
      rot = -0.22;
    } else if (this.state === 'jump') {
      const stretch = clamp(this.vy / 26, -0.12, 0.16);
      sy = this.baseH * (1 + stretch);
      sx = this.baseW * (1 - stretch * 0.6);
      rot = 0.06;
    } else if (this.state === 'dead') {
      sy = this.baseH * 0.82; sx = this.baseW * 1.06;
      rot = this.deathTime * 3.4;
    }
    this.sprite.scale.set(sx, sy, 1);
    this.material.rotation = damp(this.material.rotation, rot, 10, dt);
    this.group.rotation.z = damp(this.group.rotation.z, -this.lean * PLAYER.leanMax, 12, dt);
    this.group.rotation.y = 0;

    this.group.position.set(this.x, this.y, 0);

    // fall off the world when dying
    if (this.dead) {
      this.deathTime += dt;
      this.group.rotation.z += dt * 3.2;
      this.group.position.y = this.y;
      this.vy += JUMP.g * 0.55 * dt;
      this.y += this.vy * dt;
      if (this.y < -3) this.y = -3;
    }

    // shadow follows, shrinks with height
    const h = Math.max(0, this.y);
    const s = clamp(1 - h / 7, 0.35, 1);
    this.shadow.position.set(this.x, 0.035, 0.12);
    this.shadow.scale.set(s, s, 1);
    this.shadow.material.opacity = 0.55 * s;

    // power visuals
    this.updatePowers(dt, ctx);

    return this;
  }

  updatePowers(dt, ctx) {
    const powers = ctx.powers || {};
    // shield
    const shieldOn = !!powers.shield;
    this.shieldMesh.visible = shieldOn;
    if (shieldOn) {
      const pulse = 1 + Math.sin(ctx.time * 5) * 0.05;
      this.shieldMesh.scale.setScalar(pulse);
      this.shieldMesh.material.opacity = 0.16 + Math.sin(ctx.time * 6) * 0.06;
    }
    // magnet
    this.magnetRing.visible = !!powers.magnet;
    if (powers.magnet) {
      this.magnetRing.position.set(this.x, 0.06, 0.1);
      this.magnetRing.scale.setScalar(1 + Math.sin(ctx.time * 4) * 0.08);
      this.magnetRing.material.opacity = 0.35 + Math.sin(ctx.time * 5) * 0.12;
    }
    // boost trail
    if (powers.boost) {
      this.fx.boostTrail(this.x, this.y + 0.5, 0.3, dt);
      this.material.color.setHex(0xffe0a0);
    } else if (powers.x2) {
      this.material.color.setHex(0xd8ffd0);
    } else {
      this.material.color.setHex(0xffffff);
    }
  }

  /** Collision box: x half-width, y range and z half-depth. */
  bounds() {
    const h = this.state === 'slide' ? PLAYER.slideHeight : PLAYER.height;
    return {
      x: this.x,
      halfW: PLAYER.halfW,
      yMin: this.y,
      yMax: this.y + h,
      halfD: 0.42,
    };
  }

  get position() { return this.group.position; }
}
