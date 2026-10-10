/**
 * Level 1 - The Glass Causeway.
 *
 * "A bright, abstract corridor of glass bridges, rotating panels, reflective
 *  walls, and open sky. Level 1 is about aiming and deciding what to break
 *  with limited ammunition." - project guide
 *
 * Story: Subject 07 wakes in the containment ward of a failed resonance
 * experiment. Dr. Vale has armed the tower's demolition charges. The only way
 * out is up: across the skybridge, through the resonance atrium, into the
 * Calibration Lift to Sector 2.
 *
 * The level has the same contract as Level 2 (FoundryLevel), so the host game
 * treats both the same way:
 *
 *   root / addTo(scene) / dispose()     lifecycle
 *   update({dt,time,distance,player})   advance the world
 *   breakables                          meshes a projectile can hit
 *   collide(playerBox, distance)        solid hits, pane hits, near misses
 *   breakTarget(mesh, hit)              what breaking something did
 *   events.on(name, fn)                 announcements for HUD, score, camera
 *
 * Scene hierarchy:
 *
 *   CausewayRoot                  positioned at `origin`; local z = -distance
 *   |-- Sky, Skyline, Tower       far-plane sky, instanced city, scripted collapse
 *   |-- Shell                     instanced corridor treadmill (shell.js)
 *   |-- Props                     streamed objects: glass, fire, hazards, lift...
 *   |-- Effects                   embers, sprinkler water, smoke, shards, bursts
 *   |-- Lighting                  sun (shadows), sky fill, pooled fire/flash/alarm lights
 *   `-- PlayerFX                  kinetic shield bubble
 */

import * as THREE from "../../three.js";
import { CausewayKit, CASE_FILES } from "./kit.js";
import { ShellTreadmill } from "./shell.js";
import { ReflectionProbe } from "./probe.js";
import { LAYERS, setLayer } from "./layers.js";
import { createGlassShared } from "./shaders/glass.js";
import { createSky, createSkyline } from "./shaders/sky.js";
import {
  createShardMaterial, buildFractureGeometry, buildChunkGeometry,
  EmberSystem, WaterSystem, SmokeSystem, SootSystem, VentFlowSystem, createBurst,
} from "./shaders/particles.js";
import {
  authoredLayout, EndlessGenerator, BEATS, ROUTE, SMOKE_ZONES, RADIO,
  themeAt, beatAt, ceilingAt, LANES,
} from "./layout.js";

export { LAYERS } from "./layers.js";
export { ROUTE, BEATS, LANES } from "./layout.js";

const SPAWN_AHEAD = 185;
const DESPAWN_BEHIND = 32;
const TICK_RANGE = 95;
const MAX_DEBRIS = 16;

function createEmitter() {
  const handlers = new Map();
  return {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name)?.delete(fn);
    },
    emit(name, payload) { for (const fn of handlers.get(name) ?? []) fn(payload); },
    clear() { handlers.clear(); },
  };
}

const LABELS = {
  pane: ["Glass pane", "Breakable. Shoot it or it costs you integrity."],
  door: ["Security door", "Reinforced. Two hits, or crash through and take damage."],
  cache: ["Sphere cache", "Shoot it for +3 spheres."],
  tank: ["Specimen tank", "Optional score. Evidence of the experiment."],
  file: ["Case file", "Gold hologram with a light beam. Run through it or shoot it."],
  sprinkler: ["Sprinkler bulb", "Shoot the red glass bulb to flood the fire below."],
  vent: ["Air vent", "Break the cover to pull smoke out of the section."],
  fire: ["Fire", "Burns integrity. Use a sprinkler or a cryo sphere."],
  hazard: ["Solid hazard", "Cannot be broken. Change lanes."],
  collapse: ["Ceiling collapse", "Watch for the red ring. Beams block the lane."],
  serum: ["Serum capsule", "Power-up. Shoot it or run through it."],
  sculpture: ["Rotating sculpture", "Steel pole blocks the centre. Blades are glass."],
  gate: ["Lift gate", "Break the three locks in order: I, II, III."],
  lift: ["Calibration lift", "Your way up to Sector 2."],
};

export class CausewayLevel {
  /**
   * @param {object} options
   * @param {THREE.Vector3} options.origin  world position of distance 0
   * @param {"story"|"endless"} options.mode
   * @param {"high"|"medium"|"low"} options.quality
   */
  constructor({ origin = new THREE.Vector3(0, 0, 4000), mode = "story", quality = "high", seed } = {}) {
    this.origin = origin.clone();
    this.mode = mode;
    this.quality = quality;
    this.events = createEmitter();
    this.route = { totalLength: mode === "endless" ? Infinity : ROUTE.length, ...ROUTE };

    this.time = { value: 0 };
    this.wet = { value: 0 };
    this.glassShared = createGlassShared(null);
    this.kit = new CausewayKit({ quality, glassShared: this.glassShared, time: this.time, wet: this.wet });

    this.root = new THREE.Group();
    this.root.name = "CausewayRoot";
    this.root.position.copy(this.origin);
    this.groups = {
      props: new THREE.Group(),
      effects: new THREE.Group(),
      lighting: new THREE.Group(),
      playerFx: new THREE.Group(),
    };
    for (const [name, group] of Object.entries(this.groups)) {
      group.name = name[0].toUpperCase() + name.slice(1);
      this.root.add(group);
    }

    // Reflection probe first: every reflective material points at its texture.
    this.probe = new ReflectionProbe({ size: quality === "low" ? 64 : 128, interval: quality === "low" ? 3 : 1 });
    this.glassShared.uEnv.value = this.probe.texture;
    // Glass samples the sharp cube map; rough PBR materials get the
    // pre-filtered copy as soon as the probe has made one.
    this.probe.onReady = (filtered) => {
      for (const key of ["floor", "floorDark", "deck", "wall", "steel", "darkSteel"]) {
        const material = this.kit.materials[key];
        material.envMap = filtered;
        material.needsUpdate = true;
      }
    };

    this.sky = createSky(this.kit.textures.noise, { cloudSteps: quality === "low" ? 3 : 6 });
    this.skyline = createSkyline(this.sky.material.uniforms);
    this.root.add(this.sky, this.skyline);

    this.tower = this.kit.distantTower();
    this.tower.position.set(-240, -120, -560);
    this.tower.visible = mode === "story";
    this.root.add(this.tower);
    this._towerFall = null;

    this.shell = new ShellTreadmill(this.kit, { segments: 30, behind: 40, themeAt: (d) => themeAt(d, mode) });
    this.root.add(this.shell.group);

    this._buildLighting();
    this._buildEffects();

    this.shield = this.kit.shield();
    this.shield.visible = false;
    this.groups.playerFx.add(this.shield);

    // Streaming state.
    this.entries = mode === "endless" ? [] : authoredLayout().filter((e) => e.type !== "event");
    this.pendingEvents = mode === "endless" ? [] : authoredLayout().filter((e) => e.type === "event");
    this.generator = mode === "endless" ? new EndlessGenerator(seed ?? Date.now()) : null;
    this.nextEntry = 0;
    this.live = [];
    this.debris = [];
    this.rings = [];
    this.breakables = [];
    this.solids = [];
    this._hinted = new Set();
    this._highlighted = null;

    this.vents = new Set();
    this.stats = { panes: 0, sprinklers: 0, extinguished: 0, vents: 0, tanks: 0, files: [], serums: 0, locks: 0, caches: 0, midair: 0 };
    this.state = {
      beatIndex: -1,
      burn: mode === "endless" ? 0.25 : 0.12,
      flash: 0,
      alarm: 0,
      smoke: 0,
      chase: { active: false, front: -Infinity, gap: Infinity },
      finale: { armed: false, nextLock: 0, open: false, opening: 0, sealed: false, sealedTime: 0 },
      lift: { active: false, t: 0, cabinY: 0, entered: false, blasted: false },
      intro: { t: 0, podBroken: false },
      tremor: { next: 6 + Math.random() * 4, t: 0, duration: 0, strength: 0, level: 0 },
    };

    this._box = new THREE.Box3();
    this._box2 = new THREE.Box3();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._player = new THREE.Vector3();
    this.distance = 0;

    // Spawn the start so the menu and intro have a world to look at.
    this._stream(0);
    this.shell.update(0);
  }

  /* ================================================================ */
  /* Construction                                                      */
  /* ================================================================ */

