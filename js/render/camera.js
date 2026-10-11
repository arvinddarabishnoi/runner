/** Third-person chase camera with speed FOV, shake, death zoom and intros. */
import * as THREE from '../../vendor/three.module.js';
import { WORLD, CAMERA } from '../core/config.js';
import { clamp, damp, lerp, smoothstep } from '../core/rng.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.shake = 0;
    this.fovBase = CAMERA.fov;
    this._look = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this.menuAngle = 0;
  }

  reset() {
    this.shake = 0;
    this.camera.fov = this.fovBase;
    this.camera.position.set(0, WORLD.camY, WORLD.camZ);
    this.camera.lookAt(0, WORLD.lookY, WORLD.lookZ);
    this.camera.updateProjectionMatrix();
  }

  /** Slow menu fly-around over the track. */
  menuUpdate(dt, player) {
    this.menuAngle += dt * 0.08;
    const r = 16;
    const x = Math.sin(this.menuAngle) * r;
    const z = Math.cos(this.menuAngle) * r - 6;
    this.camera.position.set(x, 7.5 + Math.sin(this.menuAngle * 0.7) * 1.6, z + WORLD.camZ);
    this.camera.lookAt(player.x * 0.4, 2.0, -14);
    this.camera.fov = lerp(this.camera.fov, 58, 0.05);
    this.camera.updateProjectionMatrix();
  }

  /** Cinematic fly-in used when a run starts. t: 0..1 */
  introUpdate(t, player) {
    const e = smoothstep(clamp(t, 0, 1));
    // start high and far above the runner, swoop into the chase position
    const startPos = new THREE.Vector3(0, 42, -78);
    const endPos = new THREE.Vector3(player.x * CAMERA.laneFollow, WORLD.camY, WORLD.camZ);
    this._pos.copy(startPos).lerp(endPos, e);
    this.camera.position.copy(this._pos);
    const lookStart = new THREE.Vector3(0, 6, -120);
    const lookEnd = new THREE.Vector3(player.x * 0.5, WORLD.lookY, WORLD.lookZ);
    this._look.copy(lookStart).lerp(lookEnd, e);
    this.camera.lookAt(this._look);
    this.camera.fov = lerp(52, this.fovBase, e);
    this.camera.updateProjectionMatrix();
  }

  update(dt, { player, speed, speedRatio = 0, boosting = false, dead = false, shake = 0, targeting = null }) {
    const follow = CAMERA.laneFollow;
    const targetX = player.x * follow + (targeting ? targeting.x * 0.08 : 0);
    const targetY = WORLD.camY + player.y * 0.28 + (dead ? 0.4 : 0);
    const targetZ = WORLD.camZ + (boosting ? -0.9 : 0) + (dead ? 2.2 : 0);

    const lam = dead ? 3.2 : 8.5;
    this.camera.position.x = damp(this.camera.position.x, targetX, lam, dt);
    this.camera.position.y = damp(this.camera.position.y, targetY, lam * 0.8, dt);
    this.camera.position.z = damp(this.camera.position.z, targetZ, lam * 0.6, dt);

    this._look.set(
      player.x * 0.55,
      WORLD.lookY + player.y * 0.42 + (dead ? -0.5 : 0),
      WORLD.lookZ + (dead ? 1.5 : 0),
    );
    this.camera.lookAt(this._look);

    // shake (fx shake + high speed rumble)
    const rumble = speedRatio > 0.65 ? (speedRatio - 0.65) * 0.35 : 0;
    const s = clamp(shake + rumble, 0, 1.4) * (boosting ? 1.5 : 1);
    this.shake = damp(this.shake, s, 6, dt);
    if (this.shake > 0.001) {
      const t = performance.now() * 0.001;
      const amp = this.shake * 0.22;
      this.camera.position.x += Math.sin(t * 41.3) * amp;
      this.camera.position.y += Math.sin(t * 37.7) * amp * 0.8;
      this.camera.rotateZ(Math.sin(t * 29.1) * this.shake * 0.012);
    }

    const targetFov = this.fovBase + speedRatio * 5 + (boosting ? 9 : 0) + (dead ? -6 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }
}
