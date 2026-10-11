/**
 * Game orchestrator: renderer + post-processing, the state machine
 * (loading → menu → playing → paused → gameover), quality management,
 * save integration and all UI wiring.
 */
import * as THREE from '../../vendor/three.module.js';
import { EffectComposer } from '../../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../../vendor/addons/postprocessing/OutputPass.js';

import { CAMERA, QUALITY, CHARACTERS, ZONES, WORLD } from '../core/config.js';
import { makeRng } from '../core/rng.js';
import { Assets } from '../core/assets.js';
import { AudioEngine } from '../core/audio.js';
import * as save from '../core/save.js';
import { Environment } from '../render/environment.js';
import { FX } from '../render/fx.js';
import { CameraRig } from '../render/camera.js';
import { Run } from '../game/run.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Screens } from './screens.js';

const REVIVE_COSTS = [100, 300];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'loading';
    this.clock = { last: 0, fps: 60, samples: [], fpsAvg: 60, qualityCheck: 0, downgraded: false };
    this.recordShown = false;
    this.revives = 0;
    this.zoneReachedIndex = 0;
    this.raf = 0;
    this.time = 0;
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    save.load();
    this.assets = new Assets();
    this.audio = new AudioEngine();
    this.hud = new HUD();
    this.screens = new Screens({ assets: this.assets, on: this._uiHooks() });

    this.screens.setLoading(0.02, 'waking the temple…');
    try {
      await this.assets.load((p) => this.screens.setLoading(0.02 + p * 0.9,
        p < 0.5 ? 'loading art & textures…' : 'carving the idol…'));
    } catch (e) {
      console.warn('asset load issue', e);
    }
    this.screens.setLoading(1, 'ready');

    const ok = this._initRenderer();
    if (!ok) return;

    this._initWorld();
    this._initInput();
    this._bindRunEvents();

    this.screens.show('menu');
    this.screens.syncSave();
    this.applyQuality(save.get().quality || 'auto', true);
    this.applyCharacter(this._selectedCharacter());
    this.state = 'menu';
    this._startLoop();
  }

  _initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (e) {
      this.screens.setLoading(1, 'WebGL is not available in this browser.');
      return false;
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.03;
    this.renderer.setClearColor(0x0a0f07, 1);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(ZONES[0].fog, ZONES[0].fogNear, ZONES[0].fogFar);
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 700);
    this.camera.position.set(0, WORLD.camY, WORLD.camZ);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.52, 0.62, 0.86);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.outputPass);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.pause();
      this.hud.toast('Graphics context lost — reload the page');
    });
    this.resize();
    return true;
  }

  _initWorld() {
    this.fx = new FX(this.scene, this.assets, 1);
    this.env = new Environment(this.scene, this.assets, this.fx, 'high');
    this.rig = new CameraRig(this.camera);
    this.rng = makeRng((Math.random() * 1e9) | 0);
    this.run = new Run({
      scene: this.scene,
      assets: this.assets,
      fx: this.fx,
      audio: this.audio,
      env: this.env,
      camera: this.rig,
      quality: 'high',
      rng: this.rng,
    });
    this.env.reset();
    this.rig.reset();
  }

  _initInput() {
    this.input = new Input({
      canvas: this.canvas,
      onAction: (a) => this.onAction(a),
      onPause: () => this.togglePause(),
      onFirstTouch: () => this._unlockAudio(),
    });
    const d = save.get();
    this.input.setTilt(d.tilt);
    document.getElementById('pause-btn').addEventListener('click', () => this.togglePause());
  }

  _unlockAudio() {
    if (!this.audio.ready) {
      this.audio.init();
      this.audio.setSound(save.get().sound);
      this.audio.setMusic(save.get().music);
      this.audio.startMusic();
      this.audio.setIntensity(0.25);
    }
    this.audio.resume();
  }

  _uiHooks() {
    return {
      play: () => this.startRun(),
      restart: () => this.startRun(),
      resume: () => this.resume(),
      quit: () => this.toMenu(),
      revive: () => this.revive(),
      screen: () => {},
      selectCharacter: (cfg) => this.applyCharacter(cfg),
      toggleAudio: (on) => { this.audio.setSound(on); this.audio.setMusic(on); },
      toggleMusic: (on) => this.audio.setMusic(on),
      toggleSound: (on) => this.audio.setSound(on),
      toggleTilt: (on) => this.input.setTilt(on),
      setQuality: (q) => this.applyQuality(q),
      reset: () => { this.applyCharacter(this._selectedCharacter()); },
      buy: () => { this.audio.play('idol'); },
    };
  }

  _selectedCharacter() {
    const d = save.get();
    return CHARACTERS.find((c) => c.id === d.selected) || CHARACTERS[0];
  }

  applyCharacter(cfg) {
    const frames = this.assets.characterFrames(cfg);
    if (this.run) this.run.player.setSkin(frames);
    if (this.screens && this.screens.preview) this.screens.preview.setCharacter(cfg);
  }

  // -------------------------------------------------------------- quality
  detectQuality() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (cores <= 2 || mem <= 2) return 'low';
    if (mobile) return cores >= 8 && mem >= 6 ? 'high' : 'medium';
    return 'high';
  }

  applyQuality(q, initial = false) {
    const id = q === 'auto' ? this.detectQuality() : q;
    this.qualityId = id;
    const cfg = QUALITY[id] || QUALITY.high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.dpr));
    if (this.bloom) this.bloom.enabled = cfg.bloom;
    this.renderer.shadowMap.enabled = cfg.shadows;
    this.fx && this.fx.setQuality(cfg.particles);
    this.camera.far = cfg.shadows ? 700 : 620;
    if (!initial) this.hud.toast(`Graphics: ${id}`);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer && this.composer.setSize(w, h);
  }

  // ------------------------------------------------------------- run flow
  startRun() {
    this._unlockAudio();
    this.run.start({ cinematic: !save.get().seenIntro || this.runCount % 3 === 0 });
    this.runCount = (this.runCount || 0) + 1;
    save.set('seenIntro', true);
    this.recordShown = false;
    this.revives = 0;
    this.zoneReachedIndex = 0;
    this.state = 'playing';
    this.rig.reset();
    this.input.recentreTilt();
    this.hud.show();
    this.hud.setRecord(false);
    this.hud.setBoost(false);
    this.hud.zoneBanner(this.run.zone.name, 'zone 1 of ' + ZONES.length);
    this.hud.tutorial(save.get().runs < 2);
    setTimeout(() => this.hud.tutorial(false), 5200);
    this.screens.hideAll();
    this.audio.startMusic();
    this.audio.setZone(this.run.zone.id);
    this.audio.setIntensity(0.2);
    this.applyCharacter(this._selectedCharacter());
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.hide();
    this.screens.pauseStats(this.run.snapshot());
    this.screens.show('pause');
    this.audio.setMusic(false);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.clock.last = performance.now();
    this.hud.show();
    this.screens.hideAll();
    this.audio.setMusic(save.get().music);
    this.audio.resume();
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  toMenu() {
    this.state = 'menu';
    this.run.dispose();
    this.run.state = 'idle';
    this.env.reset();
    this.rig.reset();
    this.hud.hide();
    this.hud.setBoost(false);
    this.screens.show('menu');
    this.screens.syncSave();
    this.audio.startMusic();
    this.audio.setMusic(save.get().music);
    this.audio.setIntensity(0.25);
    this.applyCharacter(this._selectedCharacter());
  }

  gameOver() {
    const snap = this.run.snapshot();
    const d = save.get();
    const isRecord = snap.score > d.best;
    save.patch({
      coins: d.coins + this.run.coins,
      earned: d.earned + this.run.coins,
      totalCoins: d.totalCoins + this.run.coins,
      totalDistance: d.totalDistance + snap.distance,
      best: Math.max(d.best, snap.score),
      bestDistance: Math.max(d.bestDistance, snap.distance),
      runs: d.runs + 1,
    });
    this.state = 'gameover';
    this.hud.setBoost(false);
    const cost = REVIVE_COSTS[this.revives];
    const canRevive = cost != null && save.get().coins >= cost;
    this.screens.showGameOver({
      score: snap.score,
      distance: snap.distance,
      coins: this.run.coins,
      best: Math.max(d.best, snap.score),
      isRecord,
      reviveCost: cost || 0,
      canRevive,
      reason: snap.reason,
    });
    this.screens.syncSave();
    this.audio.stopMusic(1.4);
    this.audio.play('gameover');
  }

  revive() {
    const cost = REVIVE_COSTS[this.revives];
    if (cost == null) return;
    if (!save.spendCoins(cost)) { this.hud.toast('Not enough coins'); return; }
    this.revives++;
    this.state = 'playing';
    this.run.revive();
    this.screens.hideAll();
    this.hud.show();
    this.hud.setRecord(false);
    this.clock.last = performance.now();
  }

  onAction(action) {
    this._unlockAudio();
    if (this.state === 'menu') {
      if (action === 'jump' || action === 'right' || action === 'left' || action === 'slide') this.startRun();
      return;
    }
    if (this.state === 'playing') this.run.input(action);
  }

  // ----------------------------------------------------------- run events
  _bindRunEvents() {
    const bus = this.run.bus;
    bus.on('tick', (snap) => {
      if (this.state !== 'playing') return;
      this.hud.update(snap);
      this.hud.setBoost(snap.power.boost > 0);
      if (!this.recordShown && save.get().best > 0 && snap.score > save.get().best) {
        this.recordShown = true;
        this.hud.setRecord(true);
        this.hud.toast('New record!');
        this.audio.play('idol');
        setTimeout(() => this.hud.setRecord(false), 3200);
      }
    });
    bus.on('coin', () => {});
    bus.on('powerup', (e) => {
      this.hud.toast(`${e.label} ready!`);
      this.audio.play('magic');
    });
    bus.on('powerEnd', (e) => this.hud.toast(`${e.power} over`));
    bus.on('shieldBreak', () => { this.hud.toast('Shield shattered!'); this.hud.flashHit(); });
    bus.on('stumble', () => {
      this.hud.toast('Stumble! They are closing in…');
      this.hud.flashHit();
    });
    bus.on('nearMiss', () => this.hud.toast('Near miss +5'));
    bus.on('idol', (e) => { this.hud.toast(`Golden idol! +${e.bonus}`); });
    bus.on('zone', (zone) => {
      this.zoneReachedIndex = ZONES.findIndex((z) => z.id === zone.id);
      this.hud.zoneBanner(zone.name, `zone ${this.zoneReachedIndex + 1} of ${ZONES.length}`);
      this.hud.toast(`${zone.name} ahead`);
      this.audio.play('zone');
      const d = save.get();
      const reached = ZONES.slice(0, this.zoneReachedIndex + 1).map((z) => z.id);
      if (!reached.includes(d.zoneReached)) save.set('zoneReached', zone.id);
    });
    bus.on('dying', () => {
      this.hud.flashHit();
      this.audio.stopMusic(1.6);
    });
    bus.on('death', () => this.gameOver());
    bus.on('revive', () => this.hud.toast('Saved! Run!'));
  }

  // ---------------------------------------------------------------- loop
  _startLoop() {
    this.clock.last = performance.now();
    const loop = (t) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.0005, (t - this.clock.last) / 1000));
      this.clock.last = t;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  tick(dt) {
    this.time += dt;
    this._sampleFps(dt);

    switch (this.state) {
      case 'menu': {
        this.run.updateDemo(dt);
        this.rig.menuUpdate(dt, this.run.player);
        this.screens.preview && this.screens.preview.tick(dt);
        if (this.screens.current === 'shop') this.screens.tickShop(dt);
        break;
      }
      case 'playing': {
        this.run.update(dt);
        break;
      }
      case 'paused':
      case 'gameover': {
        // gentle camera drift on the game-over screen
        if (this.state === 'gameover') this.rig.update(dt, {
          player: this.run.player, speed: this.run.speed, speedRatio: 0, dead: true, shake: 0,
        });
        break;
      }
      default: break;
    }

    this.fx.update(dt);
    if (this.bloom && this.bloom.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  _sampleFps(dt) {
    const fps = 1 / Math.max(dt, 1e-4);
    this.clock.samples.push(fps);
    if (this.clock.samples.length > 90) this.clock.samples.shift();
    this.clock.fpsAvg = this.clock.samples.reduce((a, b) => a + b, 0) / this.clock.samples.length;
    this.clock.qualityCheck += dt;
    const quality = save.get().quality || 'auto';
    if (this.clock.qualityCheck > 5 && !this.clock.downgraded && quality === 'auto') {
      this.clock.qualityCheck = 0;
      if (this.clock.fpsAvg < 42 && this.qualityId !== 'low') {
        const next = this.qualityId === 'high' ? 'medium' : 'low';
        this.applyQuality(next);
        this.clock.downgraded = true;
        this.hud.toast(`Auto graphics: ${next}`);
      }
    }
  }
}