  _buildLighting() {
    const g = this.groups.lighting;
    const high = this.quality === "high";
    // 03:47. Moonlight is the only daylight-like source: cool and weak. The
    // scene is lit by fire, emergency lamps, failing fluorescents and the
    // burning city - which is exactly how it should feel.
    this.hemi = new THREE.HemisphereLight(0x1c2536, 0x1a0f09, 0.9);
    this.sun = new THREE.DirectionalLight(0x9fb4ff, 0.55);
    this.sun.name = "Moonlight";
    this.sun.castShadow = this.quality !== "low";
    this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    const cam = this.sun.shadow.camera;
    cam.left = -18; cam.right = 18; cam.top = 18; cam.bottom = -18; cam.near = 1; cam.far = 110;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    g.add(this.hemi, this.sun, this.sun.target);

    this.fireLights = [];
    for (let i = 0; i < (this.quality === "low" ? 2 : 4); i += 1) {
      const light = new THREE.PointLight(0xff7a2a, 0, 16, 1.8);
      light.name = `FireLight_${i}`;
      this.fireLights.push(light);
      g.add(light);
    }
    // Battery emergency lamps on the walls: warm, dim, pooled to the nearest three.
    this.emergencyLights = [];
    for (let i = 0; i < (this.quality === "low" ? 1 : 3); i += 1) {
      const light = new THREE.PointLight(0xffc98a, 0, 13, 2);
      light.name = `EmergencyLight_${i}`;
      this.emergencyLights.push(light);
      g.add(light);
    }
    this._lamps = [];
    this.flashLight = new THREE.PointLight(0xcff8ff, 0, 22, 1.6);
    this.flashLight.name = "ImpactFlash";
    this.alarmLights = [];
    for (let i = 0; i < 2; i += 1) {
      const light = new THREE.PointLight(0xff2a1f, 0, 14, 1.8);
      light.name = `AlarmLight_${i}`;
      this.alarmLights.push(light);
      g.add(light);
    }
    g.add(this.flashLight);
    this._flash = 0;
  }

