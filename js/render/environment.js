/**
 * The scrolling world: skybox, lights, the temple road, and all pooled
 * scenery (jungle trees, foliage, ruins, torches, fireflies, far temples).
 *
 * Movement model: the player stays near z=0 while the world streams toward
 * +Z. Pooled props wrap from the despawn line back to the horizon, which
 * gives an infinite track with a fixed, tiny memory footprint.
 */
import * as THREE from '../../vendor/three.module.js';
import { WORLD, ZONES, QUALITY } from '../core/config.js';
import { cloneTex, makeEdgeStripTexture } from './textures.js';
import { damp, lerp } from '../core/rng.js';

const ROAD = { width: 9.4, length: 300, zCenter: -120, repeatU: 2.6, repeatV: 30 };
const SPAN = WORLD.despawnZ - WORLD.spawnZ; // wrap distance

export class Environment {
  constructor(scene, assets, fx, qualityId = 'high') {
    this.scene = scene;
    this.assets = assets;
    this.fx = fx;
    this.quality = QUALITY[qualityId] || QUALITY.high;
    this.zone = ZONES[0];
    this.zoneTarget = ZONES[0];
    this.blend = 1; // 0..1 swap progress
    this.time = 0;
    this.fireflies = [];
    this.props = { trees: [], foliage: [], rocks: [], ruins: [], huts: [], torches: [], canopy: [], stones: [] };
    this._tmp = new THREE.Vector3();
    this._buildSky();
    this._buildLights();
    this._buildRoad();
    this._buildScenery();
    this._buildFarTemples();
    this.applyZone(ZONES[0], true);
  }

  // ------------------------------------------------------------------ sky
  _buildSky() {
    const tex = this.assets.tex('sky_pano');
    const geo = new THREE.SphereGeometry(WORLD.skyRadius, 40, 22);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, toneMapped: false });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.position.z = -60;
    this.scene.add(this.sky);
  }

  // --------------------------------------------------------------- lights
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xdff0b8, 0x2c3a1c, 0.9);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffdcae, 1.4);
    this.sun.position.set(16, 26, 10);
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    if (this.quality.shadows) {
      this.sun.castShadow = true;
      const s = 26;
      this.sun.shadow.camera.left = -s;
      this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s;
      this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.near = 4;
      this.sun.shadow.camera.far = 90;
      this.sun.shadow.mapSize.set(1024, 1024);
      this.sun.shadow.bias = -0.0015;
      this.sun.shadow.normalBias = 0.05;
    }

    this.fill = new THREE.DirectionalLight(0x86b0ff, 0.22);
    this.fill.position.set(-14, 10, -8);
    this.scene.add(this.fill);
  }

  // ----------------------------------------------------------------- road
  _buildRoad() {
    const stone = this.assets.tex('stone_path');
    const wall = this.assets.tex('stone_wall');
    const jungle = this.assets.tex('ground_jungle');

    // jungle floor under everything
    const floorGeo = new THREE.PlaneGeometry(420, ROAD.length + 120);
    this.floorMat = new THREE.MeshStandardMaterial({
      map: cloneTex(jungle, 42, 40), roughness: 1, metalness: 0,
    });
    this.floor = new THREE.Mesh(floorGeo, this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, -0.62, ROAD.zCenter);
    this.floor.receiveShadow = !!this.quality.shadows;
    this.scene.add(this.floor);

    // the temple causeway
    this.roadMat = new THREE.MeshStandardMaterial({
      map: cloneTex(stone, ROAD.repeatU, ROAD.repeatV), roughness: 0.94, metalness: 0.02,
    });
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.width, ROAD.length), this.roadMat);
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.set(0, 0, ROAD.zCenter);
    this.road.receiveShadow = !!this.quality.shadows;
    this.scene.add(this.road);

    // raised kerbs: a vertical face (u runs along the track) + a flat cap
    this.kerbMat = new THREE.MeshStandardMaterial({
      map: cloneTex(wall, 46, 1), roughness: 0.95, color: 0xbfb49a,
    });
    this.kerbTopMat = new THREE.MeshStandardMaterial({
      map: cloneTex(wall, 2, 46), roughness: 0.95, color: 0xc7bda2,
    });
    const faceGeo = new THREE.PlaneGeometry(ROAD.length, 0.62);
    const capGeo = new THREE.PlaneGeometry(0.95, ROAD.length);
    this.kerbs = [];
    for (const sx of [-1, 1]) {
      const face = new THREE.Mesh(faceGeo, this.kerbMat);
      face.rotation.y = sx * -Math.PI / 2;
      face.position.set(sx * (ROAD.width / 2 + 0.28), 0.06, ROAD.zCenter);
      face.receiveShadow = !!this.quality.shadows;
      const cap = new THREE.Mesh(capGeo, this.kerbTopMat);
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(sx * (ROAD.width / 2 + 0.75), 0.36, ROAD.zCenter);
      cap.receiveShadow = !!this.quality.shadows;
      const skirt = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.length, 0.9), this.kerbMat);
      skirt.rotation.y = sx * Math.PI / 2;
      skirt.position.set(sx * (ROAD.width / 2 + 1.2), -0.2, ROAD.zCenter);
      this.scene.add(face, cap, skirt);
      this.kerbs.push(face, cap, skirt);
    }

    // glowing energy lines along both edges
    const stripTex = makeEdgeStripTexture('#ffd27a');
    const stripMat = new THREE.MeshBasicMaterial({
      map: cloneTex(stripTex, 60, 1), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.75, toneMapped: false,
    });
    this.stripMat = stripMat;
    const stripGeo = new THREE.PlaneGeometry(0.65, ROAD.length);
    for (const sx of [-1, 1]) {
      const s = new THREE.Mesh(stripGeo, stripMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(sx * (ROAD.width / 2 - 0.15), 0.035, ROAD.zCenter);
      this.scene.add(s);
    }
    this.edgeColor = new THREE.Color(0xffd27a);
  }

  // -------------------------------------------------------------- scenery
  _buildScenery() {
    const q = this.quality;
    const mkTree = () => this._billboardCard('tree', 9.5, 11.2, 0.30);
    const mkFoliage = () => this._billboardCard('foliage', 7.2, 4.0, 0.34);
    const mkCanopy = () => this._billboardCard('tree', 16, 18, 0.3);

    const treeCount = Math.round(46 * q.treeDensity);
    for (let i = 0; i < treeCount; i++) this.props.trees.push(this._prop(mkTree(), 'tree'));
    for (let i = 0; i < Math.round(54 * q.treeDensity); i++) this.props.foliage.push(this._prop(mkFoliage(), 'foliage'));
    for (let i = 0; i < 14; i++) this.props.canopy.push(this._prop(mkCanopy(), 'canopy'));
    for (let i = 0; i < 22; i++) this.props.stones.push(this._prop(this._stone(), 'stone'));
    for (let i = 0; i < 16; i++) this.props.ruins.push(this._prop(this._ruin(), 'ruin'));
    for (let i = 0; i < 5; i++) this.props.huts.push(this._prop(this._hut(), 'hut'));
    for (let i = 0; i < 12; i++) this.props.torches.push(this._prop(this._torch(), 'torch'));

    // floating fireflies
    const glow = this.assets.tex('glow');
    for (let i = 0; i < 34; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glow, color: 0xd8ff8a, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const s = new THREE.Sprite(mat);
      const sc = 0.16 + Math.random() * 0.2;
      s.scale.set(sc, sc, 1);
      s.position.set((Math.random() - 0.5) * 26, 0.7 + Math.random() * 3.6, WORLD.spawnZ + Math.random() * SPAN);
      s.userData.phase = Math.random() * Math.PI * 2;
      this.fireflies.push(s);
      this.scene.add(s);
    }
  }

  _billboardCard(texKey, w, h, alphaTest = 0.3) {
    const tex = this.assets.tex(texKey);
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: false, alphaTest, side: THREE.DoubleSide,
      roughness: 1, metalness: 0, depthWrite: true,
    });
    const g = new THREE.Group();
    const a = new THREE.Mesh(geo, mat);
    a.castShadow = !!this.quality.shadows;
    const b = new THREE.Mesh(geo, mat);
    b.rotation.y = Math.PI / 2;
    b.castShadow = !!this.quality.shadows;
    g.add(a, b);
    g.userData.height = h;
    return g;
  }

  _stone() {
    const geo = new THREE.DodecahedronGeometry(0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ map: this.assets.tex('stone_wall'), roughness: 1, color: 0x9a9384 });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = !!this.quality.shadows;
    m.receiveShadow = !!this.quality.shadows;
    return m;
  }

  _ruin() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ map: cloneTex(this.assets.tex('stone_wall'), 1, 2), roughness: 0.96 });
    const kind = Math.random();
    if (kind < 0.45) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 4.2, 10), mat);
      col.position.y = 2.1 - 0.5;
      col.castShadow = !!this.quality.shadows;
      g.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.7), mat);
      cap.position.y = 1.85;
      cap.castShadow = !!this.quality.shadows;
      g.add(cap);
    } else if (kind < 0.75) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.6 + Math.random() * 2, 0.8), mat);
      wall.position.y = 1.1;
      wall.castShadow = !!this.quality.shadows;
      wall.receiveShadow = !!this.quality.shadows;
      g.add(wall);
    } else {
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.9 + Math.random(), 0.7, 0.9), mat);
        b.position.set((Math.random() - 0.5) * 1.6, 0.2 + i * 0.75, (Math.random() - 0.5) * 0.6);
        b.rotation.y = Math.random() * 0.6;
        b.castShadow = !!this.quality.shadows;
        g.add(b);
      }
    }
    return g;
  }

  _hut() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ map: cloneTex(this.assets.tex('wood'), 2, 2), roughness: 1 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 2.6, 10), wood);
    body.position.y = 1.3 - 0.5;
    body.castShadow = !!this.quality.shadows;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.7, 12),
      new THREE.MeshStandardMaterial({ color: 0x6d5a2a, roughness: 1 }));
    roof.position.y = 2.35;
    roof.castShadow = !!this.quality.shadows;
    g.add(roof);
    return g;
  }

  _torch() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ map: cloneTex(this.assets.tex('wood'), 1, 3), roughness: 1 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.6, 6), wood);
    pole.position.y = 0.8;
    pole.castShadow = !!this.quality.shadows;
    g.add(pole);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.18, 0.34, 8),
      new THREE.MeshStandardMaterial({ color: 0x50432c, roughness: 1 }));
    bowl.position.y = 2.1;
    g.add(bowl);
    const flameTex = cloneTex(this.assets.tex('flame'), 0.5, 0.5);
    flameTex.repeat.set(0.5, 0.5);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flameTex, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, opacity: 0.95,
    }));
    flame.scale.set(1.1, 1.6, 1);
    flame.position.y = 2.75;
    g.add(flame);
    g.userData.flame = flame;
    g.userData.flameTex = flameTex;
    const light = new THREE.PointLight(0xffa040, 0, 9, 2);
    light.position.y = 2.6;
    g.add(light);
    g.userData.light = light;
    return g;
  }

  _prop(obj, kind) {
    obj.userData.kind = kind;
    this.scene.add(obj);
    return { obj, kind, z: WORLD.spawnZ };
  }

  /**
   * Distant temple pyramids silhouetted in the haze — parallax landmarks that
   * make the run feel like it is heading somewhere.
   */
  _buildFarTemples() {
    const mat = new THREE.MeshStandardMaterial({
      map: cloneTex(this.assets.tex('stone_wall'), 3, 3),
      color: 0x5c6350, roughness: 1, metalness: 0, fog: true, transparent: true, opacity: 0.0,
    });
    this.farTemples = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const tiers = 3 + (i % 2);
      for (let t = 0; t < tiers; t++) {
        const w = 78 - t * 17;
        const h = 13;
        const tier = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.82), mat.clone());
        tier.position.y = h / 2 + t * h;
        g.add(tier);
      }
      const stair = new THREE.Mesh(new THREE.BoxGeometry(9, tiers * 13 + 4, 26), mat.clone());
      stair.position.set(0, (tiers * 13) / 2, 30);
      g.add(stair);
      g.position.set((i - 1) * 92 + (i === 1 ? 40 : 0), -6, WORLD.spawnZ - 260 - i * 1600);
      g.rotation.y = (i - 1) * 0.35;
      g.scale.setScalar(0.9 + i * 0.12);
      this.farTemples.push(g);
      this.scene.add(g);
    }
  }

  // ----------------------------------------------------------------- zone
  applyZone(cfg, instant = false) {
    this.zone = cfg;
    const fog = this.scene.fog || (this.scene.fog = new THREE.Fog(cfg.fog, cfg.fogNear, cfg.fogFar));
    this.target = {
      fog: new THREE.Color(cfg.fog),
      fogNear: cfg.fogNear,
      fogFar: cfg.fogFar,
      hemiSky: new THREE.Color(cfg.hemiSky),
      hemiGround: new THREE.Color(cfg.hemiGround),
      hemiIntensity: cfg.hemiIntensity,
      sun: new THREE.Color(cfg.sun),
      sunIntensity: cfg.sunIntensity,
    };
    if (instant) {
      fog.color.copy(this.target.fog);
      fog.near = this.target.fogNear;
      fog.far = this.target.fogFar;
      this.hemi.color.copy(this.target.hemiSky);
      this.hemi.groundColor.copy(this.target.hemiGround);
      this.hemi.intensity = this.target.hemiIntensity;
      this.sun.color.copy(this.target.sun);
      this.sun.intensity = this.target.sunIntensity;
      this.blend = 1;
    } else {
      this.blend = 0;
    }
  }

  _updateZoneBlend(dt) {
    if (this.blend >= 1) return;
    this.blend = Math.min(1, this.blend + dt / 3.2);
    const t = this.blend;
    const fog = this.scene.fog;
    fog.color.lerpColors(fog.color, this.target.fog, t * 0.12);
    fog.near = lerp(fog.near, this.target.fogNear, t * 0.12);
    fog.far = lerp(fog.far, this.target.fogFar, t * 0.12);
    this.hemi.color.lerp(this.target.hemiSky, t * 0.12);
    this.hemi.groundColor.lerp(this.target.hemiGround, t * 0.12);
    this.hemi.intensity = lerp(this.hemi.intensity, this.target.hemiIntensity, t * 0.12);
    this.sun.color.lerp(this.target.sun, t * 0.12);
    this.sun.intensity = lerp(this.sun.intensity, this.target.sunIntensity, t * 0.12);
  }

  // --------------------------------------------------------------- update
  /**
   * @param {number} dt seconds
   * @param {number} distance meters travelled this step
   * @param {number} speed current speed (units/s)
   * @param {object} player {x, z} for light following + shadow focus
   * @param {number} intensity 0..1 speed intensity for FX
   */
  update(dt, distance, speed, player = { x: 0, z: 0 }, intensity = 0) {
    this.time += dt;
    this._updateZoneBlend(dt);

    // scroll the ground textures
    const roadTravel = distance * ROAD.repeatV / ROAD.length;
    this.roadMat.map.offset.y += roadTravel;
    this.floorMat.map.offset.y += distance * 40 / (ROAD.length + 120);
    this.kerbMat.map.offset.x -= distance * 46 / ROAD.length;
    this.kerbTopMat.map.offset.y += distance * 46 / ROAD.length;
    this.stripMat.map.offset.x -= distance * 60 / ROAD.length;

    // sun follows the runner so shadows stay in range
    this.sun.position.set(player.x + 16, 26, player.z + 10);
    this.sunTarget.position.set(player.x, 0, player.z - 6);
    this.sunTarget.updateMatrixWorld();

    // sky drifts slowly for parallax
    this.sky.rotation.y += dt * 0.004;
    this.sky.position.z = player.z - 60;

    for (const key in this.props) {
      for (const p of this.props[key]) {
        const o = p.obj;
        o.position.z += distance;
        if (o.position.z > WORLD.despawnZ) {
          const nd = p.z - SPAN + Math.random() * 10 - 5;
          o.position.z = nd;
          this._placeProp(p, true);
        }
        if (key === 'canopy') o.position.z += dt * 0; // canopies ride along
        if (key === 'torch') {
          const flame = o.userData.flame;
          if (flame) {
            const t = this.time * 9 + o.position.z;
            flame.scale.set(1.05 + Math.sin(t) * 0.14, 1.55 + Math.sin(t * 1.4) * 0.22, 1);
            flame.material.opacity = 0.8 + Math.sin(t * 2.3) * 0.16;
            o.userData.light.intensity = 1.1 + Math.sin(t * 3) * 0.35;
          }
        }
      }
    }

    // distance-based visibility of the far temple pyramids
    for (const t of this.farTemples) {
      t.position.z += distance * 0.9995;
      if (t.position.z > WORLD.despawnZ + 120) t.position.z -= 4800;
      const dz = Math.max(0, -t.position.z);
      const vis = Math.min(1, Math.max(0, (1500 - dz) / 700));
      const target = vis * 0.5;
      for (const child of t.children) {
        const m = child.material;
        m.opacity = damp(m.opacity, target, 1.2, dt);
        child.visible = m.opacity > 0.01;
      }
    }

    // fireflies hover and wrap
    const ffOpacity = this.zone.id === 'temple' ? 0.35 : 0.9;
    for (const f of this.fireflies) {
      const u = f.userData;
      f.position.z += distance * 0.35;
      f.position.y += Math.sin(this.time * 1.6 + u.phase) * dt * 0.5;
      if (f.position.z > WORLD.despawnZ) {
        f.position.z -= SPAN;
        f.position.x = (Math.random() - 0.5) * 26;
      }
      f.material.opacity = (0.55 + Math.sin(this.time * 3 + u.phase) * 0.4) * ffOpacity;
    }
  }

  /** (Re)position a pooled prop for the current zone. */
  _placeProp(p, onWrap = false) {
    const o = p.obj;
    const r = Math.random;
    const zone = this.zone.id;
    switch (p.kind) {
      case 'tree': {
        const side = r() < 0.5 ? -1 : 1;
        o.position.x = side * (7.2 + r() * 22);
        o.position.y = o.userData.height * 0.5 - 0.7;
        o.rotation.y = r() * Math.PI;
        const s = 0.75 + r() * 0.6;
        o.scale.set(s, s, s);
        break;
      }
      case 'foliage': {
        const side = r() < 0.5 ? -1 : 1;
        o.position.x = side * (5.4 + r() * 6);
        o.position.y = r() * 0.5 - 0.4;
        o.rotation.y = r() * Math.PI;
        const s = 0.6 + r() * 0.8;
        o.scale.set(s, s, s);
        break;
      }
      case 'canopy': {
        const side = r() < 0.5 ? -1 : 1;
        o.position.x = side * (4 + r() * 13);
        o.position.y = 9 + r() * 6;
        o.rotation.y = r() * Math.PI;
        const s = 0.7 + r() * 0.7;
        o.scale.set(s, s, s);
        break;
      }
      case 'stone': {
        const side = r() < 0.5 ? -1 : 1;
        o.position.x = side * (5.0 + r() * 3.2);
        o.position.y = -0.3 + r() * 0.2;
        o.rotation.set(r() * 3, r() * 3, r() * 3);
        const s = 0.5 + r() * 1.1;
        o.scale.setScalar(s);
        break;
      }
      case 'ruin': {
        const side = r() < 0.5 ? -1 : 1;
        const dens = zone === 'jungle' ? 0.25 : zone === 'ruins' ? 0.9 : 0.6;
        o.visible = r() < dens || !onWrap;
        o.position.x = side * (6.2 + r() * 9);
        o.position.y = -0.5;
        o.rotation.y = r() * Math.PI;
        const s = 0.8 + r() * 0.7;
        o.scale.set(s, 0.8 + r() * 0.8, s);
        break;
      }
      case 'hut': {
        const side = r() < 0.5 ? -1 : 1;
        o.visible = zone !== 'temple';
        o.position.x = side * (10 + r() * 8);
        o.position.y = -0.55;
        o.rotation.y = r() * Math.PI * 2;
        o.scale.setScalar(0.8 + r() * 0.5);
        break;
      }
      case 'torch': {
        const side = r() < 0.5 ? -1 : 1;
        o.visible = true;
        o.position.x = side * (ROAD.width / 2 + 0.62);
        o.position.y = 0.05;
        o.rotation.y = 0;
        o.scale.setScalar(0.9 + r() * 0.25);
        break;
      }
      default: break;
    }
    if (p.kind === 'tree' || p.kind === 'foliage' || p.kind === 'canopy') {
      o.children.forEach((c) => { if (c.isMesh) c.material.alphaTest = 0.3; });
    }
  }

  reset() {
    this.blend = 1;
    this.applyZone(ZONES[0], true);
    let z = WORLD.spawnZ;
    for (const key in this.props) {
      for (const p of this.props[key]) {
        p.obj.position.z = z;
        this._placeProp(p);
        z -= (12 + Math.random() * 26) / 4;
        if (z < WORLD.spawnZ - SPAN) z = WORLD.spawnZ;
      }
    }
    this.farTemples.forEach((t, i) => { t.position.z = WORLD.spawnZ - 260 - i * 1600; });
  }
}