  _buildEffects() {
    const fx = this.groups.effects;
    this.embers = new EmberSystem(this.time, { count: this.quality === "low" ? 160 : 360 });
    this.water = new WaterSystem(this.time, { count: this.quality === "low" ? 1200 : 2400 });
    this.smoke = new SmokeSystem(this.kit.textures.noise, this.time, { count: this.quality === "low" ? 50 : 90 });
    this.soot = new SootSystem(this.kit.textures.noise, this.embers, this.time, { count: this.quality === "low" ? 90 : 180 });
    this.ventFlow = new VentFlowSystem(this.time, { count: this.quality === "low" ? 160 : 320 });
    for (const obj of [this.embers.points, this.water.points, this.smoke.mesh, this.soot.mesh, this.ventFlow.points]) {
      obj.layers.set(LAYERS.FX);
      obj.position.set(0, 0, 0);
    }
    // Particle systems work in world space; undo the root offset.
    const holder = new THREE.Group();
    holder.name = "WorldSpaceFX";
    holder.position.copy(this.origin).multiplyScalar(-1);
    holder.add(this.embers.points, this.water.points, this.smoke.mesh, this.soot.mesh, this.ventFlow.points);
    fx.add(holder);
    this.worldFx = holder;

    this._ringGeometry = new THREE.RingGeometry(0.8, 1, 48);

    // Lift spiral: shards and score light spiralling up around the cabin.
    const count = 260;
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i += 1) seeds[i] = Math.random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 4));
    this.spiral = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uStrength;
        varying float vA;
        varying float vKind;
        void main() {
          float life = fract(uTime * (0.12 + aSeed.x * 0.1) + aSeed.y);
          float angle = aSeed.z * 6.2832 + uTime * (1.2 + aSeed.w);
          float radius = 5.5 + aSeed.w * 3.5 - life * 2.0;
          vec3 p = vec3(cos(angle) * radius, -6.0 + life * 22.0, sin(angle) * radius);
          vA = sin(life * 3.1416) * uStrength;
          vKind = aSeed.x;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (aSeed.x > 0.7 ? 260.0 : 120.0) / max(-mv.z, 0.5);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vKind;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)) * vA;
          vec3 c = vKind > 0.7 ? vec3(1.0, 0.8, 0.3) : vec3(0.5, 2.2, 2.6);
          gl_FragColor = vec4(c * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.spiral.frustumCulled = false;
    this.spiral.visible = false;
    this.spiral.layers.set(LAYERS.FX);
  }

  /* ================================================================ */
  /* Coordinates                                                       */
  /* ================================================================ */

  /** World z of a route distance. */
  worldZ(distance) { return this.origin.z - distance; }
  distanceAt(worldZ) { return this.origin.z - worldZ; }

  /* ================================================================ */
  /* Streaming                                                         */
  /* ================================================================ */

  _stream(distance) {
    if (this.generator) {
      const more = this.generator.generate(distance + SPAWN_AHEAD + 40);
      if (more.length) {
        this.entries.push(...more);
        this.entries.sort((a, b) => a.d - b.d);
        // Entries before the cursor were already consumed; keep the pointer valid.
      }
    }
    while (this.nextEntry < this.entries.length && this.entries[this.nextEntry].d < distance + SPAWN_AHEAD) {
      const entry = this.entries[this.nextEntry];
      this.nextEntry += 1;
      const record = this._spawn(entry);
      if (record) this.live.push(record);
    }
    if (this.generator && this.nextEntry > 400) {
      this.entries.splice(0, this.nextEntry);
      this.nextEntry = 0;
    }
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const record = this.live[i];
      if (record.persistent) continue;
      if (record.entry.d < distance - DESPAWN_BEHIND) {
        this._despawn(record);
        this.live.splice(i, 1);
      }
    }
  }

  _place(object, entry) {
    object.position.set(entry.x ?? 0, entry.y ?? 0, -entry.d);
    this.groups.props.add(object);
  }

  _spawn(entry) {
    const k = this.kit;
    const rec = { entry, kind: entry.type, targets: [], colliders: [], owned: [], alive: true, persistent: false };
    const mark = (kind, w, h) => {
      const marker = k.marker(kind, w, h);
      marker.position.y = 6 - (entry.y ?? 0);
      rec.root.add(marker);
    };
    const own = (target) => { target.userData.record = rec; rec.targets.push(target); };

    switch (entry.type) {
      case "pane": {
        const built = k.pane({ reinforced: entry.reinforced, mirror: entry.mirror, width: entry.width ?? 2.4 });
        rec.root = built.root; own(built.target); rec.material = built.material;
        mark("glass", entry.width ?? 2.4, 0.4);
        break;
      }
      case "door": {
        const built = k.door();
        rec.root = built.root; own(built.target); rec.material = built.material;
        mark("glass", 10.8, 0.5);
        break;
      }
      case "cache": {
        const built = k.cache();
        rec.root = built.root; own(built.target); rec.material = built.material;
        mark("cache", 0.9, 0.9);
        break;
      }
      case "tank": {
        const built = k.tank();
        rec.root = built.root; own(built.target); rec.parts = built;
        mark("glass", 1.1, 1.1);
        break;
      }
      case "file": {
        const built = k.caseFile(entry.index ?? 0);
        rec.root = built.root; own(built.target); rec.material = built.material;
        mark("file", 0.8, 0.8);
        break;
      }
      case "sprinkler": {
        const ceiling = entry.ceiling ?? (themeAt(entry.d, this.mode) === "atrium" ? 6.0 : 5.2);
        const built = k.sprinkler({ gantry: entry.gantry ?? themeAt(entry.d, this.mode) === "bridge", ceiling, x: entry.x ?? 0, auto: entry.auto });
        rec.root = built.root; rec.parts = built;
        rec.flow = 0; rec.active = false;
        if (entry.auto) { rec.active = true; rec.flow = 1; rec.auto = true; }
        else { own(built.target); mark("sprinkler", 0.7, 0.7); }
        break;
      }
      case "vent": {
        const bridge = themeAt(entry.d, this.mode) === "bridge";
        const built = k.vent({ side: entry.side ?? -1, height: entry.height ?? 2.5, gantry: entry.gantry ?? bridge });
        rec.root = built.root; own(built.target); rec.parts = built;
        rec.fanSpeed = 1.2;
        mark("vent", 0.6, 1.4);
        rec.root.children.at(-1).position.x = (entry.side ?? -1) * 5.3;
        break;
      }
      case "fire": {
        const built = k.fire({ width: entry.width ?? 3, height: entry.height ?? 2.6, depth: entry.depth ?? 2.4 });
        rec.root = built.root; rec.parts = built;
        rec.intensity = 1; rec.target = 1; rec.size = built.size;
        rec.world = new THREE.Vector3();
        rec.decor = !!entry.decor;
        if (!rec.decor) mark("fire", built.size.x, built.size.z);
        break;
      }
      case "hazard": {
        const built = k.hazard(entry.kind ?? "cart");
        rec.root = built.root; rec.colliders.push(built.collider);
        mark("hazard", 2.2, 1.2);
        break;
      }
      case "collapse": {
        const beam = entry.kind !== "glass";
        const built = beam ? k.beam() : k.fallingGlass();
        rec.root = built.root; rec.parts = built;
        rec.state = "waiting"; rec.fallY = ceilingAt(entry.d, this.mode) - 0.4; rec.vy = 0; rec.frozen = 0;
        built.body.position.y = rec.fallY;
        built.body.rotation.z = (Math.random() - 0.5) * 0.3;
        if (beam) rec.colliders.push(built.collider);
        else own(built.target);
        rec.beam = beam;
        mark(beam ? "hazard" : "glass", 2.4, 0.9);
        break;
      }
      case "serum": {
        const built = k.serum(entry.serum ?? "prism");
        rec.root = built.root; own(built.target); rec.material = built.material; rec.serum = entry.serum;
        mark("serum", 0.9, 0.9);
        break;
      }
      case "sculpture": {
        const built = k.sculpture({ speed: entry.speed ?? 1.1 });
        rec.root = built.root; rec.parts = built;
        for (const blade of built.blades) own(blade);
        rec.colliders.push(built.collider);
        mark("hazard", 0.6, 0.6);
        mark("glass", 6.8, 0.3);
        break;
      }
      case "gate": {
        const built = k.gate();
        rec.root = built.root; rec.parts = built;
        for (const lock of built.locks) own(lock.mesh);
        rec.colliders.push(built.collider);
        rec.persistent = true;
        mark("lock", 11, 0.6);
        this.gate = rec;
        break;
      }
      case "lift": {
        const built = k.lift();
        rec.root = built.root; rec.parts = built;
        rec.persistent = true;
        this.lift = rec;
        built.cabin.add(this.spiral);
        break;
      }
      case "pod": {
        const built = k.pod();
        rec.root = built.root; rec.parts = built;
        rec.persistent = true;
        this.pod = rec;
        break;
      }
      case "sign": {
        const sign = k.sign(k.textures.signs[entry.sign], entry.width ?? 3.2, entry.height ?? 0.8);
        rec.root = new THREE.Group();
        rec.root.add(sign);
        if (entry.side) sign.rotation.y = entry.side < 0 ? Math.PI / 2 : -Math.PI / 2;
        rec.root.userData.owned = sign.userData.owned;
        break;
      }
      case "beacon": {
        const built = k.beacon();
        rec.root = built.root;
        rec.root.position.y = ceilingAt(entry.d, this.mode) - 0.05;
        rec.isBeacon = true;
        rec.parts = built;
        break;
      }
      default:
        return null;
    }
    rec.root.userData.record = rec;
    const y = entry.type === "beacon" ? rec.root.position.y : entry.y ?? 0;
    this._place(rec.root, { ...entry, y });
    if (entry.type === "fire") this._v.set(entry.x ?? 0, 0, -entry.d).add(this.origin), rec.world.copy(this._v);
    if (entry.type === "vent") rec.root.position.x = 0;
    return rec;
  }

  _despawn(rec) {
    rec.root.traverse((object) => {
      for (const item of object.userData?.owned ?? []) item.dispose?.();
    });
    rec.root.parent?.remove(rec.root);
    if (this._highlighted && rec.targets.includes(this._highlighted)) this._highlighted = null;
  }

  /* ================================================================ */
  /* Queries used by the host game                                     */
  /* ================================================================ */

  /** Smoke density (0..1) at a route distance. */
  smokeAt(distance) {
    let s = 0;
    if (this.mode === "story") {
      for (const zone of SMOKE_ZONES) {
        const edge = Math.min(distance - zone.from, zone.to - distance);
        if (edge <= -8) continue;
        const cleared = zone.vents.filter((id) => this.vents.has(id)).length / zone.vents.length;
        s += zone.density * THREE.MathUtils.smoothstep(edge, -8, 8) * (1 - cleared * 0.85);
      }
    }
    for (const rec of this.live) {
      if (rec.kind !== "fire" || rec.intensity < 0.05) continue;
      const gap = Math.abs(rec.entry.d - distance);
      if (gap < 18) s += (rec.decor ? 0.06 : 0.2) * rec.intensity * (1 - gap / 18);
    }
    return THREE.MathUtils.clamp(s, 0, 1);
  }

  /** How much fire the player box is standing in, 0..1. */
  fireExposure(playerBox) {
    let exposure = 0;
    for (const rec of this.live) {
      if (rec.kind !== "fire" || rec.intensity < 0.25 || rec.decor) continue;
      const { x, y, z } = rec.size;
      this._v.copy(rec.world);
      this._box.min.set(this._v.x - x * 0.4, 0, this._v.z - z * 0.45);
      this._box.max.set(this._v.x + x * 0.4, y * 0.85, this._v.z + z * 0.45);
      if (this._box.intersectsBox(playerBox)) exposure = Math.max(exposure, rec.intensity);
    }
    return exposure;
  }

  /**
   * Test the player against everything near them.
   * @returns {{hits: THREE.Mesh[], panes: THREE.Mesh[], grazes: THREE.Mesh[], pickups: object[]}}
   */
  collide(playerBox, distance) {
    const hits = [];
    const panes = [];
    const grazes = [];
    const pickups = [];
    this._box2.copy(playerBox).expandByScalar(0.55);
    playerBox.getCenter(this._player);
    for (const rec of this.live) {
      if (Math.abs(rec.entry.d - distance) > 10) continue;
      for (const collider of rec.colliders) {
        if (collider.userData.disabled) continue;
        collider.updateWorldMatrix(true, false);
        collider.geometry.boundingBox ?? collider.geometry.computeBoundingBox();
        this._box.copy(collider.geometry.boundingBox).applyMatrix4(collider.matrixWorld);
        if (this._box.intersectsBox(playerBox)) hits.push(collider);
        else if (this._box.intersectsBox(this._box2)) grazes.push(collider);
      }
      for (const target of rec.targets) {
        if (!target.userData.alive) continue;
        const kind = target.userData.kind;
        if (kind === "serum" || kind === "file") {
          target.getWorldPosition(this._v);
          if (this._v.distanceTo(this._player) < (kind === "file" ? 1.8 : 1.5)) pickups.push(target);
          continue;
        }
        if (kind !== "pane" && kind !== "door" && kind !== "blade" && kind !== "falling") continue;
        target.updateWorldMatrix(true, false);
        target.geometry.boundingBox ?? target.geometry.computeBoundingBox();
        this._box.copy(target.geometry.boundingBox).applyMatrix4(target.matrixWorld);
        if (this._box.intersectsBox(playerBox)) panes.push(target);
      }
    }
    return { hits, panes, grazes, pickups };
  }

  /**
   * Swept-sphere contact with the streamed corridor shell.
   *
   * Its walls and ceilings are InstancedMeshes rather than gameplay
   * colliders, so their analytic inner planes are cheaper and more exact than
   * raycasting every streamed instance. The bridge is deliberately open.
   */
  corridorSurfaceHit(start, end, radius = 0) {
    const distance = this.origin.z - (start.z + end.z) * 0.5;
    const theme = themeAt(distance, this.mode);
    if (theme === "bridge") return null;

    let best = null;
    const consider = (centre, point, normal, surface, side = null) => {
      const hitDistance = start.distanceTo(centre);
      if (best && best.distance <= hitDistance) return;
      const position = centre.clone().addScaledVector(normal, 0.01);
      best = { normal, point, position, distance: hitDistance, surface, side };
    };

    const dx = end.x - start.x;
    const innerWall = theme === "ward" ? 5.8 : 5.95;
    const right = innerWall - radius;
    const left = -innerWall + radius;
    if (dx > 1e-7 && end.x > right) {
      const t = THREE.MathUtils.clamp((right - start.x) / dx, 0, 1);
      const centre = start.clone().lerp(end, t);
      centre.x = right;
      const point = centre.clone(); point.x = innerWall;
      consider(centre, point, new THREE.Vector3(-1, 0, 0), "wall", "right");
    } else if (dx < -1e-7 && end.x < left) {
      const t = THREE.MathUtils.clamp((left - start.x) / dx, 0, 1);
      const centre = start.clone().lerp(end, t);
      centre.x = left;
      const point = centre.clone(); point.x = -innerWall;
      consider(centre, point, new THREE.Vector3(1, 0, 0), "wall", "left");
    }

    const dy = end.y - start.y;
    const ceiling = ceilingAt(distance, this.mode);
    const ceilingLimit = ceiling - radius;
    if (dy > 1e-7 && end.y > ceilingLimit) {
      const t = THREE.MathUtils.clamp((ceilingLimit - start.y) / dy, 0, 1);
      const centre = start.clone().lerp(end, t);
      centre.y = ceilingLimit;
      const point = centre.clone(); point.y = ceiling;
      consider(centre, point, new THREE.Vector3(0, -1, 0), "ceiling");
    }

    return best;
  }

  /** Targets within `radius` of a world point (for the shock sphere). */
  targetsNear(point, radius) {
    const out = [];
    for (const target of this.breakables) {
      target.getWorldPosition(this._v);
      if (this._v.distanceTo(point) <= radius) out.push(target);
    }
    return out;
  }

  /** Aim feedback: brighten whatever the reticle is over. */
  setHighlight(mesh) {
    if (this._highlighted === mesh) return;
    const set = (m, v) => {
      const u = m?.userData.record?.material?.uniforms?.uHighlight;
      if (u) u.value = v;
      else if (m?.material?.uniforms?.uHighlight) m.material.uniforms.uHighlight.value = v;
    };
    set(this._highlighted, 0);
    set(mesh, 1);
    this._highlighted = mesh;
  }

  /** Points of interest for the level preview flythrough. */
  landmarks(distance, ahead = 44) {
    const out = [];
    const seen = new Set();
    for (const rec of this.live) {
      const gap = rec.entry.d - distance;
      if (gap < 6 || gap > ahead) continue;
      const kind = rec.kind === "door" ? "door" : rec.kind;
      const label = LABELS[kind];
      if (!label || seen.has(kind)) continue;
      seen.add(kind);
      const position = new THREE.Vector3();
      rec.root.getWorldPosition(position);
      position.y += kind === "sprinkler" ? 4.2 : kind === "gate" ? 6.5 : kind === "vent" ? 2.5 : kind === "file" ? 1.0 : 1.8;
      if (kind === "vent") position.x = (rec.entry.side ?? -1) * 5;
      out.push({ kind, title: label[0], text: label[1], position, gap });
    }
    return out;
  }

  /* ================================================================ */
  /* Breaking things                                                   */
  /* ================================================================ */

  /**
   * Break (or damage) a target.
   * @param {THREE.Mesh} mesh
   * @param {{point?:THREE.Vector3, direction?:THREE.Vector3, ball?:string, body?:boolean}} hit
   * @returns {null | {kind, points, spheres, label, position, cracked?, rejected?, serum?, file?}}
   */
  breakTarget(mesh, { point, direction, ball = "glass", body = false } = {}) {
    const data = mesh.userData;
    if (!data.alive) return null;
    const rec = data.record;
    const position = new THREE.Vector3();
    mesh.getWorldPosition(position);
    const hitPoint = point ?? position;
    const push = (direction ?? new THREE.Vector3(0, 0, -1)).clone().normalize();
    const kind = data.kind;
    const result = { kind, points: data.points ?? 100, spheres: 0, label: "", position: hitPoint.clone() };

    if (kind === "lock") {
      const finale = this.state.finale;
      if (data.order !== finale.nextLock) {
        const lock = rec.parts.locks[data.order];
        lock.material.uniforms.uColor.value.set(0xff3030);
        lock.flash = 0.6;
        this.events.emit("sequence-error", { expected: finale.nextLock + 1 });
        return { ...result, points: 0, rejected: true, label: `LOCK ${["I", "II", "III"][finale.nextLock]} FIRST` };
      }
      data.alive = false;
      mesh.visible = false;
      rec.parts.locks[data.order].ring.visible = false;
      finale.nextLock += 1;
      this.stats.locks += 1;
      rec.parts.conduitMaterial.uniforms.uCharge.value = finale.nextLock / 3;
      this._chunks(position, 10, { tint: 0xffd23f, speed: 5 });
      this._burst("sparks", position);
      this._flashAt(position, 0xffd23f, 6);
      result.label = `LOCK ${["I", "II", "III"][data.order]} RELEASED`;
      if (finale.nextLock >= 3) {
        finale.open = true;
        result.label = "GATE OPEN // RUN";
        this.events.emit("gate-open", {});
      } else {
        this.events.emit("lock", { index: data.order });
      }
      return result;
    }

    // Reinforced glass and doors take two hits unless it's a shock sphere or a body.
    if ((kind === "pane" || kind === "door") && data.hits > 1 && !body && ball !== "shock") {
      data.hits -= 1;
      const local = mesh.worldToLocal(hitPoint.clone());
      const u = rec.material.uniforms;
      u.uImpact.value.set(local.x, local.y);
      rec.crackTarget = 1;
      this._burst("sparks", hitPoint, { count: 30, speed: 4, color: 0xcff8ff });
      this._flashAt(hitPoint, 0xcff8ff, 3);
      return { ...result, points: 50, cracked: true, label: "CRACKED // HIT AGAIN" };
    }

    data.alive = false;
    mesh.visible = false;
    if (rec.targets.every((t) => !t.userData.alive)) {
      rec.root.traverse((o) => { if (o.userData.isMarker) o.visible = false; });
    }
    this._flashAt(hitPoint, 0xcff8ff, kind === "door" ? 14 : 7);

    if (kind === "pane" || kind === "door" || kind === "blade" || kind === "falling") {
      const size = data.size;
      const local = mesh.worldToLocal(hitPoint.clone());
      mesh.updateWorldMatrix(true, false);
      const geometry = buildFractureGeometry(mesh.matrixWorld, size, new THREE.Vector2(local.x, local.y), push, {
        spokes: kind === "door" ? 16 : 11,
        rings: kind === "door" ? 5 : 4,
        power: body ? 0.6 : ball === "shock" ? 1.8 : 1,
      });
      this._addDebris(geometry, kind === "door" ? 0xd4fff4 : 0xcff8ff);
      this.stats.panes += 1;
      this.events.emit("glass-break", {
        kind, body, position: hitPoint.clone(), radius: Math.max(data.size?.x ?? 1.8, 1.8) * 0.55,
      });
      if (kind === "falling") {
        this.stats.midair += rec.state === "falling" ? 1 : 0;
        result.points = rec.state === "falling" ? 400 : 150;
        result.label = rec.state === "falling" ? "MID-AIR SHATTER" : "";
        rec.state = "broken";
      }
      if (kind === "door") result.label = "SECURITY DOOR BREACHED";
    } else if (kind === "cache") {
      result.spheres = 3;
      result.label = "+3 SPHERES";
      this.stats.caches += 1;
      this._chunks(position, 14, { tint: 0x66f2ff, speed: 5 });
      this._burst("score", position);
      rec.hidden = true;
      rec.root.visible = false;
      this.events.emit("sphere-cache", { count: result.spheres, position: position.clone() });
    } else if (kind === "tank") {
      rec.parts.glass.visible = false;
      rec.parts.liquid.visible = false;
      this._chunks(position, 22, { tint: 0xd8fff0, speed: 4.5, radius: 0.6 });
      this._burst("fluid", position);
      this.stats.tanks += 1;
      result.label = "SPECIMEN RELEASED";
    } else if (kind === "file") {
      const index = data.fileIndex;
      if (!this.stats.files.includes(index)) this.stats.files.push(index);
      rec.hidden = true;
      rec.root.visible = false;
      this._burst("score", position, { count: 60 });
      result.file = index;
      result.label = `${CASE_FILES[index][0]} RECOVERED`;
      this.events.emit("file", { index, lines: CASE_FILES[index], found: this.stats.files.length, total: CASE_FILES.length });
    } else if (kind === "sprinkler") {
      rec.parts.bulb.visible = false;
      rec.active = true;
      this.stats.sprinklers += 1;
      this._burst("steam", position, { count: 30 });
      result.label = "SPRINKLER OPEN";
      this.events.emit("sprinkler", { count: this.stats.sprinklers });
    } else if (kind === "vent") {
      rec.parts.cover.visible = false;
      rec.parts.status.material = this.kit.materials.led;
      rec.parts.rim.material = this.kit.materials.ventRimDone;
      rec.fanSpeed = 22;
      rec.venting = 0;
      if (rec.entry.id) this.vents.add(rec.entry.id);
      this.stats.vents += 1;
      rec.parts.cover.getWorldPosition(this._v);
      this._chunks(this._v, 12, { tint: 0xe0ffff, speed: 3 });
      this._burst("dust", this._v, { count: 50, color: 0xb8c2c8 });
      result.label = "VENT CLEAR // AIR RETURNING";
      this.events.emit("vent", { id: rec.entry.id });
    } else if (kind === "serum") {
      result.serum = rec.serum;
      result.points = 300;
      rec.hidden = true;
      rec.root.visible = false;
      this._burst("score", position, { count: 70, color: 0xff5ad0 });
      this.stats.serums += 1;
      this.events.emit("serum", { type: rec.serum });
    }
    return result;
  }

  /**
   * Area effect of a special sphere.
   *   cryo  - puts out fires and freezes falling debris within `radius`.
   * @returns {{extinguished:number, frozen:number}}
   */
  splash(point, radius, ball) {
    let extinguished = 0;
    let frozen = 0;
    if (ball === "cryo") {
      this._burst("cryo", point);
      this._ring(point, 0x9ff4ff, radius);
      for (const rec of this.live) {
        if (rec.kind === "fire" && rec.target > 0 && rec.world.distanceTo(point) < radius + rec.size.x * 0.5) {
          rec.target = 0;
          extinguished += 1;
        }
        if (rec.kind === "collapse" && (rec.state === "falling" || rec.state === "warning")) {
          rec.parts.body.getWorldPosition(this._v);
          if (this._v.distanceTo(point) < radius + 1) { rec.frozen = 2.5; frozen += 1; }
        }
      }
      if (extinguished) {
        this.stats.extinguished += extinguished;
        this.events.emit("extinguish", { count: extinguished, by: "cryo" });
      }
    } else if (ball === "shock") {
      this._burst("shock", point);
      this._ring(point, 0xd28bff, radius);
      this._flashAt(point, 0xd28bff, 10);
    }
    return { extinguished, frozen };
  }

  /** Bounce feedback when a sphere hits something solid. */
  ricochet(point) {
    this._burst("sparks", point, { count: 24, speed: 5 });
  }

  impact(strength = 1) {
    this.state.alarm = Math.min(1.5, this.state.alarm + strength);
  }

  /* ================================================================ */
  /* Effects helpers                                                   */
  /* ================================================================ */

  _addDebris(geometry, tint, life = 3.2) {
    const material = createShardMaterial(this.glassShared, tint, life);
    material.uniforms.uFloorHalfWidth.value = themeAt(this.distance, this.mode) === "bridge" ? 5.9 : 6.0;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    // GLASS layer, not FX: shards sample the probe cube map, so they must be
    // hidden from the probe's own cameras or the probe would read the texture
    // it is writing to (a WebGL feedback loop).
    mesh.layers.set(LAYERS.GLASS);
    // Shard geometry is in world space; parent it to the scene root, not ours.
    this.worldFx.add(mesh);
    this.debris.push({ mesh, age: 0, life });
    while (this.debris.length > MAX_DEBRIS) this._removeDebris(0);
  }

  _removeDebris(index) {
    const d = this.debris[index];
    d.mesh.parent?.remove(d.mesh);
    d.mesh.geometry.dispose();
    d.mesh.material.dispose();
    this.debris.splice(index, 1);
  }

  _chunks(centre, count, { tint = 0xcff8ff, speed = 4, radius = 0.4, size = 0.12 } = {}) {
    this._addDebris(buildChunkGeometry(centre, count, { speed, radius, size }), tint, 2.4);
  }

  _burst(kind, point, overrides = {}) {
    const burst = createBurst(kind, point, overrides);
    burst.layers.set(LAYERS.FX);
    this.worldFx.add(burst);
    this.debris.push({ mesh: burst, age: 0, life: burst.userData.life * 1.2, burst: true });
    while (this.debris.length > MAX_DEBRIS + 8) this._removeDebris(0);
  }

  _ring(point, colour, radius) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this._ringGeometry, material);
    ring.position.copy(point);
    ring.lookAt(point.x, point.y, point.z + 1);
    ring.layers.set(LAYERS.FX);
    this.worldFx.add(ring);
    this.rings.push({ ring, age: 0, radius });
  }

  _flashAt(point, colour, strength) {
    this._v.copy(point);
    this.flashLight.position.copy(this._v).sub(this.origin);
    this.flashLight.color.set(colour);
    this._flash = Math.max(this._flash, strength);
  }

  /* ================================================================ */
  /* Scripted events                                                   */
  /* ================================================================ */

  _runEvent(entry, distance) {
    switch (entry.event) {
      case "radio":
        this.events.emit("radio", { who: RADIO[entry.who], speaker: entry.who, text: entry.text });
        break;
      case "title": {
        const beat = BEATS[entry.beat];
        this.events.emit("title", { index: entry.beat, name: beat.name });
        break;
      }
      case "explosion":
        this._explode(distance - (entry.behind ?? 20), entry.strength ?? 1);
        break;
      case "tower":
        this._towerFall = { t: 0 };
        this.events.emit("tower-collapse", {});
        this.events.emit("radio", { who: RADIO.halcyon, speaker: "halcyon", text: "Tower C has lost its core. Brace." });
        break;
      case "chaseStart": {
        const chase = this.state.chase;
        chase.active = true;
        chase.front = distance - ROUTE.chase.gap;
        this.events.emit("chase-start", {});
        break;
      }
      case "chaseEnd":
        this.state.chase.active = false;
        this.events.emit("chase-end", {});
        break;
      case "finale":
        this.state.finale.armed = true;
        this.events.emit("gate-armed", {});
        break;
      default:
        break;
    }
  }

  _explode(atDistance, strength = 1) {
    const point = new THREE.Vector3(0, 3, this.worldZ(atDistance));
    this._burst("fireball", point, { scale: 1400 * strength });
    this._burst("sparks", point, { count: 120, speed: 16 });
    this._burst("dust", point, { count: 120, scale: 1100, speed: 6 });
    this._ring(point, 0xff8a3d, 14 * strength);
    this._flashAt(point, 0xff8a3d, 14 * strength);
    this.state.flash = Math.max(this.state.flash, Math.min(0.35, 0.25 * strength));
    this.state.burn = Math.min(0.9, this.state.burn + 0.12 * strength);
    this.events.emit("explosion", { strength, position: point });
  }

  /* ================================================================ */
  /* Per-frame update                                                  */
  /* ================================================================ */

  /**
   * @param {{dt:number, time:number, distance:number, player?:THREE.Vector3, playing?:boolean}} args
   */
  update({ dt, time, distance, player, playing = true }) {
    this.distance = distance;
    this.time.value = time;
    this.glassShared.uTime.value = time;
    const s = this.state;

    if (playing) {
      while (this.pendingEvents.length && this.pendingEvents[0].d <= distance) {
        this._runEvent(this.pendingEvents.shift(), distance);
      }
    }

    this._stream(distance);
    const chase = s.chase;
    if (chase.active && playing) {
      chase.front += ROUTE.chase.speed * dt;
      chase.front = Math.max(chase.front, distance - 70);
      chase.gap = distance - chase.front;
      if (Math.random() < dt * 1.6) {
        this._burst("dust", new THREE.Vector3((Math.random() - 0.5) * 10, 0.5, this.worldZ(chase.front)), { count: 40, scale: 900 });
      }
    } else chase.gap = Infinity;
    this.shell.collapseFront = chase.front;
    this.shell.update(distance);

    // Beats.
    const beat = beatAt(distance);
    const beatIndex = BEATS.indexOf(beat);
    if (beatIndex !== s.beatIndex) {
      s.beatIndex = beatIndex;
      this.events.emit("beat", { index: beatIndex, key: beat.key, name: beat.name });
    }

    // Player-side positions.
    if (player) this._player.copy(player);
    else this._player.set(0, 1.4, this.worldZ(distance));

    // Hints: announce an object's purpose the first time it comes into view.
    if (playing) {
      for (const rec of this.live) {
        const hint = rec.entry.hint;
        if (hint && !this._hinted.has(rec.entry) && rec.entry.d - distance < 30 && rec.entry.d > distance) {
          this._hinted.add(rec.entry);
          this.events.emit("hint", { text: hint });
        }
      }
    }

    this._updateTremor(dt, distance, playing);
    this._updateProps(dt, time, distance, playing);
    this._updateFires(dt, distance);
    this._updateAtmosphere(dt, time, distance);
    this._updateLights(dt, time, distance);
    this._updateEffects(dt, time);
    if (this._towerFall) this._updateTower(dt);
    this._updateFinale(dt, distance, playing);

    this.shield.position.copy(this._player).sub(this.origin);
    this.probe.position.set(this._player.x * 0.5, 1.8, this._player.z - 7);

    // Aimable targets.
    this.breakables.length = 0;
    this.solids.length = 0;
    for (const rec of this.live) {
      if (rec.entry.d < distance - 4 || rec.entry.d > distance + 120) continue;
      for (const t of rec.targets) if (t.userData.alive) this.breakables.push(t);
      for (const c of rec.colliders) if (!c.userData.disabled) this.solids.push(c);
    }
    return s;
  }

  _updateProps(dt, time, distance, playing) {
    // Draw distance follows the fog: the ward and atrium are hazy enough that
    // props past ~115 m are invisible anyway; the open bridge needs more.
    const theme = themeAt(distance + 40, this.mode);
    const viewDistance = theme === "bridge" ? 165 : 120;
    for (const rec of this.live) {
      const gap = rec.entry.d - distance;
      const near = gap > -40 && gap < TICK_RANGE;
      rec.root.visible = !rec.hidden && gap > -30 && gap < viewDistance;
      if (!near) continue;
      rec.root.userData.tick?.(dt, time);

      if (rec.crackTarget && rec.material) {
        const u = rec.material.uniforms.uCrack;
        u.value = Math.min(rec.crackTarget, u.value + dt * 6);
      }
      if (rec.kind === "sprinkler" && rec.active) rec.flow = Math.min(1, rec.flow + dt * 2.5);
      if (rec.kind === "vent") {
        rec.parts.fan.rotation.x += dt * rec.fanSpeed;
      }
      if (rec.kind === "collapse" && playing) this._updateCollapse(rec, dt, gap);
      if (rec.kind === "gate") {
        for (const lock of rec.parts.locks) {
          const active = this.state.finale.armed && lock.mesh.userData.order === this.state.finale.nextLock;
          if (lock.flash > 0) lock.flash -= dt;
          else lock.material.uniforms.uColor.value.set(active ? 0xffd23f : 0x6a5a2a);
          lock.material.uniforms.uHighlight.value = active ? 0.6 + 0.4 * Math.sin(time * 6) : 0;
          lock.ring.rotation.z += dt * (active ? 2.5 : 0.3);
        }
      }
    }
  }

  _updateCollapse(rec, dt, gap) {
    const parts = rec.parts;
    if (rec.state === "waiting" && gap < 44) {
      rec.state = "warning";
      rec.warnT = 0;
      parts.warning.visible = true;
      rec.root.getWorldPosition(this._v);
      this._v.y = rec.fallY;
      this._burst("dust", this._v, { count: 40, gravity: 3, rise: 0, speed: 1.5 });
      this.events.emit("collapse-warning", { x: rec.entry.x });
    }
    if (rec.state === "warning") {
      rec.warnT += dt;
      parts.body.rotation.z += Math.sin(rec.warnT * 30) * dt * 0.4;
      parts.warning.material.opacity = 0.5 + 0.5 * Math.sin(rec.warnT * 12);
      if (gap < 21) {
        rec.state = "falling"; rec.vy = 0;
        this.events.emit("collapse-start", { id: rec.entry, x: rec.entry.x, beam: rec.beam });
      }
    }
    if (rec.state === "falling") {
      if (rec.frozen > 0) { rec.frozen -= dt; return; }
      rec.vy -= 15 * dt;
      parts.body.position.y += rec.vy * dt;
      parts.body.rotation.x += dt * 1.2;
      const rest = rec.beam ? 0.35 : 0.1;
      if (parts.body.position.y <= rest) {
        parts.body.position.y = rest;
        parts.body.rotation.x = rec.beam ? 0.08 : Math.PI / 2;
        rec.state = "landed";
        parts.warning.visible = false;
        rec.root.getWorldPosition(this._v);
        this._v.y = 0.3;
        this._burst("dust", this._v, { count: 90, scale: 800 });
        this._burst("sparks", this._v);
        this.events.emit("collapse-landed", { id: rec.entry, x: rec.entry.x, beam: rec.beam });
        if (!rec.beam && rec.targets[0]?.userData.alive) {
          // Glass shatters on the floor on its own - no score for this.
          const target = rec.targets[0];
          this.breakTarget(target, { body: true, direction: new THREE.Vector3(0, -1, 0) });
          this.stats.panes -= 1;
        }
      }
    }
  }

  _updateFires(dt, distance) {
    for (const rec of this.live) {
      if (rec.kind !== "sprinkler" || !rec.active) continue;
      for (const fire of this.live) {
        if (fire.kind !== "fire" || fire.target === 0) continue;
        if (Math.abs(fire.entry.d - rec.entry.d) < 13 && fire.entry.d - distance < 60) {
          fire.target = 0;
          this.stats.extinguished += 1;
          this.events.emit("extinguish", { count: 1, by: "sprinkler" });
        }
      }
    }
    for (const rec of this.live) {
      if (rec.kind !== "fire") continue;
      const before = rec.intensity;
      rec.intensity += (rec.target - rec.intensity) * Math.min(1, dt * (rec.target ? 2 : 1.3));
      if (rec.target === 0 && rec.intensity < 0.02) rec.intensity = 0;
      rec.parts.material.uniforms.uIntensity.value = rec.intensity;
      if (before > 0.5 && rec.intensity <= 0.5 && rec.target === 0) {
        this._burst("steam", this._v.copy(rec.world).setY(1), { count: 80, scale: 900 });
      }
    }
  }

  _updateAtmosphere(dt, time, distance) {
    const s = this.state;
    const sky = this.sky.material.uniforms;
    const progress = this.mode === "endless" ? 0.35 + 0.15 * Math.sin(distance / 300) : THREE.MathUtils.clamp(distance / ROUTE.length, 0, 1);
    const targetBurn = Math.max(s.burn, 0.12 + progress * 0.6);
    s.burn += (targetBurn - s.burn) * Math.min(1, dt * 0.5);
    s.flash = Math.max(0, s.flash - dt * 1.4);
    s.smoke = this.smokeAt(distance);
    sky.uTime.value = time;
    sky.uBurn.value = s.burn;
    sky.uFlash.value = s.flash;
    this.sky.position.copy(this._player).sub(this.origin);
    const haze = sky.uHaze.value;
    haze.setRGB(0.03, 0.03, 0.045).lerp(this._c1 ??= new THREE.Color(0.075, 0.042, 0.03), s.burn);
    this.hazeColor = haze;

    // Smoke profile for the ceiling smoke: density every 10 m from 20 m behind.
    for (let i = 0; i < 16; i += 1) this.smoke.profile[i] = this.smokeAt(distance - 20 + i * 10);
    const su = this.smoke.material.uniforms;
    su.uAnchorZ.value = this.worldZ(distance);
    su.uCeiling.value = ceilingAt(distance, this.mode);
    su.uColor.value.setRGB(0.1, 0.095, 0.09).lerp(this._c2 ??= new THREE.Color(0.06, 0.05, 0.045), s.burn);
    this.soot.material.uniforms.uCeiling.value = ceilingAt(distance, this.mode) + (themeAt(distance, this.mode) === "bridge" ? 20 : 0);

    // Wet floor near open sprinklers.
    let wet = 0;
    for (const rec of this.live) {
      if (rec.kind === "sprinkler" && rec.flow > 0) {
        const gap = Math.abs(rec.entry.d - distance);
        wet = Math.max(wet, rec.flow * THREE.MathUtils.clamp(1 - (gap - 10) / 25, 0, 1));
      }
    }
    this.wet.value += (wet - this.wet.value) * Math.min(1, dt * 1.5);

    // Fog: thin on the bridge, thicker indoors, much thicker in smoke.
    const theme = themeAt(distance, this.mode);
    const base = theme === "bridge" ? 0.008 : theme === "atrium" ? 0.014 : 0.019;
    this.fogDensity = base + s.smoke * 0.04;
    this.fogColor = (this._fog ??= new THREE.Color()).copy(haze).lerp(this._smokeFog ??= new THREE.Color(0.07, 0.06, 0.055), Math.min(1, s.smoke * 1.2));
  }

  _updateLights(dt, time, distance) {
    const p = this._player;
    const theme = themeAt(distance, this.mode);
    // Sun follows the player so the shadow map always covers the screen.
    const sunDir = this.sky.material.uniforms.uSunDir.value;
    const local = this._v.copy(p).sub(this.origin);
    this.sun.target.position.copy(local).add(this._v2.set(0, 0, -8));
    this.sun.position.copy(this.sun.target.position).addScaledVector(sunDir, 60);
    const tremor = this.state.tremor.level;
    this.sun.intensity = (theme === "bridge" ? 0.75 : 0.5) * (1 - this.state.smoke * 0.5);
    this.hemi.intensity = (theme === "bridge" ? 1.1 : theme === "atrium" ? 0.95 : 0.85) * (1 - this.state.smoke * 0.35);
    this.shell.updateFixtures(time, tremor);

    // Emergency lamps: pooled lights at the three nearest wall lamps. They
    // brown out when the building shakes.
    const lamps = this.shell.emergencyLamps(distance, this.emergencyLights.length, this._lamps);
    this.emergencyLights.forEach((light, i) => {
      const l = lamps[i];
      if (!l) { light.intensity = 0; return; }
      light.position.set(l.x, l.y, l.z);
      const flicker = Math.sin(time * 23 + l.k) > 0.93 ? 0.4 : 1;
      light.intensity = 7 * flicker * (1 - tremor * 0.7);
    });

    // Pooled fire lights bind to the nearest burning fires.
    const fires = this.live
      .filter((r) => r.kind === "fire" && r.intensity > 0.02 && r.entry.d > distance - 12 && r.entry.d < distance + 70)
      .sort((a, b) => Math.abs(a.entry.d - distance) - Math.abs(b.entry.d - distance));
    this.fireLights.forEach((light, i) => {
      const f = fires[i];
      if (!f) { light.intensity = 0; return; }
      light.position.set(f.entry.x ?? 0, 1.6, -f.entry.d);
      const flicker = 0.75 + 0.25 * Math.sin(time * 17 + i * 3) * Math.sin(time * 7.3 + i);
      light.intensity = 16 * f.intensity * flicker;
    });
    this.embers.bind(fires);

    const heads = this.live
      .filter((r) => r.kind === "sprinkler" && r.flow > 0 && r.entry.d > distance - 10 && r.entry.d < distance + 70)
      .sort((a, b) => Math.abs(a.entry.d - distance) - Math.abs(b.entry.d - distance))
      .slice(0, 6);
    this._heads = heads.map((r) => {
      r.parts.head.getWorldPosition(this._v2);
      // Mist where the spray hits the floor.
      r.mistTimer = (r.mistTimer ?? Math.random() * 0.8) - (this._dt ?? 0.016);
      if (r.mistTimer <= 0 && Math.abs(r.entry.d - distance) < 40) {
        r.mistTimer = 0.7;
        this._burst("steam", this._v.set(this._v2.x, 0.3, this._v2.z), { count: 14, scale: 380, speed: 1.2, life: 1.4, color: 0x56626a });
      }
      return { world: this._v2.clone(), flow: r.flow };
    });
    this.water.bind(this._heads);

    // Vents: the shared rim glow pulses harder the smokier the air (so an
    // unbroken vent is easiest to spot exactly when you need it), and the
    // four nearest broken vents draw smoke in.
    const smoky = THREE.MathUtils.smoothstep(this.state.smoke, 0.15, 0.6);
    const pulse = 1 + smoky * (1.2 + 1.2 * Math.sin(time * 6));
    this.kit.materials.ventRim.color.setRGB(0.35 * pulse, 1.5 * pulse, 1.8 * pulse);
    this._ventSlots ??= [];
    this._ventSlots.length = 0;
    for (const r of this.live) {
      if (r.kind !== "vent" || r.venting === undefined || Math.abs(r.entry.d - distance) > 60) continue;
      r.venting = Math.min(1, r.venting + (this._dt ?? 0.016) * 0.8);
      const world = r.parts.cover.getWorldPosition(new THREE.Vector3());
      const normal = r.parts.cover.getWorldDirection(new THREE.Vector3());
      this._ventSlots.push({ world, normal, strength: r.venting, gap: Math.abs(r.entry.d - distance) });
    }
    this._ventSlots.sort((a, b) => a.gap - b.gap);
    this.ventFlow.bind(this._ventSlots);

    // Alarm beacons: two red lights sweep with the nearest beacons.
    const beacons = this.live.filter((r) => r.isBeacon && r.entry.d > distance - 6 && r.entry.d < distance + 40);
    this.alarmLights.forEach((light, i) => {
      const b = beacons[i];
      if (!b) { light.intensity = 0; return; }
      light.position.set(b.entry.x ?? 0, b.root.position.y - 0.4, -b.entry.d);
      light.intensity = (9 + this.state.alarm * 20) * (0.5 + 0.5 * Math.sin(time * 6 + i * 1.7));
    });
    this.state.alarm = Math.max(0, this.state.alarm - dt * 2.2);
    this._dt = dt;

    this._flash = Math.max(0, this._flash - dt * 40);
    this.flashLight.intensity = this._flash * 1.4;
  }

  _updateEffects(dt) {
    for (let i = this.debris.length - 1; i >= 0; i -= 1) {
      const d = this.debris[i];
      d.age += dt;
      d.mesh.material.uniforms.uAge.value = d.age;
      if (d.age >= d.life) this._removeDebris(i);
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const r = this.rings[i];
      r.age += dt;
      const k = r.age / 0.7;
      r.ring.scale.setScalar(0.5 + k * r.radius);
      r.ring.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        r.ring.parent?.remove(r.ring);
        r.ring.material.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  _updateTower(dt) {
    const t = (this._towerFall.t += dt);
    if (t > 9) { this.tower.visible = false; this._towerFall = null; return; }
    if (t < 0.4 && !this._towerFall.boom) {
      this._towerFall.boom = true;
      const p = this.tower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 150, 0));
      this._burst("fireball", p, { scale: 26000, count: 90 });
      this._burst("dust", p, { scale: 30000, count: 60, speed: 14, life: 6 });
      this.state.flash = Math.max(this.state.flash, 0.35);
    }
    const drop = Math.max(0, t - 0.6);
    this.tower.position.y = -120 - drop * drop * 3.2;
    this.tower.rotation.z = drop * drop * 0.012;
    this.tower.rotation.x = drop * 0.02;
    if (Math.random() < dt * 3) {
      const p = this.tower.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 60 + Math.random() * 80, 0));
      this._burst("dust", p, { scale: 22000, count: 30, speed: 10, life: 5 });
    }
  }

  _updateFinale(dt, distance, playing) {
    const finale = this.state.finale;
    if (!this.gate) return;
    const slab = this.gate.parts.slab;
    if (finale.open && finale.opening < 1) {
      finale.opening = Math.min(1, finale.opening + dt / 1.1);
      slab.position.y = finale.opening * 6.4;
      if (finale.opening >= 1) this.gate.parts.collider.userData.disabled = true;
    }
    if (!playing) return;
    if (!finale.open && distance >= ROUTE.stopLine - 0.5) {
      if (!finale.sealed) {
        finale.sealed = true;
        finale.sealedTime = 7;
        this.events.emit("gate-sealed", { seconds: finale.sealedTime });
      }
      finale.sealedTime -= dt;
      if (Math.random() < dt * 4) {
        this._burst("dust", new THREE.Vector3((Math.random() - 0.5) * 10, 9, this.worldZ(distance - 6 - Math.random() * 20)), { count: 40, gravity: 6, scale: 900 });
      }
      if (finale.sealedTime <= 0) {
        finale.sealedTime = 0;
        this.events.emit("crushed", {});
      }
    }
    if (this.lift && !this.state.lift.entered && this.isPlayerInsideLift(this._player)) {
      this.state.lift.entered = true;
      this.events.emit("lift-enter", {});
    }
  }

  /** The finale lift's actual cabin volume, excluding its landing and shaft. */
  isPlayerInsideLift(point) {
    if (!this.lift?.root || !point) return false;
    this.lift.root.updateMatrixWorld(true);
    this._v2.copy(point);
    this.lift.root.worldToLocal(this._v2);
    const radial = Math.hypot(this._v2.x, this._v2.z);
    return radial <= 4.15
      && this._v2.z <= 4.05
      && this._v2.y >= -0.35
      && this._v2.y <= 5.65;
  }

  /**
   * Random tremors: the building is failing. Each one shakes the camera
   * (host), shakes dust out of the ceiling, and browns out the lights. They
   * come more often as the run goes on and during the bridge collapse.
   */
  _updateTremor(dt, distance, playing) {
    const tr = this.state.tremor;
    if (tr.duration > 0) {
      tr.t += dt;
      tr.level = tr.strength * Math.sin(Math.PI * Math.min(1, tr.t / tr.duration));
      if (tr.t >= tr.duration) { tr.duration = 0; tr.level = 0; }
    }
    if (!playing) return;
    tr.next -= dt;
    if (tr.next > 0) return;
    const progress = this.mode === "endless" ? Math.min(1, distance / 1500) : THREE.MathUtils.clamp(distance / ROUTE.length, 0, 1);
    tr.strength = 0.35 + progress * 0.45 + Math.random() * 0.25;
    tr.duration = 1.3 + Math.random() * 1.2;
    tr.t = 0;
    tr.next = THREE.MathUtils.lerp(13, 6, progress) * (this.state.chase.active ? 0.6 : 1) + Math.random() * 4;
    const ceiling = ceilingAt(distance, this.mode);
    for (let i = 0; i < 4; i += 1) {
      const p = new THREE.Vector3((Math.random() - 0.5) * 9, ceiling - 0.2, this.worldZ(distance + 4 + Math.random() * 26));
      this._burst("dust", p, { count: 40, gravity: 5, rise: 0, speed: 0.8, scale: 480, life: 2.4 });
    }
    if (Math.random() < 0.5) this._burst("sparks", new THREE.Vector3((Math.random() - 0.5) * 6, ceiling - 0.2, this.worldZ(distance + 8 + Math.random() * 10)), { count: 40 });
    this.events.emit("tremor", { strength: tr.strength, duration: tr.duration });
  }

  /** How much sprinkler water is falling on the player, 0..1 (lens droplets). */
  wetExposure(player) {
    let wet = 0;
    for (const h of this._heads ?? []) {
      const dx = h.world.x - player.x;
      const dz = h.world.z - player.z;
      wet = Math.max(wet, h.flow * THREE.MathUtils.clamp(1 - Math.hypot(dx, dz) / 4.5, 0, 1));
    }
    return wet;
  }

  /** Nearest live Level 1 fire and sprinkler for the shared audio mixer. */
  audioEnvironment(player) {
    let fire = null;
    for (const rec of this.live) {
      if (rec.kind !== "fire" || rec.decor || rec.intensity <= 0.02) continue;
      const distance = Math.hypot(rec.world.x - player.x, rec.world.z - player.z);
      if (!fire || distance < fire.distance) fire = { distance, offsetX: rec.world.x - player.x, intensity: rec.intensity };
    }
    let water = null;
    for (const head of this._heads ?? []) {
      if (head.flow <= 0.01) continue;
      const distance = Math.hypot(head.world.x - player.x, head.world.z - player.z);
      if (!water || distance < water.distance) water = { distance, offsetX: head.world.x - player.x, flow: head.flow };
    }
    return { fire, water };
  }

  /** Jump the wake-up cinematic to its last moment. */
  skipIntro() {
    const intro = this.state.intro;
    intro.t = Math.max(intro.t, 2.2);
  }

  /**
   * Furthest distance the player may run to right now. The gate holds the
   * player at the stop line until the locks are broken; the lift holds them
   * at its centre.
   */
  get stopDistance() {
    if (this.mode === "endless") return Infinity;
    if (!this.state.finale.open) return ROUTE.stopLine;
    return ROUTE.lift;
  }

  /* ================================================================ */
  /* Cinematics                                                        */
  /* ================================================================ */

  /** Title-screen drift through the ward. */
  menuCamera(time, camera, reduced = false) {
    const sway = reduced ? 0.3 : 1;
    const d = 22 + Math.sin(time * 0.06) * 14 * sway;
    camera.position.set(Math.sin(time * 0.11) * 2.8 * sway, 2.3 + Math.sin(time * 0.17) * 0.3 * sway, this.worldZ(d));
    camera.lookAt(Math.sin(time * 0.11) * 1.1 * sway, 1.9, this.worldZ(d + 16));
    return d;
  }

  /**
   * The wake-up: orbit the pod, shatter it, drop into first person.
   * @returns {boolean} true when finished
   */
  updateIntro(dt, camera, fpPosition, reduced = false) {
    const intro = this.state.intro;
    intro.t += dt;
    const t = intro.t;
    const podZ = this.worldZ(-0.5);
    const breakAt = 0.6;
    if (!intro.podBroken && t > breakAt && this.pod) {
      intro.podBroken = true;
      this.pod.parts.glass.visible = false;
      const c = new THREE.Vector3(0, 1.7, podZ);
      this._chunks(c, 60, { tint: 0xd8f7ff, speed: 6, radius: 1.3, size: 0.16 });
      this._burst("steam", c, { count: 90, scale: 1100 });
      this._flashAt(c, 0xcff8ff, 12);
      this.impact(1.2);
      this.events.emit("pod-break", {});
    }
    // Short by design: a glimpse of the pod shattering, then straight into
    // the eyes. Any key or click skips it (skipIntro).
    const orbitEnd = 0.9;
    const total = reduced ? 1.6 : 2.5;
    const a = 0.9 + Math.min(t, orbitEnd) * 0.35;
    const orbit = this._v.set(Math.sin(a) * 4.2, 2.4, podZ + Math.cos(a) * 4.2);
    if (t < orbitEnd) {
      camera.position.copy(orbit);
      camera.lookAt(0, 1.5, podZ);
    } else {
      const k = THREE.MathUtils.smoothstep((t - orbitEnd) / (total - orbitEnd), 0, 1);
      camera.position.lerpVectors(orbit, fpPosition, k);
      const look = this._v2.set(0, 1.5, podZ).lerp(new THREE.Vector3(fpPosition.x, 1.7, fpPosition.z - 12), k);
      camera.lookAt(look);
    }
    return t >= total;
  }

  /** Level preview flythrough. Returns the distance being shown. */
  previewCamera(t, camera) {
    const d = Math.min(t * 24, ROUTE.length - 30);
    camera.position.set(Math.sin(t * 0.4) * 1.2, 3.1, this.worldZ(d - 4));
    camera.lookAt(0, 1.6, this.worldZ(d + 20));
    return d;
  }

  /**
   * The Calibration Lift ride. Call every frame while the lift runs.
   * @returns {{done:boolean, cabinY:number, t:number}}
   */
  updateLift(dt, camera, fpPosition, reduced = false) {
    const lift = this.state.lift;
    lift.t += dt;
    const t = lift.t;
    const parts = this.lift?.parts;
    if (!parts) return { done: true, cabinY: 0, t };
    lift.active = true;
    this.spiral.visible = true;
    this.spiral.material.uniforms.uTime.value = t;
    this.spiral.material.uniforms.uStrength.value = THREE.MathUtils.clamp((t - 0.8) * 0.8, 0, 1);
    parts.conduitMaterial.uniforms.uCharge.value = Math.min(1, t / 2);

    for (const door of parts.doors) {
      const k = THREE.MathUtils.smoothstep(t, 0.1, 1.0);
      door.position.x = THREE.MathUtils.lerp(door.userData.openX, door.userData.closedX, k);
    }
    // Rise: accelerate to 11 m/s.
    const rideT = Math.max(0, t - 1.0);
    lift.velocity = Math.min(11, rideT * 4.5);
    lift.cabinY += lift.velocity * dt;
    parts.cabin.position.y = lift.cabinY;

    if (!lift.blasted && t > 2.4) {
      lift.blasted = true;
      this._explode(ROUTE.lift - 34, 1.6);
      this._explode(ROUTE.lift - 70, 1.2);
      this.events.emit("radio", { who: RADIO.vale, speaker: "vale", text: "The atrium's gone. There's no way down, Seven - and nobody is coming for you." });
    }

    const liftCentre = this._v.set(0, lift.cabinY + 1.6, this.worldZ(ROUTE.lift));
    if (t < 1.3) {
      const k = THREE.MathUtils.smoothstep(t / 1.3, 0, 1);
      const behind = this._v2.set(2.2, lift.cabinY + 3.2, liftCentre.z + 3.4);
      camera.position.lerpVectors(fpPosition, behind, k);
      camera.lookAt(0, lift.cabinY + 1.2, liftCentre.z - 1);
    } else {
      const orbit = (t - 1.3) * (reduced ? 0.18 : 0.42) + 0.6;
      const radius = 13 + (t - 1.3) * 1.2;
      const height = lift.cabinY + 3 - Math.min(10, (t - 1.3) * 2.2);
      camera.position.set(Math.sin(orbit) * radius, height, liftCentre.z + Math.cos(orbit) * radius);
      camera.lookAt(0, lift.cabinY + 1.5 - Math.min(6, (t - 3) * 1.6), liftCentre.z);
    }
    lift.cabinWorldY = lift.cabinY;
    return { done: t >= (reduced ? 6.2 : 7.4), cabinY: lift.cabinY, t };
  }

  /* ================================================================ */
  /* Lifecycle                                                         */
  /* ================================================================ */

  addTo(scene) {
    scene.add(this.root);
    return this;
  }

  /** Render one reflection-probe face. Called by the host after its render. */
  renderProbe(renderer, scene) {
    if (!this.root.visible) return;
    this.probe.update(renderer, scene);
  }

  /** Summary numbers for HUD, missions, and the lift report. */
  summary() {
    return { ...this.stats, files: [...this.stats.files] };
  }

  dispose() {
    for (const rec of this.live) this._despawn(rec);
    this.live.length = 0;
    while (this.debris.length) this._removeDebris(0);
    for (const r of this.rings) { r.ring.parent?.remove(r.ring); r.ring.material.dispose(); }
    this.rings.length = 0;
    this.embers.dispose();
    this.water.dispose();
    this.smoke.dispose();
    this.soot.dispose();
    this.ventFlow.dispose();
    this.spiral.geometry.dispose();
    this.spiral.material.dispose();
    this._ringGeometry.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.skyline.geometry.dispose();
    this.skyline.material.dispose();
    this.shell.dispose();
    this.probe.dispose();
    this.sun.shadow.map?.dispose();
    this.kit.dispose();
    this.root.parent?.remove(this.root);
    this.breakables.length = 0;
    this.solids.length = 0;
    this.events.clear();
  }
}

export default CausewayLevel;
