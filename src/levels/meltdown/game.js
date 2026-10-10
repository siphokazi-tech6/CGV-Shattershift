/**
 * Level 3 - The Meltdown, as one self-contained game module.
 *
 * Everything the level needs around MeltdownLevel (Phase A) and RoofLevel
 * (Phase B): its own scene, camera and post-processing, the player's body and
 * launcher, the runner's movement rules, four camera rigs, vitality, balls,
 * overheat and power-ups, the launcher's light, the HUD, the audio, the lift
 * cutscenes and the hand-over to the roof. A host only has to give it a
 * renderer, forward input, and call `update` and `render` each frame:
 *
 *   const game = new MeltdownGame({ renderer, assetBase });
 *   game.events.on("complete", (result) => ...);   // escaped the roof
 *   game.events.on("failed", (result) => ...);     // died / left behind
 *   await game.load();                              // build + stream models
 *   game.show();
 *   game.begin();                                   // the lift doors open
 *   // each frame:  game.update(dt, time); game.render();
 *   // input:       game.onKeyDown(e) / onKeyUp(e) / onPointerMove(x, y) /
 *   //              onPointerDown(e) / onPointerUp(e)
 *
 * main.js runs it twice in the story - the Labs (Phase A, sector 2, mode
 * "corridor": it stops after the lift at the end) and the Roof (the finale,
 * `enterRoof()`) - and for two endless modes ("endless-labs": lap after lap
 * of reshuffled corridor, faster each time; "endless-roof": survive the
 * waves). preview/meltdown.html runs the whole thing on its own (mode
 * "full", with the dev keys R and P and its own end-of-run card).
 *
 * Events: "complete" / "failed" (the run is over), "corridor-complete"
 * (mode "corridor": through the lift at the end of the Labs), "lap"
 * (endless Labs), "phase".
 *
 * Phases:
 *   idle        built, waiting for begin()
 *   arrive      the lift at the start: doors open, the player runs out
 *   run         Phase A - the escape
 *   depart      into the lift at the end, doors close, fade to black
 *   fade        black while the roof is built
 *   roofArrive  the roof's lift doors open, the player walks out
 *   roof        Phase B - the fight
 *   ending      a roof ending cutscene (climb, or the leap for the ladder)
 *   over        finished - "complete" or "failed" has been emitted
 */

import * as THREE from "../../three.js";
import { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment } from "../../three-addons.js";
import { MeltdownLevel, BEATS, LANES } from "./index.js";
import { THERMAL_HEAT } from "./kit.js";
import { Projectiles, Debris } from "./effects.js";
import { loadMeltdownAssets, MELTDOWN_ASSETS } from "./assets.js";
import { PlayerAvatar } from "./player.js";
import { LauncherLight } from "./flashlight.js";
import { createGradePass } from "./post.js";
import { createEnvironmentDimmer } from "./lighting.js";
import { RoofLevel, ROOF_SPAWN, CANISTER_RADIUS } from "./roof.js";
import { createCreditsPanel } from "./credits.js";
import { MeltdownHud } from "../../ui/meltdown-hud.js";
import { MeltdownAudio } from "../../audio/meltdown-audio.js";
import { Level1Audio } from "../../audio/level1-audio.js";
import { ShatterFX } from "../../fx/shatter.js";
import { SphereImpactFX } from "../../fx/sphere-impact.js";
import { CollectibleSet } from "../../systems/collectibles.js";
import { LabsDirector } from "../../story/labs-director.js";
import { AOPass } from "./ao.js";
import { latchReaction } from "../../story/reaction.js";
import { EndingDirector } from "../../story/ending-director.js";
import { SCENES as STORY_LINES } from "../../story/script.js";
import { Arsenal, BALLS, SERUMS } from "../../systems/arsenal.js";
import { PoliceHelicopters } from "../../fx/police-helicopters.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                               */
/* ------------------------------------------------------------------ */

export const START_VITALITY = 100;
export const START_BALLS = 26;
const MAX_BALLS = 45;
const HIT_VITALITY = 14;
const HIT_FIRE_BURST = 6;
const HIT_BALL_DROP_RATIO = 0.25;
const FIRE_INTERVAL = 0.2; // held trigger: five shots a second
/**
 * The level's old power-up vials hold the Skyline's serums now (one rule set
 * for every level): which serum each kind of vial gives.
 */
const VIAL_SERUM = { coolant: "thermal", adrenaline: "overdrive", overcharge: "prism", barrier: "shield" };

/*
 * Movement feel. Lane changes are a critically damped spring rather than a
 * lerp: they start fast, never overshoot, and a second tap mid-change
 * carries the momentum on instead of restarting the curve. Jumps rise under
 * normal gravity and fall under heavier gravity (snappier, same apex, same
 * collider-proven 1.5 m clearance). Inputs are buffered so a jump pressed a
 * moment before landing still happens, and a slide pressed in the air
 * slams you down into it - the two things that make a runner feel like it
 * listens.
 */
const LANE_OMEGA = 15.5;
const JUMP_VELOCITY = 7.6;
const RISE_GRAVITY = 19;
const FALL_GRAVITY = 27;
const SLAM_VELOCITY = -16;
const INPUT_BUFFER = 0.16;
const SLIDE_SECONDS = 0.7;

/*
 * Phase B. On the roof the player moves freely: WASD relative to the camera
 * (which looks north, toward the helipad), the mouse aims, Space dodges -
 * a quick sidestep with a moment of invulnerability, which is also how you
 * make a charging patient miss and carry on over the ledge.
 */
const ROOF_SPEED = 6.4;
const DODGE_SPEED = 13;
const DODGE_SECONDS = 0.24;
const ROOF_NAMES = [
  "scientistRadioman", "scientistRust", "patient", "helicopter", "gadgetBrass", "gadgetCoil", "ventFan", "utilityBox", "alarmLight", "duffelBag",
];
/** Endless roof: a supply drop of spheres every this many seconds survived. */
const SUPPLY_SECONDS = 30;
const SUPPLY_SPHERES = 5;
/** The roof player's fall: gravity, and how far down before it's over. */
const ROOF_GRAVITY = 24;
const ROOF_FALL_LIMIT = -8;

/** The playable characters: asset key -> label. The first is the default. */
export const CHARACTERS = { playerFemale: "Female", playerMale: "Male" };
export const DEFAULT_CHARACTER = "playerFemale";
const CHARACTER_KEY = "meltdown.character";

/** The saved character choice (shared by the game's start screen and the preview). */
export function savedCharacter() {
  try {
    const saved = localStorage.getItem(CHARACTER_KEY);
    if (saved && CHARACTERS[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_CHARACTER;
}

export function saveCharacter(name) {
  if (!CHARACTERS[name]) return;
  try {
    localStorage.setItem(CHARACTER_KEY, name);
  } catch {
    /* ignore */
  }
}

const CAMERA_MODES = ["CHASE", "FIRST PERSON", "CINEMATIC", "ORBIT"];
const FOG_CALM = new THREE.Color(0x1a120d);
const FOG_DANGER = new THREE.Color(0x2a0804);
// In the dark beat the fog is smoke with nothing lighting it.
const FOG_DARK = new THREE.Color(0x050404);
const FOG_ROOF = new THREE.Color(0x151a24);
const BASE_FOV = 72;
const BASE_EXPOSURE = 0.95;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * One step of a critically damped spring, solved exactly rather than
 * integrated: stable at any frame rate. (Plain Euler on a spring this stiff
 * overshoots and oscillates once a frame takes 40-50 ms, which on lab
 * hardware it sometimes will.) Returns [position, velocity].
 */
function spring(x, v, target, omega, dt) {
  const offset = x - target;
  const e = Math.exp(-omega * dt);
  const k = v + omega * offset;
  return [target + (offset + k * dt) * e, (v - omega * k * dt) * e];
}

function createEmitter() {
  const handlers = new Map();
  return {
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name)?.delete(fn);
    },
    emit(name, payload) {
      for (const fn of handlers.get(name) ?? []) fn(payload);
    },
    clear() {
      handlers.clear();
    },
  };
}

const _panV = new THREE.Vector3();
const _panR = new THREE.Vector3();

/** Stand-in for MeltdownAudio when the host wants the level silent. */
const SILENT_AUDIO = new Proxy({}, { get: (_, key) => (key === "ready" ? false : () => {}) });

export class MeltdownGame {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {string} o.assetBase     URL of assets/meltdown/
   * @param {string} [o.character]   CHARACTERS key
   * @param {boolean} [o.audio]      false = silent
   * @param {boolean} [o.reducedMotion]
   * @param {boolean} [o.devKeys]    R restarts, P skips to the roof, F dev stats
   * @param {boolean} [o.summary]    show the level's own end-of-run card
   */
  constructor({ renderer, assetBase, character = savedCharacter(), audio = true, sfx = null, reducedMotion = false, devKeys = false, summary = false, mode = "full", container = document.body, arsenal = null }) {
    /**
     * The sphere types and serums (src/systems/arsenal.js) - the host's, so
     * the type you picked and the serums running carry between levels; the
     * preview makes its own (and ticks it itself).
     */
    this.arsenal = arsenal ?? new Arsenal();
    /** Sharing the game's arsenal means the game's HUD shows the serums. */
    this.arsenalShared = !!arsenal;
    this._ownArsenal = !arsenal;
    /** "full" | "corridor" | "endless-labs" | "endless-roof" - see the header. */
    this.mode = mode;
    this.endless = { laps: 0, distance: 0 };
    this.speedScale = 1;
    this.renderer = renderer;
    this.assetBase = assetBase;
    this.character = CHARACTERS[character] ? character : DEFAULT_CHARACTER;
    this.reducedMotion = reducedMotion;
    this.options = { devKeys, summary };
    this.events = createEmitter();

    /* ---- Scene, camera, post ---- */
    const scene = new THREE.Scene();
    scene.name = "MeltdownScene";
    scene.background = FOG_CALM.clone();
    scene.fog = new THREE.FogExp2(FOG_CALM.clone(), 0.012);
    // A pre-filtered environment for reflections. Without one, every metallic
    // PBR surface - steel walls, the imported props, the launcher - renders
    // close to black, because metal only shows what it reflects.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    scene.environment = this.envTexture;
    pmrem.dispose();
    this.scene = scene;

    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, size.x / size.y, 0.05, 320);
    scene.add(this.camera);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Bloom sells fire, lasers and emissive glass; at half resolution,
    // because a full-res bloom chain would double the fill-rate cost. The
    // grading pass (heat haze, hit split, vignette, grain) runs last.
    // The first target carries a depth texture, for the ambient occlusion
    // pass at High quality (ao.js); otherwise it costs nothing extra.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y) });
    this.composer = new EffectComposer(renderer, target);
    // The composer's second target is a clone, and a cloned depth texture
    // shares the first one's GPU texture - sampling it while drawing into the
    // other would be a feedback loop. Each gets its own.
    this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.ao = new AOPass(this.camera);
    this.ao.enabled = false;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = createGradePass();
    this.grade.uniforms.uResolution.value.set(size.x, size.y);
    this.composer.addPass(this.grade);

    /* ---- HUD, audio, effects ---- */
    this.hud = new MeltdownHud({ container, dev: false, reducedMotion });
    this.audio = audio ? new MeltdownAudio({ volume: 0.8 }) : SILENT_AUDIO;
    this.projectiles = new Projectiles(scene);
    this.debris = new Debris(scene);
    // Level 1's glass physics (GPU shards: radial fracture, spin, one floor
    // bounce) and its sampled sound effects, on top of this level's own.
    // The host (main.js) passes its Level1Audio; standalone, the level makes
    // one on its own audio context.
    this.shatter = new ShatterFX(scene, { floorHalfWidth: 1e4, env: [0x3a4548, 0x0d0b0a, 0x4a3326] });
    // A cryo or shock sphere going off: its colour pulsing out, as in the Skyline.
    this.sphereImpact = new SphereImpactFX(scene);
    this._ownSfx = !sfx && !!audio;
    this.sfx = sfx ?? (audio ? new Level1Audio(() => this.audio.ctx) : null);
    // The recorded fire (the Skyline's) carries the fire's sound; the
    // synthesized roar and crackle step aside.
    this.audio.useSamples = !!this.sfx;
    this.beam = new LauncherLight(scene);
    this.environment = createEnvironmentDimmer(scene);
    // A key light over the player that casts real shadows - High quality
    // only (setQuality). Off (invisible) otherwise, so it costs nothing
    // below High; switching it recompiles the materials once.
    this.keyLight = new THREE.DirectionalLight(0xffe2c4, 0.85);
    this.keyLight.visible = false;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.03;
    const sc = this.keyLight.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 50;
    scene.add(this.keyLight, this.keyLight.target);
    this.quality = { shadows: false, ao: false };
    this.credits = createCreditsPanel(container);

    const el = (className) => {
      const node = document.createElement("div");
      node.className = className;
      node.hidden = true;
      container.append(node);
      return node;
    };
    this.ui = { reticle: el("mlt-reticle"), fade: el("mlt-fade"), letterbox: el("mlt-letterbox") };
    this.ui.fade.hidden = false;
    this.ui.letterbox.hidden = false;
    this.fade = { value: 0, target: 0, rate: 1.6, override: null };

    /* ---- Player ---- */
    this.avatar = new PlayerAvatar();
    scene.add(this.avatar.root);
    this.launcher = { rig: new THREE.Group(), muzzle: new THREE.Object3D(), model: null, heatMaterials: [], recoil: 0 };
    this.launcher.rig.add(this.launcher.muzzle);
    // Stand-in until the model loads: a simple tube.
    this.launcherStandIn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0x3d4a3a, metalness: 0.6, roughness: 0.5 }));
    this.launcherStandIn.rotation.x = Math.PI / 2;
    this.launcher.rig.add(this.launcherStandIn);
    this.launcher.muzzle.position.set(0, 0.02, -0.66);

    this.runner = {};
    this._resetRunner();
    this.hero = {
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), knock: new THREE.Vector3(),
      dodge: 0, dodgeCooldown: 0, dodgeDir: new THREE.Vector3(), yaw: 0, lastShot: 99, aim: new THREE.Vector3(),
    };
    this.held = new Set();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.15);

    /* ---- State ---- */
    this.phase = "idle";
    this.level = null;
    this.roof = null;
    this.roofAssets = null;
    this.roofAssetsPromise = null;
    /** Dev/test overrides for the roof, e.g. { heliSeconds: 10 }. */
    this.roofOptions = {};
    this.assetsReady = false;
    this.visible = false;
    this.paused = false;
    this.cameraMode = 0;
    this.trauma = 0;
    this.hitFlash = 0;
    this.warp = { active: false, t: 0 };
    this.snapCamera = true;
    this.landingDip = 0;
    this.cameraRoll = 0;
    this.clock = 0;
    this.roofClock = 0;
    this._timers = [];
    this.cut = null;
    /**
     * The story (src/story/labs-director.js), when the host runs the Labs as
     * part of a story run: { layer, okoroTemplate, valeTemplate, assetBase }.
     * Null everywhere else - the preview, Endless - and the Labs play as before.
     */
    this.story = null;
    this.director = null;

    this._v = {
      desired: new THREE.Vector3(), look: new THREE.Vector3(), smoothedLook: new THREE.Vector3(),
      behind: new THREE.Vector3(), camVelocity: new THREE.Vector3(), warpUp: new THREE.Vector3(),
      aim: new THREE.Vector3(), muzzle: new THREE.Vector3(), fireDir: new THREE.Vector3(), forwardVel: new THREE.Vector3(),
      laneRight: new THREE.Vector3(), beamTarget: new THREE.Vector3(),
      boxCentre: new THREE.Vector3(), boxSize: new THREE.Vector3(),
      floor: new THREE.Vector3(), crash: new THREE.Vector3(), sfxPos: new THREE.Vector3(),
    };
    this.playerBox = new THREE.Box3();
  }

  /* ================================================================ */
  /* Lifecycle                                                         */
  /* ================================================================ */

  _resetRunner() {
    // A new run (or lap): no checkpoint reached yet.
    this.checkpoint = null;
    Object.assign(this.runner, {
      distance: 0, lane: 1, lateral: 0, lateralVel: 0, height: 0, verticalVelocity: 0, sliding: 0,
      jumpBuffer: 0, slideBuffer: 0, landed: 0,
      vitality: START_VITALITY, balls: START_BALLS, alive: true, invulnerable: 0, slow: 0,
      finished: false, heat: 0, lockout: 0, weakened: 0, coolant: 0, adrenaline: 0,
      overchargeShots: 0, barrierShield: 0, fireDistance: -45, lookBack: 0, pushing: false,
      firing: false, fireCooldown: 0, hits: 0, shots: 0, breaks: 0, downs: 0, speed: 0,
      baseSpeed: this.level ? this.level.speedAt(0) : 8.2,
    });
  }

  /** Start fetching every model now (cached); the level can be built later. */
  preload() {
    const names = [...Object.keys(MELTDOWN_ASSETS), this.character];
    this._preload ??= loadMeltdownAssets(this.assetBase, { names }).catch(() => null);
    return this._preload;
  }

  /**
   * Roof models load in the background while Phase A is being played - from
   * begin(), not before, so they never compete with the Labs being built
   * behind the lift ride's black screen.
   */
  loadRoofAssets() {
    this.roofAssetsPromise ??= loadMeltdownAssets(this.assetBase, { names: ROOF_NAMES }).then((map) => (this.roofAssets = map));
    return this.roofAssetsPromise;
  }

  /**
   * Build Phase A (tearing down any previous attempt), park the player in
   * the arrival lift and stream the models in. Resolves once they are in
   * and every shader is compiled. The level is usable before that, with
   * stand-ins.
   */
  /** Switch between story and endless use (before load / enterRoof). */
  setMode(mode) {
    this.mode = mode;
    this.endless = { laps: 0, distance: 0 };
    this.speedScale = 1;
  }

  /** The story's cutscenes for the next load() (mode "corridor" only), or null. */
  setStory(story) {
    this.story = story;
  }

  async load({ balls = START_BALLS, vitality = START_VITALITY, seed = 0, carry = false } = {}) {
    document.body.classList.remove("finale-film");
    this.shatter.clear();
    this.sphereImpact.clear();
    this.sfx?.startLevel();
    if (this.police) this.police.root.visible = false;
    if (this.level) {
      this.hud.unbind();
      this.level.dispose();
    }
    if (this.roof) {
      this.roof.dispose();
      this.roof = null;
    }
    this._timers.length = 0;
    this.phase = "idle";
    // The alarm comes back with a fresh run (the blackout silenced it).
    this._alarmOff = false;
    this._moanIn = undefined;
    this.cut = null;
    this.fade.value = this.fade.target = 0;
    this.fade.override = null;
    this.ui.letterbox.classList.remove("on");
    this.hud.vitals.style.visibility = "";
    this.avatar.hold = 1;
    this.avatar.reachUp = 0;
    this.audio.setRotor(0);
    this.avatar.setVisible(true);
    this.avatar.shadow.visible = true;
    this.scene.fog.density = 0.012;
    this.projectiles.clear();
    this.debris.clear();
    this.assetsReady = false;
    if (!carry) this.clock = 0;

    const level = new MeltdownLevel({ origin: new THREE.Vector3(0, 0, 0), seed });
    this.level = level;
    level.addTo(this.scene);
    // The patient records (src/systems/collectibles.js): five along the
    // outer lanes - not on an endless lap.
    this._setFiles(this.mode === "endless-labs" ? null : "labs", () => {
      const total = level.route.totalLength;
      return [[0.12, 3.4], [0.33, -3.4], [0.52, 3.4], [0.7, -3.4], [0.9, 3.4]].map(([k, x]) => level.route.sample(total * k, x).position.clone());
    });
    this.hud.bind(level);
    this.hud.hideSummary();
    this._bindLevelEvents(level);
    this.director?.dispose();
    this.director = this.story && this.mode === "corridor" ? new LabsDirector(this, this.story) : null;
    this.storyBag = false;

    // An endless lap carries the run's counters on.
    const kept = carry ? (({ shots, breaks, downs, hits }) => ({ shots, breaks, downs, hits }))(this.runner) : {};
    this._resetRunner();
    Object.assign(this.runner, { balls, vitality }, kept);
    this.trauma = 0;
    this.hitFlash = 0;
    this.warp = { active: false, t: 0 };
    this.snapCamera = true;
    this.hud.setVitality(this.runner.vitality);
    this.hud.setBalls(this.runner.balls);
    this.hud.setDanger(0);
    this.cut = level.beginArrival();
    this._applyCutscene(this.cut, 0);

    // Models stream in; the level is playable with stand-ins meanwhile.
    this.hud.setLoading(0);
    const [loaded] = await Promise.all([level.loadAssets(this.assetBase, { onProgress: (r) => this.hud.setLoading(r) }), this._loadCharacter(this.character)]);
    if (level !== this.level) return;
    this.hud.setLoading(null);
    this._mountLauncherModel(loaded);
    this._applyShadowFlags();
    // Compile and upload everything now rather than on first sight mid-run -
    // in the background, so this can run while the host shows something
    // else (the lift ride builds Level 3 on the way up).
    await level.prewarmAsync(this.renderer, this.camera);
    if (level !== this.level) return;
    this._logTextureMemory("the Labs");
    this.environment.refresh();
    this.assetsReady = true;
    await this.director?.onAssets();
  }

  /** The lift doors open and the run begins. */
  begin() {
    this.audio.start();
    if (this._ownSfx) this.sfx.unlock();
    if (this.phase === "idle" && this.level) this.phase = "arrive";
    // The Labs are on screen: now the photographed textures, and the roof's
    // models in the background.
    this.level?.kit.applyPhotos();
    if (this.level) this.loadRoofAssets();
  }

  /** Dev: start over (R in the preview). */
  async restart() {
    await this.load();
    this.begin();
  }

  show() {
    this.visible = true;
    document.body.classList.add("mlt-active");
    this.syncRenderer();
    this.hud.show();
    this.ui.reticle.hidden = false;
  }

  hide() {
    this.visible = false;
    document.body.classList.remove("mlt-active");
    this.hud.hide();
    this.ui.reticle.hidden = true;
    this.ui.letterbox.classList.remove("on");
    this.ui.fade.style.opacity = "0";
    this.credits.toggle(false);
    this.runner.firing = false;
    this.held.clear();
  }

  /** Where a point is heard from: -1 (left) .. 1 (right) of the camera, and how far. */
  _placeOf(position) {
    const cam = this.camera;
    _panV.copy(position).sub(cam.position);
    _panR.setFromMatrixColumn(cam.matrixWorld, 0);
    const distance = _panV.length();
    return { pan: THREE.MathUtils.clamp(_panV.dot(_panR) / Math.max(4, distance), -0.85, 0.85), distance };
  }

  /** One of the patients, heard where it is (the recorded set, or the synthesized growl). */
  _patientSound(kind, position = null, strength = 1) {
    if (!this.sfx) {
      if (kind === "growl" || kind === "shriek" || kind === "roar") this.audio.growl(strength);
      else if (kind !== "death") this.audio.groan(strength * 0.8);
      return;
    }
    const at = position ? this._placeOf(position) : { pan: 0, distance: 0 };
    this.sfx.patient(kind, { strength, ...at });
  }

  /** Pause or resume: freezes nothing by itself (the host stops calling update), but silences the level. */
  setPaused(paused) {
    this.paused = paused;
    this.runner.firing = false;
    this.held.clear();
    const ctx = this.audio === SILENT_AUDIO ? null : this.audio.ctx;
    if (ctx) {
      if (paused) ctx.suspend();
      else ctx.resume();
    }
    if (this._ownSfx) this.sfx.setPaused(paused);
  }

  /** Stop everything and free the level (the game object can be reused with load()). */
  unload() {
    this.hide();
    if (this.level) {
      this.hud.unbind();
      this.level.dispose();
      this.level = null;
    }
    this.roof?.dispose();
    this.roof = null;
    this.director?.dispose();
    this.director = null;
    this.finale?.dispose();
    this.finale = null;
    this.projectiles.clear();
    this.debris.clear();
    this.shatter.clear();
    this.sphereImpact.clear();
    this.sfx?.cleanupLevel();
    this.audio.stop();
    this.phase = "idle";
  }

  dispose() {
    this.unload();
    this.projectiles.dispose?.();
    this.shatter.dispose();
    this.sphereImpact.dispose();
    this.files?.dispose();
    this.beam.dispose?.();
    this.hud.dispose();
    this.credits.panel.remove();
    for (const node of Object.values(this.ui)) node.remove();
    this.composer.dispose?.();
    this.envTexture.dispose();
    this.events.clear();
  }

  /** After the host changes the renderer's pixel ratio or size. */
  syncRenderer() {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    const size = this.renderer.getSize(new THREE.Vector2());
    this.resize(size.x, size.y);
  }

  resize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width / 2, height / 2);
    this.grade.uniforms.uResolution.value.set(width, height);
  }

  setCharacter(name) {
    if (!CHARACTERS[name]) return;
    // The player's breath and voice follow the character (level1-audio.js).
    this.sfx?.setCharacter?.(name);
    this.character = name;
    saveCharacter(name);
    this._loadCharacter(name);
  }

  setReducedMotion(value) {
    this.reducedMotion = value;
    this.hud.setReducedMotion?.(value);
  }

  setBloom(on) {
    this.bloom.enabled = on;
  }

  /**
   * The graphics budget (main.js, from the quality setting): `shadows` - the
   * key light's shadow map; `ao` - screen-space ambient occlusion. Both only
   * at High: they are the most expensive things on screen.
   */
  setQuality({ shadows = false, ao = false } = {}) {
    this.quality = { shadows, ao };
    this.ao.enabled = ao;
    this.keyLight.visible = shadows;
    this.keyLight.castShadow = shadows;
    // Borrow the renderer's shadow map while High is on; give it back as it was.
    const sm = this.renderer.shadowMap;
    if (shadows && !this._hostShadowMap) {
      this._hostShadowMap = { enabled: sm.enabled, type: sm.type };
      sm.enabled = true;
      sm.type = THREE.PCFSoftShadowMap;
    } else if (!shadows && this._hostShadowMap) {
      sm.enabled = this._hostShadowMap.enabled;
      sm.type = this._hostShadowMap.type;
      this._hostShadowMap = null;
    }
    this._applyShadowFlags();
  }

  /** Who casts and who receives, for the current setting. */
  _applyShadowFlags() {
    const on = this.quality.shadows;
    const roots = [this.level?.groups.hazards, this.level?.groups.pickups, this.roof?.root].filter(Boolean);
    for (const root of roots) {
      root.traverse((o) => {
        if (o.isMesh && o.material?.isMeshStandardMaterial) o.castShadow = on;
      });
    }
    const receivers = [this.level?.root, this.roof?.root].filter(Boolean);
    for (const root of receivers) {
      root.traverse((o) => {
        if (o.isMesh && o.material?.isMeshStandardMaterial) o.receiveShadow = on;
      });
    }
    this.avatar.root.traverse((o) => {
      if (o.isMesh && o !== this.avatar.shadow) o.castShadow = on;
    });
  }

  /** Keep the key light (and its shadow box) over the player. */
  _placeKeyLight(at) {
    if (!this.quality.shadows) return;
    this.keyLight.position.set(at.x + 5, at.y + 13, at.z + 3);
    this.keyLight.target.position.copy(at);
  }

  get cameraModeName() {
    return CAMERA_MODES[this.cameraMode];
  }

  /** Where the player is, for a status line. */
  get locationName() {
    if (this.roof) return "THE ROOF";
    if (!this.level) return "";
    if (this.phase === "roof" || this.phase === "roofArrive" || this.phase === "ending" || (this.phase === "over" && this.roof)) return "THE ROOF";
    const d = this.runner.distance;
    return this.level.hallAt(d)?.name ?? this.level.beatAt(d).name;
  }

  /** Numbers for the host's end screen and score. */
  get stats() {
    const r = this.runner;
    return {
      time: this.clock,
      roofTime: this.roofClock,
      distance: r.distance,
      total: this.level?.route.totalLength ?? 0,
      shots: r.shots,
      breaks: r.breaks,
      downs: r.downs,
      hits: r.hits,
      falls: this.roof?.state.falls ?? 0,
      balls: r.balls,
      vitality: r.vitality,
      onRoof: Boolean(this.roof),
      ending: this.roof?.state.ending ?? null,
      laps: this.endless.laps,
      endlessDistance: this.endless.distance + r.distance,
    };
  }

  _after(seconds, fn) {
    this._timers.push({ at: this.clock + seconds, fn });
  }

  async _loadCharacter(name) {
    const loaded = await loadMeltdownAssets(this.assetBase, { names: [name] });
    const asset = loaded.get(name);
    if (asset && name === this.character) {
      this.avatar.setModel(asset.template);
      this._applyShadowFlags();
    }
  }

  /**
   * The textures a stage holds on the GPU, logged once it has loaded (the
   * graphics pass keeps an eye on the budget). Mipmapped RGBA, estimated.
   */
  _logTextureMemory(where) {
    const seen = new Set();
    let bytes = 0;
    this.scene.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) {
        for (const value of Object.values(m)) {
          if (!value?.isTexture || seen.has(value)) continue;
          seen.add(value);
          const img = value.image;
          const w = img?.width ?? 0;
          const h = img?.height ?? 0;
          bytes += w * h * 4 * (value.generateMipmaps ? 1.33 : 1);
        }
      }
    });
    this.textureMemory = { where, textures: seen.size, megabytes: +(bytes / 1048576).toFixed(1) };
    console.info(`[meltdown] ${where}: ~${this.textureMemory.megabytes} MB of textures (${seen.size})`);
  }

  _mountLauncherModel(assets) {
    const asset = assets.get("launcher");
    const launcher = this.launcher;
    if (!asset || launcher.model) return;
    const model = asset.template.clone(true);
    // The source model's long axis is X; turn it to point down -Z and scale
    // it to a ~1.25 m shoulder launcher.
    const length = Math.max(asset.size.x, asset.size.z);
    model.scale.setScalar(1.25 / length);
    model.rotation.y = Math.PI / 2;
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    // Heat glow: the launcher gets its own material copies.
    model.traverse((o) => {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0xff3a10);
        o.material.emissiveIntensity = 0;
        launcher.heatMaterials.push(o.material);
      }
    });
    this.launcherStandIn.visible = false;
    launcher.model = model;
    launcher.rig.add(model);
  }

  _bindLevelEvents(level) {
    const { hud, audio, debris } = this;
    const on = (name, fn) => level.events.on(name, (p) => level === this.level && fn(p));
    on("complete", () => {
      if (this.mode === "endless-labs") this._nextLap();
      // The story: the blocked lift, the desk, the sacrifice - not a run in.
      else if (this.phase === "run" && this.director?.onComplete()) this.events.emit("phase", { phase: "story" });
      else this._startDeparture();
    });
    on("timer-expired", () => {
      if (this.phase !== "run" || this.mode === "endless-labs") return;
      this.runner.vitality = 0;
      this._finishRun(false, "THE BUILDING WENT UP");
    });
    on("warp-start", () => {
      this.warp = { active: true, t: 0 };
      audio.warp();
    });
    on("warp-tick", ({ t }) => (this.warp.t = t));
    on("warp-end", () => (this.warp.active = false));
    on("hazard-land", ({ kind, position }) => {
      debris.burst(position, { kind: kind === "duct" ? "metal" : "concrete", count: 30, speed: 5 });
      debris.dust(position, { size: kind === "shelf" ? 6 : 5 });
      debris.sparks(position, { count: 16 });
      const near = Math.max(0, 1 - position.distanceTo(this.avatar.root.position) / 30);
      this.trauma = Math.min(1, this.trauma + near * 0.5);
      audio.crash(0.5 + near * 0.5);
      this.sfx?.debrisFall(0.4 + near * 0.6, this._placeOf(position).pan);
    });
    on("duct-cleared", () => audio.clang());
    // A patient lunging out at you: the growl as it goes for you.
    on("patient-lurch", ({ position }) => {
      const near = Math.max(0.3, 1 - position.distanceTo(this.avatar.root.position) / 30);
      this._patientSound(Math.random() < 0.5 ? "shriek" : "growl", position, 0.6 + near * 0.6);
    });
    // In the dark, the beam finds one standing there - and it says something.
    on("patient-seen", ({ position }) => {
      audio.stinger();
      this._patientSound("speech", position, 0.9);
    });
    on("beat", ({ key }) => {
      const beat = BEATS.find((b) => b.key === key);
      // Each section after the first is a checkpoint: die past here and you
      // start again here, not at the top of the Labs (Endless has no checkpoints).
      if (beat && beat.start > 0 && this.mode !== "endless-labs" && this.phase !== "over" && (this.checkpoint?.distance ?? 0) < beat.start) {
        this.checkpoint = { distance: beat.start + 3, balls: this.runner.balls, name: beat.name };
        hud.toast("CHECKPOINT", beat.name, "", 2400);
      }
      if (beat?.dark) {
        audio.powerDown();
        // The power dies, and the alarm with it. Vale has something to say.
        this._alarmOff = true;
        if (this.story?.layer && this.mode !== "endless-labs") this.story.layer.talk(STORY_LINES.valeBlackout[0]);
        this._after(0.9, () => {
          audio.beamOn();
          hud.showBanner("POWER FAILURE", "YOUR LAUNCHER HAS A LIGHT", 3200);
        });
      } else if (key === "stairwell") {
        audio.powerUp();
        this._alarmOff = false;
      }
    });
    // The lifts (placeholder cutscenes - see elevator.js).
    on("lift-arrived", () => {
      audio.crash(0.35);
      this.trauma = Math.min(1, this.trauma + 0.3);
    });
    on("lift-open", () => audio.whoosh());
    on("lift-exit", () => hud.showBanner(this.mode === "endless-labs" ? "ENDLESS" : "SECTOR 02", "THE LABS", 2600));
    on("lift-close", () => audio.clang());
    on("lift-depart", () => audio.powerUp());
  }

  /* ================================================================ */
  /* Input                                                             */
  /* ================================================================ */

  onPointerMove(clientX, clientY) {
    const size = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - size.left) / size.width) * 2 - 1;
    this.pointer.y = -((clientY - size.top) / size.height) * 2 + 1;
    this.ui.reticle.style.left = `${clientX}px`;
    this.ui.reticle.style.top = `${clientY}px`;
  }

  onPointerDown(event) {
    this.audio.start();
    if (event.button === 0) {
      this.runner.firing = true;
      this.runner.fireCooldown = 0;
    }
  }

  onPointerUp(event) {
    if (event.button === 0) this.runner.firing = false;
  }

  onBlur() {
    this.held.clear();
    this.runner.firing = false;
  }

  onKeyUp(event) {
    this.held.delete(event.code);
  }

  /** Returns true when the key was Level 3's (the host should not act on it too). */
  onKeyDown(event) {
    const code = event.code;
    this.held.add(code);
    this.audio.start();
    if (event.repeat && code !== "Space") return this._isGameKey(code);
    if (code === "KeyK") {
      this.credits.toggle();
      return true;
    }
    if (code === "KeyB") {
      this.bloom.enabled = !this.bloom.enabled;
      this.hud.toast("BLOOM", this.bloom.enabled ? "ON" : "OFF", "", 900);
      return true;
    }
    if (this.options.devKeys && code === "KeyR") {
      this.restart();
      return true;
    }
    if (this.options.devKeys && code === "KeyP" && (this.phase === "run" || this.phase === "arrive")) {
      this.startRoof();
      return true;
    }
    if (this.phase === "roof" || this.phase === "roofArrive" || this.phase === "ending") {
      // The roof: WASD is movement (read from `held` each frame); Space dodges.
      if (code === "Space" && this.phase === "roof") {
        event.preventDefault?.();
        const hero = this.hero;
        // At the ledge with the ladder in reach, Space is the jump for it -
        // in the story, a latch reaction (two keys, fast) decides the catch.
        if (this.story && this.roof?.canGrab(hero.position)) {
          this._startLadderLatch();
          return true;
        }
        if (this.roof?.grab(hero.position)) return true;
        if (hero.dodgeCooldown <= 0) {
          const dir = hero.velocity.lengthSq() > 0.5 ? hero.velocity.clone() : hero.aim.clone().sub(hero.position).setY(0);
          hero.dodgeDir.copy(dir.normalize());
          hero.dodge = DODGE_SECONDS;
          hero.dodgeCooldown = 0.75;
          this.runner.invulnerable = Math.max(this.runner.invulnerable, 0.32);
          this.audio.whoosh();
        }
      }
      return this._isGameKey(code);
    }
    if (this.phase !== "run") return this._isGameKey(code);
    const r = this.runner;
    if (code === "KeyA" || code === "ArrowLeft") r.lane = Math.max(0, r.lane - 1);
    if (code === "KeyD" || code === "ArrowRight") r.lane = Math.min(2, r.lane + 1);
    if (code === "Space" || code === "KeyW" || code === "ArrowUp") {
      event.preventDefault?.();
      this._jump();
    }
    if (code === "ShiftLeft" || code === "ShiftRight" || code === "KeyS" || code === "ArrowDown") r.slideBuffer = INPUT_BUFFER;
    if (code === "KeyC") this.cameraMode = (this.cameraMode + 1) % CAMERA_MODES.length;
    return this._isGameKey(code);
  }

  _isGameKey(code) {
    return /^(Key[WASDCBKF]|Arrow|Space|Shift)/.test(code);
  }

  _jump() {
    this.runner.jumpBuffer = INPUT_BUFFER;
  }

  /* ================================================================ */
  /* Frame                                                             */
  /* ================================================================ */

  render() {
    this.director?.beforeRender(this.renderer);
    // The host renders shadows on demand (autoUpdate is off in the game).
    if (this.quality.shadows) this.renderer.shadowMap.needsUpdate = true;
    this.composer.render();
  }

  update(dt, time) {
    dt = Math.min(dt, 0.05);
    if (!this.level && !this.roof) return;
    if (this.phase !== "idle" && this.phase !== "over") this.clock += dt;
    for (let i = this._timers.length - 1; i >= 0; i -= 1) {
      if (this.clock >= this._timers[i].at) this._timers.splice(i, 1)[0].fn();
    }
    this._updateFade(dt);
    const phase = this.phase;
    const onRoof = phase === "roof" || phase === "roofArrive" || phase === "ending" || phase === "latch" || phase === "finale" || (phase === "over" && this.roof) || (phase === "fade" && this.roof);
    const playing = onRoof ? phase === "roof" && this.runner.alive : phase === "run" && this.runner.alive && !this.runner.finished;
    // Thermal sight: patients show as heat (kit.js heatSignature). On the
    // roof a faint warm rim stays on regardless, so the enemies read against
    // the dark deck from the high camera.
    THERMAL_HEAT.value = Math.max(this.arsenal.level("thermal"), phase === "roof" ? 0.16 : 0);
    this._updateLauncher(dt, playing);

    if (onRoof) {
      this.runner.invulnerable = Math.max(0, this.runner.invulnerable - dt);
      if (this.roof) this._updateRoofFrame(dt, time);
      this._updateRoofPresentation(dt, time, playing);
      return;
    }
    if (phase === "fade") return;
    this._updateRunFrame(dt, time, playing);
  }

  _updateFade(dt) {
    const f = this.fade;
    if (f.override !== null) f.value = f.override;
    else if (f.value !== f.target) {
      const step = dt * f.rate;
      f.value = f.value < f.target ? Math.min(f.target, f.value + step) : Math.max(f.target, f.value - step);
    }
    this.ui.fade.style.opacity = f.value.toFixed(3);
  }

  _updateLauncher(dt, playing) {
    const r = this.runner;
    // Held trigger. (No heat: the Skyline's rules - the spheres are the limit.)
    this.launcher.recoil = Math.max(0, this.launcher.recoil - dt * 7);
    r.fireCooldown -= dt;
    if (playing && r.firing && r.fireCooldown <= 0) {
      this._shoot();
      r.fireCooldown = FIRE_INTERVAL;
    }
    // On its own (the preview) the level runs its own serums' clocks.
    if (this._ownArsenal && playing) this.arsenal.update(dt);
    r.lookBack = Math.max(0, r.lookBack - dt);
  }

  /* ---------------- Phase A ---------------- */

  _updateRunFrame(dt, time, playing) {
    const { level, runner: r, avatar, camera } = this;
    const V = this._v;
    // "story": one of the story's cutscenes (labs-director.js) has the
    // camera; the run is held - no movement, no clock, no fire.
    const story = this.phase === "story";
    const cutscene = this.phase === "idle" || this.phase === "arrive" || this.phase === "depart" || story;

    if (this.phase === "arrive") {
      this.cut = level.updateArrival(dt);
      this.director?.updateArrival(this.cut, dt);
      if (this.cut?.done) {
        this.cut = null;
        r.baseSpeed = level.speedAt(0);
        if (this.director?.afterArrival()) {
          this.phase = "story";
          this.events.emit("phase", { phase: "story" });
        } else {
          this.phase = "run";
          this.hud.toast("A / D LANES", "SPACE JUMP // SHIFT SLIDE", "", 3600);
          this._after(2.2, () => this.hud.toast("HOLD CLICK", "TO FIRE", "", 3000));
          this.events.emit("phase", { phase: "run" });
        }
      }
    } else if (story) {
      this.director?.updateScene(dt, time);
      // The scene handed back (the breach or the bend is over).
      if (this.director?.stage === "run") {
        this.phase = "run";
        this.snapCamera = true;
        this.events.emit("phase", { phase: "run" });
      }
    } else if (this.phase === "depart") {
      this.cut = level.updateDeparture(dt, this.reducedMotion);
      if (this.cut?.fire !== null && this.cut?.fire !== undefined) r.fireDistance = this.cut.fire;
      if (this.cut?.done) {
        if (this.mode === "corridor") this._corridorDone();
        else this.startRoof({ fromBlack: true });
      }
    }

    if (!cutscene) this._updateMovement(dt, playing);
    // The story during the run: Okoro alongside; the bend attack.
    if (this.phase === "run" && this.director?.updateRun(dt, time)) {
      this.phase = "story";
      this.events.emit("phase", { phase: "story" });
    }

    // The fire: vitality drains steadily, and the fire front's distance
    // behind you is that vitality made visible.
    // Overdrive (a serum) holds the fire off, as adrenaline used to.
    if (playing && !this.arsenal.isActive("overdrive")) {
      r.vitality = Math.max(0, r.vitality - level.drainRateAt(r.distance) * dt);
      if (r.vitality <= 0) {
        r.alive = false;
        this._finishRun(false, "CAUGHT BY THE FIRE");
      }
    }
    if (this.phase !== "depart") {
      const gap = 4 + r.vitality * 0.42;
      const target = r.distance - gap;
      if (!cutscene) r.fireDistance += (target - r.fireDistance) * Math.min(1, dt * (target > r.fireDistance ? 0.9 : 3));
    }
    level.setFireFront(r.fireDistance);

    const firstPerson = !cutscene && CAMERA_MODES[this.cameraMode] === "FIRST PERSON";
    if (this.phase === "story") {
      // The story's cutscenes are first person: the body stays out of the shot.
      avatar.setVisible(false);
      avatar.shadow.visible = false;
    } else if (cutscene && this.cut) {
      this._applyCutscene(this.cut, dt);
    } else {
      // The body.
      const placement = level.route.sample(r.distance, r.lateral, r.height);
      avatar.root.position.copy(placement.position);
      avatar.root.rotation.y = placement.heading;
      avatar.update(dt, {
        // Height above what's underfoot (a fallen duct's top is ground too).
        speed: r.speed, lateralVel: r.lateralVel, height: r.height - (r.ground ?? 0), sliding: r.sliding > 0,
        pushing: r.pushing, stumble: r.lookBack > 0.5 ? 1 : 0, aiming: r.firing,
      });
      // Blink through the mercy window after a hit (not the long
      // "invulnerable" a test or demo teleport sets).
      const blinking = r.invulnerable > 0 && r.invulnerable < 2 && Math.floor(time * 14) % 2 === 0;
      avatar.setVisible(!firstPerson && !blinking);
      avatar.shadow.visible = !firstPerson;
    }

    level.update({ dt, time, distance: r.distance, playerPosition: avatar.root.position, clock: this.phase === "run" && this.mode !== "endless-labs" });
    this._updateFiles(dt, time, playing ? avatar.root.position : null);
    this._placeKeyLight(avatar.root.position);
    if (playing) this._checkHazards(dt);
    if (!cutscene) this._updateCamera(dt, time);
    // The story's scenes (the blocked lift, the desk, into the lift) are seen
    // first person with the body hidden: the launcher stays in your hands, in
    // view - not on the shoulder of a body that isn't drawn.
    this._placeLauncher(firstPerson || this.phase === "story");
    this.projectiles.update(dt, {
      breakables: level.breakables, solids: level.obstacles,
      surface: (a, b, radius) => level.surfaceHit(a, b, radius),
      onBreakable: (o, p, b) => this._onBallHit(o, p, b), onSolid: (o, p, b) => this._onBallSolid(o, p, b),
      onSurface: (p, b) => this._onBallSurface(p, b), onFloor: (p, b) => this._onBallFloor(p, b),
    });
    this.debris.update(dt);
    this.shatter.update(dt);
    this.sphereImpact.update(dt);
    if (this.sfx) {
      level.route.sample(r.distance, r.lateral, 0, V.sfxPos);
      this.sfx.updateBrokenGlass(V.sfxPos, playing && r.speed > 1 && r.height < 0.12);
      this.sfx.updateEnvironment({ fire: { distance: Math.max(0, r.distance - r.fireDistance), intensity: 1, offsetX: 0 } });
      this.sfx.updateElevator(level.endLift?.state.velocity ?? 0, this.phase === "depart");
      // The fire alarm (dead with the power), and your breathing - harder as you weaken.
      const running = playing && this.phase === "run";
      const breach = this.phase === "story" && this.director?.stage === "breach";
      this.sfx.updateAlarm((running || breach) && !this._alarmOff ? 0.85 : 0, 0.12);
      this.sfx.updateBreath(running ? 0.4 + (1 - r.vitality / START_VITALITY) * 0.5 : 0);
      // They're loose: somewhere in the labs, one moans, or begs.
      if (running) {
        this._moanIn = (this._moanIn ?? 2.5) - dt;
        if (this._moanIn <= 0) {
          this._moanIn = 3.5 + Math.random() * 5;
          this.sfx.patient(Math.random() < 0.3 ? "speech" : "moan", { strength: 0.75, distance: 12 + Math.random() * 24, pan: Math.random() * 1.6 - 0.8 });
        }
      }
    }
    // Somewhere above, the building giving way: every so often a distant
    // collapse booms through the structure and shakes the corridor.
    if (playing && this.phase === "run") {
      this._collapseIn = (this._collapseIn ?? 8) - dt;
      if (this._collapseIn <= 0) {
        this._collapseIn = 12 + Math.random() * 12;
        if (this.sfx) this.sfx.distantCollapse(0.6 + Math.random() * 0.4);
        else this.audio.distantCollapse(0.6 + Math.random() * 0.4);
        this.trauma = Math.min(1, this.trauma + (this.reducedMotion ? 0.05 : 0.2));
      }
    }

    // The launcher's light: from the muzzle toward what the reticle is on -
    // held like a weapon light, a little low, so aiming at the corridor
    // ahead also lights the floor you are about to run on.
    // Thermal sight (a serum) sees through the dark and the smoke.
    const darkness = level.state.darkness * (1 - this.arsenal.level("thermal") * 0.75);
    this.raycaster.setFromCamera(this.pointer, camera);
    V.beamTarget.copy(this.raycaster.ray.origin).addScaledVector(this.raycaster.ray.direction, 24);
    V.beamTarget.y -= 1.3;
    this.launcher.muzzle.getWorldPosition(V.muzzle);
    this.beam.update(dt, { origin: V.muzzle, target: V.beamTarget, darkness, time, projectiles: this.projectiles });
    level.setFlashlight({ active: this.beam.power > 0.2, position: V.muzzle, direction: this.beam.direction(), cos: Math.cos(this.beam.angle * 0.8), range: 28 });

    // Danger: red tint, darker thicker smoke, louder fire and siren. The dark
    // beat pulls the fog to black smoke instead.
    const scene = this.scene;
    const danger = THREE.MathUtils.clamp(1 - r.vitality / START_VITALITY, 0, 1);
    const fireNear = THREE.MathUtils.clamp(1 - (r.distance - r.fireDistance) / 45, 0, 1);
    level.setDanger(danger);
    this.hud.setDanger(Math.max(danger, fireNear * 0.8));
    scene.fog.color.copy(FOG_CALM).lerp(FOG_DANGER, danger).lerp(FOG_DARK, darkness * 0.9);
    this.environment.set(1 - darkness * 0.92);
    scene.background.copy(scene.fog.color);
    scene.fog.density = 0.011 + danger * 0.018 + (this.warp.active ? 0.01 : 0) + darkness * 0.022;
    this.renderer.toneMappingExposure = BASE_EXPOSURE - danger * 0.25 + darkness * 0.12;
    this.audio.setFireProximity(fireNear);
    this.audio.setDanger(danger);

    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const g = this.grade.uniforms;
    g.uTime.value = time;
    g.uDanger.value = danger;
    g.uDark.value = darkness;
    g.uHeat.value = this.reducedMotion ? 0 : Math.max(fireNear * fireNear, this.warp.active ? 0.5 : 0);
    g.uHit.value = this.reducedMotion ? this.hitFlash * 0.3 : this.hitFlash;

    // Reticle: hot over a target, red and pulsing when overheated.
    const reticle = this.ui.reticle;
    reticle.hidden = !this.visible || cutscene || this.phase === "over";
    reticle.classList.toggle("hot", this.raycaster.intersectObjects(level.breakables, false).length > 0);
    reticle.classList.toggle("overheated", r.lockout > 0);
    reticle.classList.toggle("weak", r.weakened > 0);

    this.hud.setVitality(r.vitality, START_VITALITY);
    this.hud.setBalls(r.balls);
    this.hud.setPrompt(this.phase !== "run" ? null : level.ductAhead(r.distance, 7) && r.height < 0.5 ? "SPACE - JUMP THE DUCT" : r.balls <= 0 && playing ? "NO SPHERES" : null);
    this.hud.update({ fps: this._fps(dt), renderer: this.renderer });
  }

  _fps(dt) {
    this._fpsAcc = (this._fpsAcc ?? 0) + dt;
    this._fpsFrames = (this._fpsFrames ?? 0) + 1;
    if (this._fpsAcc >= 0.5) {
      this._fpsValue = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    return this._fpsValue ?? 0;
  }

  _updateMovement(dt, playing) {
    const r = this.runner;
    const level = this.level;
    // Forward: settle toward the beat's speed; a stumble or a fallen duct
    // takes it away.
    r.baseSpeed += (level.speedAt(r.distance) - r.baseSpeed) * Math.min(1, dt * 0.7);
    r.speed = 0;
    r.pushing = false;
    if (playing) {
      r.speed = r.baseSpeed * this.speedScale * (r.slow > 0 ? 0.45 : 1) * (this.arsenal.isActive("overdrive") ? 1.25 : 1); // overdrive: +25 %, as everywhere
      r.distance = Math.min(r.distance + r.speed * dt, level.route.totalLength - 1);
    }

    // Lanes: critically damped spring toward the chosen lane.
    [r.lateral, r.lateralVel] = spring(r.lateral, r.lateralVel, LANES[r.lane], LANE_OMEGA, dt);

    // The floor: a fallen duct is something to stand on - from above. (From
    // the side it's a wall: _checkHazards.)
    const top = level.groundAt?.(r.distance, 0.45, r.lateral) ?? 0;
    const ground = r.height >= top - 0.12 ? top : 0;
    r.ground = ground;

    // Buffered jump and slide.
    r.jumpBuffer = Math.max(0, r.jumpBuffer - dt);
    r.slideBuffer = Math.max(0, r.slideBuffer - dt);
    const grounded = r.height <= ground + 0.001;
    if (r.jumpBuffer > 0 && grounded && playing) {
      r.verticalVelocity = JUMP_VELOCITY;
      r.jumpBuffer = 0;
      r.sliding = 0; // a jump cancels a slide
    }
    if (r.slideBuffer > 0 && playing) {
      if (grounded) {
        r.sliding = SLIDE_SECONDS;
        r.slideBuffer = 0;
      } else if (r.verticalVelocity > SLAM_VELOCITY) {
        // Slide pressed mid-air: slam down into it.
        r.verticalVelocity = SLAM_VELOCITY;
      }
    }
    const wasAirborne = r.height > ground + 0.001;
    r.verticalVelocity -= (r.verticalVelocity > 0 ? RISE_GRAVITY : FALL_GRAVITY) * dt;
    r.height = Math.max(ground, r.height + r.verticalVelocity * dt);
    if (r.height <= ground) {
      if (wasAirborne) {
        this.landingDip = Math.min(1, -r.verticalVelocity / 14);
        if (r.slideBuffer > 0) {
          r.sliding = SLIDE_SECONDS;
          r.slideBuffer = 0;
        }
      }
      r.verticalVelocity = 0;
    }
    r.sliding = Math.max(0, r.sliding - dt);
  }

  /**
   * Spring-follow the desired position. A critically damped spring (not a
   * lerp) keeps the camera's own velocity, so it glides through the
   * 90-degree turns instead of cutting the corner and never jerks when the
   * runner changes lanes mid-turn.
   */
  _follow(target, stiffness, dt) {
    const { camera } = this;
    const vel = this._v.camVelocity;
    if (this.snapCamera) {
      camera.position.copy(target);
      vel.set(0, 0, 0);
      return;
    }
    const omega = Math.sqrt(stiffness);
    for (const axis of ["x", "y", "z"]) {
      [camera.position[axis], vel[axis]] = spring(camera.position[axis], vel[axis], target[axis], omega, dt);
    }
  }

  _updateCamera(dt, time) {
    const { camera, runner: r, level } = this;
    const V = this._v;
    const mode = CAMERA_MODES[this.cameraMode];
    const reduced = this.reducedMotion;
    this.landingDip = Math.max(0, this.landingDip - dt * 3.2);
    const dip = reduced ? 0 : Math.sin(Math.min(1, this.landingDip) * Math.PI) * 0.18;

    if (mode === "FIRST PERSON") {
      const bob = reduced || r.height > 0.01 || r.speed <= 0 ? 0 : Math.abs(Math.sin(this.avatar.phase)) * 0.045;
      level.route.sample(r.distance + 0.3, r.lateral, 1.65 + r.height - this.avatar.crouch * 0.8 + bob - dip, V.desired);
      level.route.sample(r.distance + 14, r.lateral * 0.4, 1.5, V.look);
      this._follow(V.desired, 900, dt);
    } else if (mode === "CINEMATIC") {
      level.route.sample(r.distance + 8, 5.2, 3.2, V.desired);
      level.route.sample(r.distance, r.lateral, 1.4, V.look);
      this._follow(V.desired, 14, dt);
    } else if (mode === "ORBIT") {
      level.route.sample(r.distance, 0, 0, V.desired);
      V.desired.x += Math.cos(time * 0.25) * 16;
      V.desired.z += Math.sin(time * 0.25) * 16;
      V.desired.y += 9;
      level.route.sample(r.distance, 0, 2, V.look);
      this._follow(V.desired, 16, dt);
    } else {
      // Chase: pulled back a touch as speed rises, trailing the lateral move.
      const back = 6.4 + r.speed * 0.05;
      level.route.sample(r.distance - back, r.lateral * 0.62, 2.8 + r.height * 0.55 - dip, V.desired);
      level.route.sample(r.distance + 12, r.lateral * 0.3, 1.6, V.look);
      this._follow(V.desired, 70, dt);
    }

    // A stumble makes you look back at the fire gaining on you - the moment
    // the brief describes. Lasts under a second; reduced motion skips it.
    if (r.lookBack > 0 && !reduced && mode !== "ORBIT") {
      const k = Math.sin(Math.min(1, r.lookBack / 0.9) * Math.PI);
      level.route.sample(Math.max(0, r.fireDistance), 0, 2.5, V.behind);
      V.look.lerp(V.behind, k);
    }

    if (this.snapCamera) V.smoothedLook.copy(V.look);
    else V.smoothedLook.lerp(V.look, 1 - Math.exp(-dt * (r.lookBack > 0 ? 6 : 12)));
    camera.lookAt(V.smoothedLook);

    // Lean the view slightly into lane changes.
    const rollTarget = reduced || mode === "ORBIT" ? 0 : THREE.MathUtils.clamp(-r.lateralVel * 0.006, -0.05, 0.05);
    this.cameraRoll += (rollTarget - this.cameraRoll) * Math.min(1, dt * 8);
    camera.rotateZ(this.cameraRoll);

    // Speed widens the view: 72 degrees at a jog, ~79 flat out.
    let fov = BASE_FOV + (reduced ? 0 : THREE.MathUtils.clamp((r.speed - 8) * 1.1, 0, 7));
    // Overdrive (a serum) widens it further, as in every level.
    fov += this.arsenal.level("overdrive") * (reduced ? 3 : 9);
    // Reality warp: roll and up-vector drift, scaled down under reduced motion.
    if (this.warp.active) {
      const s = Math.sin(Math.min(1, this.warp.t) * Math.PI) * (reduced ? 0.3 : 1);
      camera.up.lerp(V.warpUp.set(Math.sin(time * 1.3) * 0.55 * s, 1, Math.cos(time * 0.9) * 0.3 * s).normalize(), Math.min(1, dt * 2));
      camera.rotateZ(Math.sin(time * 2.1) * 0.18 * s);
      fov += Math.sin(time * 1.7) * 9 * s;
    } else {
      camera.up.lerp(UP, Math.min(1, dt * 3));
    }
    this._setFov(fov, dt);
    this._shake(dt, 0.5, 0.4, 0.06);
    this.snapCamera = false;
  }

  _setFov(fov, dt) {
    const camera = this.camera;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
  }

  /** Trauma shake, squared so big hits are violent and the tail settles fast. */
  _shake(dt, x, y, roll) {
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    if (this.trauma <= 0.001) return;
    const amount = this.trauma * this.trauma * (this.reducedMotion ? 0.25 : 1);
    this.camera.position.x += (Math.random() * 2 - 1) * amount * x;
    this.camera.position.y += (Math.random() * 2 - 1) * amount * y;
    if (roll) this.camera.rotateZ((Math.random() * 2 - 1) * amount * roll);
  }

  /**
   * Apply a cutscene frame (the lifts, the roof endings): the level says
   * where the camera is and looks, where the player is and what they do.
   */
  _applyCutscene(cut, dt, sdt = dt) {
    const { avatar, camera } = this;
    const V = this._v;
    avatar.root.position.copy(cut.player);
    avatar.root.rotation.y = cut.playerYaw;
    avatar.setVisible(!cut.hidePlayer);
    avatar.shadow.visible = !cut.hidePlayer && cut.action !== "jump" && cut.action !== "hang";
    avatar.hold = cut.hold ?? 1;
    avatar.reachUp = cut.reachUp ?? 0;
    const speed = cut.speed ?? (cut.action === "run" ? 9 : cut.action === "climb" ? 2.5 : 0);
    avatar.update(sdt, { speed, height: cut.action === "jump" ? 1 : 0, aiming: false });
    // The lift cutscenes are already smooth: follow them exactly. The roof
    // endings cut between framings, so ease into each.
    const exact = cut.kind === "arrival" || cut.kind === "departure";
    if (this.snapCamera || exact) camera.position.copy(cut.camera);
    else camera.position.lerp(cut.camera, 1 - Math.exp(-dt * 3));
    if (this.snapCamera || exact) V.smoothedLook.copy(cut.look);
    else V.smoothedLook.lerp(cut.look, 1 - Math.exp(-dt * 4));
    camera.up.copy(UP);
    camera.lookAt(V.smoothedLook);
    this._setFov(BASE_FOV, dt);
    if (cut.shake) this.trauma = Math.max(this.trauma, cut.shake);
    this._shake(dt, 0.3, 0.25, 0.02);
    this.fade.override = cut.fade ? cut.fade : this.fade.override;
    this._v.camVelocity.set(0, 0, 0);
    this.snapCamera = false;
  }

  _placeLauncher(firstPerson) {
    const { launcher, avatar, camera, runner: r } = this;
    if (firstPerson) {
      if (launcher.rig.parent !== camera) camera.add(launcher.rig);
      // A little sway with the stride, so the launcher is carried, not glued.
      const bob = this.reducedMotion ? 0 : r.speed > 0 && r.height <= 0.01 ? Math.sin(avatar.phase) : 0;
      launcher.rig.position.set(0.36 + bob * 0.012, -0.33 + Math.abs(bob) * 0.012, -0.62 + launcher.recoil * 0.12);
      launcher.rig.rotation.set(0.04 + launcher.recoil * 0.2, 0.05, bob * 0.02);
    } else {
      if (launcher.rig.parent !== avatar.shoulder) avatar.shoulder.add(launcher.rig);
      if (avatar.hold > 0.5) {
        // Sat on the shoulder, most of the tube out in front, where both
        // hands of the hold pose (characters.js) close on it.
        launcher.rig.position.set(-0.04, -0.07, -0.18 + launcher.recoil * 0.1);
        launcher.rig.rotation.set(launcher.recoil * 0.15, 0, 0);
      } else {
        // Hands busy (the ladder): slung diagonally across the back.
        launcher.rig.position.set(-0.3, -0.35, 0.2);
        launcher.rig.rotation.set(0, Math.PI / 2, 0.85);
      }
    }
    // The tube glows hot under overdrive.
    const glow = this.arsenal.level("overdrive") * 0.8;
    for (const m of launcher.heatMaterials) m.emissiveIntensity = glow * 1.4;
  }

  /* ---------------- Shooting ---------------- */

  /** Overdrive (a serum) hits harder - as in the Skyline. */
  _currentPower() {
    return this.arsenal.isActive("overdrive") ? 2 : 1;
  }

  /** The focus (bullet time) a host may run: only while there's play. */
  get acceptsFocus() {
    return (this.phase === "run" || this.phase === "roof") && this.runner.alive;
  }

  /**
   * One trigger pull: the Skyline's spheres out of the launcher - the type
   * chosen (Q/E), at its cost and speed, on its gravity arc (aimed high by
   * the drop, so it lands on the reticle), three at once under prism.
   */
  _shoot() {
    const { runner: r, level, audio } = this;
    const V = this._v;
    if (!r.alive || (!level && !this.roof)) return;
    if (this.phase === "run" && r.finished) return;
    const def = this.arsenal.current;
    const cost = this.arsenal.cost();
    if (r.balls <= 0 || r.balls < cost) {
      audio.dry();
      if (r.balls > 0) this.hud.toast(`${def.name.toUpperCase()} NEEDS ${cost}`, "", "warn", 1000);
      return;
    }
    r.balls -= cost;
    const count = this.arsenal.isActive("prism") ? 3 : 1;
    r.shots += count;

    // Aim where the reticle points: the first breakable or hazard under it,
    // or 60 m out. The ball then flies from the muzzle toward that point.
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.phase === "run") {
      const hit = this.raycaster.intersectObjects(level.breakables, false)[0];
      if (hit) V.aim.copy(hit.point);
      else V.aim.copy(this.raycaster.ray.origin).addScaledVector(this.raycaster.ray.direction, 60);
    } else {
      V.aim.copy(this.hero.aim);
    }

    this.launcher.muzzle.getWorldPosition(V.muzzle);
    V.fireDir.copy(V.aim).sub(V.muzzle).normalize();
    if (this.phase === "run") {
      const sample = level.route.sample(r.distance);
      V.forwardVel.set(-Math.sin(sample.heading), 0, -Math.cos(sample.heading)).multiplyScalar(r.speed);
    } else {
      V.forwardVel.copy(this.hero.velocity).multiplyScalar(0.5);
      this.hero.lastShot = 0;
    }
    // Ballistic compensation: up by the drop over the flight time.
    const flight = V.aim.distanceTo(V.muzzle) / def.speed;
    for (let i = 0; i < count; i += 1) {
      const dir = V.fireDir.clone();
      if (count > 1) dir.applyAxisAngle(UP, (i - 1) * 0.07);
      dir.multiplyScalar(def.speed).addScaledVector(UP, 0.5 * def.gravity * flight);
      this.projectiles.fire(V.muzzle, dir, dir.length(), {
        power: this._currentPower(), inherit: V.forwardVel, gravity: def.gravity, kind: def.key, radius: def.radius,
      });
    }
    this.launcher.recoil = 1;
    audio.shot(false);
    this.sfx?.throwBall();
  }

  /** A vial: the serum it holds goes in (the Skyline's power-ups). */
  _applyPowerup(kind) {
    const serum = VIAL_SERUM[kind] ?? kind;
    this.arsenal.activate(serum);
    return SERUMS[serum];
  }

  /**
   * A cryo or shock sphere going off (the Skyline's rules): shock breaks
   * everything breakable within reach; cryo knocks down the people around it
   * (and in the Labs pushes the fire back).
   */
  _detonate(ball, point) {
    const def = BALLS[ball.kind];
    if (!def?.splash) return;
    const targets = this.roof ? this.roof.breakables : this.level?.breakables ?? [];
    this.sphereImpact.splash(point, ball.kind, def.splash);
    this.debris.sparks(point, { count: 26, speed: 6 });
    this._chunks(point, 22, { tint: ball.kind === "cryo" ? 0xbff4ff : 0xd9a6ff, speed: 5, radius: def.splash * 0.3, size: 0.08 });
    const at = new THREE.Vector3();
    for (const target of targets.slice()) {
      if (!target.parent) continue;
      target.getWorldPosition(at);
      if (at.distanceTo(point) > def.splash) continue;
      const person = target.userData.kind === "patient" || target.userData.kind === "enemy" || !!target.userData.enemy;
      if (ball.kind === "cryo" && !person) continue;
      this._onBallBreakable(target, at.clone(), { power: ball.kind === "shock" ? 99 : 2, velocity: ball.velocity.clone(), kind: "glass" });
    }
    if (ball.kind === "cryo" && this.level && !this.roof) this.runner.fireDistance -= 6;
    this.trauma = Math.min(1, this.trauma + 0.2);
    this.sfx?.glassBreak();
  }

  _onBallBreakable(object, point, ball) {
    if (this.roof) return this._onRoofBreakable(object, point, ball);
    const { level, debris, audio, hud, runner: r } = this;
    const result = level.breakTarget(object, ball.power);
    if (!result) return true;
    if (result.partial) {
      if (result.kind === "glass") {
        debris.burst(point, { kind: "glass", count: 8, speed: 3, size: 0.18 });
        this._chunks(point, 10, { size: 0.07, speed: 2.5, radius: 0.15 });
        this.sfx?.impact(0.35);
        audio.glassCrack();
      } else if (result.kind === "patient") {
        debris.burst(point, { kind: "concrete", count: 6, speed: 2.5, size: 0.1 });
        debris.dust(point, { size: 1.2, life: 0.6, color: 0x5a2a22 });
        audio.thud();
        this._patientSound("pain", point, 0.9);
      } else {
        debris.sparks(point, { count: 12 });
        audio.clang();
      }
      return true;
    }
    r.breaks += 1;
    if (result.kind === "glass") {
      const sample = level.route.sample(object.userData.routeDistance ?? r.distance);
      this._v.laneRight.set(Math.cos(sample.heading), 0, -Math.sin(sample.heading));
      debris.burst(result.position, { kind: "glass", count: 30, speed: 5.5, area: [3.0, 3.4], right: this._v.laneRight, push: ball.velocity.clone().multiplyScalar(0.15) });
      this._fracture(object, point, ball.velocity);
      audio.glassShatter(true);
      this.trauma = Math.min(1, this.trauma + 0.15);
      // A glass sphere punches through and keeps going, as in the Skyline.
      if ((ball.kind ?? "glass") === "glass") return "through";
    } else if (result.kind === "sack") {
      r.balls = Math.min(MAX_BALLS, r.balls + (result.spheres ?? 0));
      debris.burst(result.position, { kind: "sack", count: 26, speed: 4 });
      debris.burst(result.position, { kind: "ball", count: 6, speed: 3, up: 2 });
      this._chunks(result.position, 14, { tint: 0xd8f6ff, speed: 3.5 });
      this.sfx?.glassBreak();
      this.sfx?.sphereCollected();
      hud.toast("SPHERES", `+${result.spheres}`);
      audio.glassShatter(false);
      audio.pickup();
    } else if (result.kind === "patient") {
      r.downs += 1;
      debris.burst(point, { kind: "concrete", count: 10, speed: 3, size: 0.12 });
      debris.dust(point, { size: 2, life: 0.9, color: 0x5a2a22 });
      this.sfx?.impact(0.6);
      audio.thud();
      audio.bodyFall();
      this._patientSound("death", point, 1);
    } else if (result.kind === "powerup") {
      const serum = this._applyPowerup(result.powerupKind);
      debris.burst(result.position, { kind: "power", count: 30, speed: 5 });
      debris.sparks(result.position, { count: 30 });
      this._chunks(result.position, 18, { tint: 0xfff0a8, speed: 4.5 });
      this.sfx?.glassBreak();
      this.sfx?.serumCollected();
      // The banner across the top names it (src/ui/serum-fx.js); only the
      // Labs' own HUD (the standalone preview) needs the toast.
      if (!this.arsenalShared) hud.toast(serum ? `SERUM // ${serum.name.toUpperCase()}` : "SERUM", serum?.text ?? "", "power", 2600);
      audio.powerup();
    }
    return true;
  }

  /** A sphere hit something breakable: break it, and a special one goes off. */
  _onBallHit(object, point, ball) {
    const consumed = this._onBallBreakable(object, point, ball);
    if (ball.kind && ball.kind !== "glass") this._detonate(ball, point);
    return consumed;
  }

  /** Off a wall or the ceiling: the Skyline's ricochet sparks and sound. */
  _onBallSurface(point) {
    this.debris.sparks(point, { count: 24, speed: 5 });
    this.sfx?.surfaceRicochet();
  }

  _onBallSolid(object, point, ball) {
    this.debris.sparks(point, { count: 14, speed: 5 });
    this.audio.clang();
    this.sfx?.surfaceRicochet();
    if (ball?.kind && ball.kind !== "glass") {
      this._detonate(ball, point);
      ball.life = 99; // spent
    }
  }

  /** A cryo or shock sphere goes off where it lands; glass just bounces. */
  _onBallFloor(point, ball) {
    if (!ball.kind || ball.kind === "glass") return;
    this._detonate(ball, point.clone());
    ball.life = 99;
  }

  /** Level 1's radial fracture of a pane, around the point it was hit. */
  _fracture(object, point, push) {
    const pane = object.isMesh ? object : null;
    if (pane?.geometry) {
      this.shatter.floor = this._floorBelow(point);
      this.shatter.fracture(pane, point, push, { power: 1.1 });
    } else this._chunks(point, 40, { speed: 5, radius: 1.2, size: 0.16, push });
    this.sfx?.glassBreak();
    this.sfx?.addGlassDebris(point, 2.2);
  }

  _chunks(point, count, options = {}) {
    this.shatter.floor = this._floorBelow(point);
    this.shatter.chunks(point, count, options);
  }

  /** Floor height under a point: the route's (or the roof's) surface. */
  _floorBelow(point) {
    if (this.roof) return this.hero.position.y;
    if (this.level) {
      this.level.route.sample(this.runner.distance, 0, 0, this._v.floor);
      return this._v.floor.y;
    }
    return 0;
  }

  /* ---------------- Collision, vitality ---------------- */

  _checkHazards(dt) {
    const { runner: r, level, debris, audio, hud } = this;
    r.invulnerable = Math.max(0, r.invulnerable - dt);
    r.slow = Math.max(0, r.slow - dt);
    if (!r.alive || r.finished) return;

    const crouched = r.sliding > 0;
    const height = crouched ? 1.0 : 1.9;
    // sample() writes the position into the target and returns {position, heading}.
    const centre = this._v.boxCentre;
    level.route.sample(r.distance, r.lateral, r.height, centre);
    centre.y += 0.18 + height / 2;
    this.playerBox.setFromCenterAndSize(centre, this._v.boxSize.set(0.9, height, 0.9));
    const hits = level.collide(this.playerBox, r.distance);
    // A fallen duct is solid even through the mercy window: up and over.
    const duct = hits.find((h) => h.userData.duct);
    if (duct && r.invulnerable > 0) {
      r.height = Math.max(r.height, duct.userData.top ?? 1);
      r.verticalVelocity = Math.max(r.verticalVelocity, 2.2);
      return;
    }
    if (!hits.length || r.invulnerable > 0) return;

    const hazard = duct ?? hits[0];
    // Caught by one of them: it snarls as it hits you.
    if (hazard.userData.patient) this._patientSound("growl", null, 1.2);
    // Crashing through an intact pane shatters it - you get through, but it
    // costs you like any other hit.
    if (hazard.userData.glass) {
      const pane = level.breakables.find((b) => b.userData.pane?.hit === hazard);
      if (pane) {
        const result = level.breakTarget(pane, 99);
        if (result) debris.burst(result.position, { kind: "glass", count: 24, speed: 6, area: [3, 3.4] });
        if (result) {
          const sample = level.route.sample(r.distance);
          this._fracture(pane, centre, this._v.crash.set(-Math.sin(sample.heading), 0.1, -Math.cos(sample.heading)).multiplyScalar(Math.max(4, r.speed)));
        }
        audio.glassShatter(true);
      }
    }
    // Ran into a fallen duct instead of jumping it: it hurts, and you
    // scramble up and over it (rather than passing through).
    if (hazard.userData.duct) {
      r.height = Math.max(r.height, hazard.userData.top ?? 1);
      r.verticalVelocity = Math.max(r.verticalVelocity, 2.2);
      debris.sparks(centre, { count: 12, speed: 3 });
      audio.clang();
    }
    // A kinetic shield (serum) takes the hit.
    if (this.arsenal.absorb()) {
      debris.sparks(centre, { count: 20 });
      hud.toast(this.arsenal.shieldCharges > 0 ? "SHIELD ABSORBED" : "SHIELD BROKEN", this.arsenal.shieldCharges > 0 ? "1 LEFT" : "", "power", 1400);
      r.invulnerable = 1.1;
      return;
    }

    r.vitality = Math.max(0, r.vitality - HIT_VITALITY - HIT_FIRE_BURST);
    const dropped = Math.min(r.balls, Math.max(r.balls > 0 ? 1 : 0, Math.round(r.balls * HIT_BALL_DROP_RATIO)));
    r.balls -= dropped;
    r.hits += 1;
    r.invulnerable = 1.1;
    r.slow = 0.55;
    r.lookBack = 0.9;
    this.trauma = Math.min(1, this.trauma + 0.85);
    this.hitFlash = 1;
    level.impact(1);
    hud.flashDamage();
    hud.toast("HIT", dropped ? `-${dropped} SPHERES` : "", "warn");
    audio.stumble();
    this.sfx?.impact(1);
    this.sfx?.hurt();
    // The dropped balls physically spill out behind you.
    if (dropped) debris.burst(centre, { kind: "ball", count: Math.min(12, dropped), speed: 3, up: 3 });

    if (r.vitality <= 0) {
      r.alive = false;
      this.trauma = 1;
      this._finishRun(false, "CAUGHT BY THE FIRE");
    }
  }

  /* ---------------- Story hand-off and endless laps ---------------- */

  /** Mode "corridor": through the lift at the end of the Labs. Stays black for the host. */
  _corridorDone() {
    this.phase = "corridorDone";
    this.fade.override = 1;
    this.runner.firing = false;
    this.hud.setPrompt(null);
    this.events.emit("corridor-complete", { stats: this.stats });
  }

  /** Endless Labs: at the end of the corridor, a new, reshuffled lap - a little faster. */
  async _nextLap() {
    if (this.phase !== "run") return;
    const r = this.runner;
    this.phase = "fade";
    r.firing = false;
    this.fade.override = null;
    this.fade.target = 1;
    this.endless.distance += this.level.route.totalLength;
    this.endless.laps += 1;
    const keep = { balls: r.balls, vitality: Math.min(START_VITALITY, r.vitality + 15) };
    this.events.emit("lap", { laps: this.endless.laps, distance: this.endless.distance });
    await new Promise((resolve) => setTimeout(resolve, 650));
    this.speedScale = 1 + 0.07 * this.endless.laps;
    await this.load({ ...keep, seed: this.endless.laps, carry: true });
    this.fade.value = 1;
    this.fade.target = 0;
    this.hud.showBanner(`LAP ${this.endless.laps + 1}`, "NEW LAYOUT // FASTER", 2600);
    this.begin();
  }

  /**
   * Straight to the roof, with no corridor: the story's finale (after the
   * Skyline) and endless Roof. Loads the body and the launcher, then the
   * roof comes up and its lift doors open.
   */
  /** This stage's collectibles (none: null), placed by `spots()`. */
  _setFiles(level, spots) {
    this.files?.dispose();
    this.files = null;
    if (!level) return;
    this.files = new CollectibleSet(level, { positions: spots() });
    this.scene.add(this.files.root);
  }

  /** Found one: the host shows it (the recovered panel) and scores it. */
  _updateFiles(dt, time, position) {
    this.files?.update(dt, time, position, (found) => this.events.emit("collectible", found), (near) => this.events.emit("collectible-near", near));
  }

  async enterRoof({ balls = START_BALLS, vitality = START_VITALITY } = {}) {
    document.body.classList.remove("finale-film");
    if (this.level) {
      this.hud.unbind();
      this.level.dispose();
      this.level = null;
    }
    this.director?.dispose();
    this.director = null;
    this.finale?.dispose();
    this.finale = null;
    this.roof?.dispose();
    this.roof = null;
    this._timers.length = 0;
    this.cut = null;
    this.ui.letterbox.classList.remove("on");
    this.hud.vitals.style.visibility = "";
    this.hud.hideSummary();
    this.avatar.hold = 1;
    this.avatar.reachUp = 0;
    this.projectiles.clear();
    this.debris.clear();
    this.shatter.clear();
    this.sphereImpact.clear();
    this.sfx?.startLevel();
    this._resetRunner();
    Object.assign(this.runner, { balls, vitality: Math.max(1, vitality - 25) }); // startRoof adds the +25 breath back
    this.clock = 0;
    this.phase = "idle";
    this.fade.override = 1;
    const [assets] = await Promise.all([loadMeltdownAssets(this.assetBase, { names: ["launcher"] }), this._loadCharacter(this.character)]);
    this._mountLauncherModel(assets);
    this.assetsReady = true;
    await this.startRoof({ fromBlack: true });
  }

  /* ---------------- End of Phase A ---------------- */

  _startDeparture() {
    if (this.phase !== "run") return;
    this.phase = "depart";
    this.runner.finished = true;
    this.runner.firing = false;
    this.cut = this.level.beginDeparture(this.camera.position);
    this.hud.showBanner("SECTOR 02 CLEARED", this.mode === "corridor" ? "UP TO THE SKYLINE" : "UP TO THE ROOF", 2600);
    this.hud.setPrompt(null);
    this.events.emit("phase", { phase: "depart" });
  }

  _finishRun(survived, title) {
    const r = this.runner;
    if (r.finished && this.phase !== "run") return;
    if (!survived && this.checkpoint && this.phase === "run" && this.mode !== "endless-labs") {
      this._respawnAtCheckpoint(title);
      return;
    }
    r.finished = true;
    r.alive = false;
    r.firing = false;
    if (survived) return;
    this._end(false, title, [
      ["Time", `${this.clock.toFixed(1)}s`],
      ["Distance", `${Math.round(r.distance)} / ${Math.round(this.level.route.totalLength)}m`],
      ["Hits taken", r.hits],
      ["Shots / breaks", `${r.shots} / ${r.breaks}`],
      ["Patients downed", r.downs],
      ["Spheres left", r.balls, true],
    ]);
  }

  /**
   * Caught past a checkpoint: a moment of black, then back at the start of
   * that section - some vitality back, the fire pushed back behind you, the
   * spheres you had there - and a short grace before anything can hurt you.
   */
  _respawnAtCheckpoint(title) {
    const r = this.runner;
    const cp = this.checkpoint;
    r.alive = false;
    r.firing = false;
    this.phase = "respawn";
    this.hud.showBanner(title ?? "DOWN", `BACK TO THE CHECKPOINT // ${cp.name}`, 2200);
    this.fade.target = 1;
    this.fade.rate = 3;
    this._after(0.6, () => {
      if (this.phase !== "respawn") return;
      Object.assign(r, {
        distance: cp.distance, lane: 1, lateral: 0, lateralVel: 0, height: 0, verticalVelocity: 0, sliding: 0,
        jumpBuffer: 0, slideBuffer: 0, landed: 0, pushing: false, lookBack: 0, heat: 0, lockout: 0, slow: 0,
        vitality: Math.max(r.vitality, 70), balls: Math.max(r.balls, cp.balls), alive: true, finished: false,
        invulnerable: 2.5, fireDistance: cp.distance - 40, speed: this.level.speedAt(cp.distance),
      });
      this.projectiles.clear?.();
      this.snapCamera = true;
      this.phase = "run";
      this.fade.target = 0;
      this.fade.rate = 1.5;
    });
  }

  /** The run is over, one way or the other. */
  _end(escaped, title, rows, eyebrow) {
    this.phase = "over";
    if (!escaped) this.sfx?.gameOver();
    this.sfx?.updateElevator(0, false);
    this.runner.firing = false;
    this.ui.letterbox.classList.remove("on");
    this.hud.vitals.style.visibility = "";
    this.hud.setPrompt(null);
    const result = { escaped, title, rows, eyebrow, stats: this.stats };
    if (this.options.summary) this.hud.showSummary({ title, eyebrow, failed: !escaped, rows });
    this.events.emit(escaped ? "complete" : "failed", result);
  }

  /* ================================================================ */
  /* Phase B - the roof                                                */
  /* ================================================================ */

  /**
   * Up to the roof: (fade to) black, swap the corridor for the roof, compile
   * its shaders while the screen is black (the scene's light count changes,
   * so everything recompiles once - better here than mid-fight), then the
   * roof's lift doors open.
   */
  async startRoof({ fromBlack = false } = {}) {
    if (!["run", "arrive", "depart", "idle", "corridorDone"].includes(this.phase)) return;
    this.phase = "fade";
    this.runner.firing = false;
    this.fade.override = fromBlack ? 1 : null;
    this.fade.target = 1;
    this.fade.value = fromBlack ? 1 : this.fade.value;
    const wait = new Promise((resolve) => setTimeout(resolve, fromBlack ? 50 : 650));
    await Promise.all([wait, this.loadRoofAssets()]);
    if (this.phase !== "fade") return;

    if (this.level) this.level.root.visible = false;
    this.projectiles.clear();
    this.debris.clear();
    this.roof?.dispose();
    const roof = new RoofLevel({ assets: this.roofAssets, endless: this.mode === "endless-roof", assetBase: this.assetBase, ...this.roofOptions });
    this.roof = roof;
    roof.addTo(this.scene);
    // The flight records: three round the roof, clear of the cover.
    this._setFiles(this.mode === "endless-roof" ? null : "roof", () => [
      new THREE.Vector3(-13.5, 0, -2), new THREE.Vector3(12, 0, 6.5), new THREE.Vector3(-5, 0, 12.5),
    ]);
    this._bindRoofEvents(roof);
    this._supply = 0;
    // Police helicopters circling the tower, searchlights on the roof.
    if (!this.police) {
      this.police = new PoliceHelicopters({ count: 2, seed: 4 });
      this.police.load(this.assetBase);
    }
    this.scene.add(this.police.root);
    this.police.root.visible = true;

    const { hero, runner: r, avatar } = this;
    hero.position.copy(ROOF_SPAWN);
    hero.velocity.set(0, 0, 0);
    hero.knock.set(0, 0, 0);
    hero.vy = 0;
    hero.yaw = 0;
    hero.aim.copy(ROOF_SPAWN).add(new THREE.Vector3(0, 1.15, -10));
    this.roofClock = 0;
    avatar.setVisible(true);
    avatar.shadow.visible = true;
    // A breath in the lift: a partial refill, not a reset.
    r.vitality = Math.min(START_VITALITY, r.vitality + 25);
    r.alive = true;
    r.finished = false;
    r.invulnerable = 1.5;
    r.heat = 0;
    r.lockout = 0;

    const scene = this.scene;
    scene.fog.color.copy(FOG_ROOF);
    // Night haze: the city recedes into it, but you can see it's there.
    scene.fog.density = 0.0058;
    scene.background.copy(FOG_ROOF);
    this.renderer.toneMappingExposure = 1.0;
    this.environment.refresh();
    this.environment.set(0.8);
    this.cut = roof.beginArrival();
    this.snapCamera = true;
    this._applyCutscene(this.cut, 0.016);
    this._applyShadowFlags();
    roof.prewarm(this.renderer, this.camera);
    this._logTextureMemory("the Roof");

    this.phase = "roofArrive";
    this.fade.override = null;
    this.fade.value = 1;
    this.fade.target = 0;
    this.hud.showBanner(this.mode === "endless-roof" ? "ENDLESS // THE ROOF" : "THE ROOF", this.mode === "endless-roof" ? "THEY NEVER STOP COMING" : "HOLD ON", 3200);
    this.events.emit("phase", { phase: "roof" });
  }

  _bindRoofEvents(roof) {
    const { hud, audio, debris } = this;
    const on = (name, fn) => roof.events.on(name, (p) => roof === this.roof && fn(p));
    on("lift-open", () => audio.whoosh());
    on("arrived", () => {
      hud.toast("WASD MOVE", "SPACE DODGE", "", 4200);
      this._after(1.8, () => hud.toast("LURE THEM", "OFF THE EDGE", "", 4200));
    });
    on("wave", ({ index }) => {
      hud.showBanner(index === 1 ? "THEY WERE WAITING" : "MORE OF THEM", index === 1 ? "THEY'RE LETTING THEM OUT" : "THE MACHINE ROOM", 2600);
      this._patientSound("horde", null, 0.8);
      // Vale, on the roof's PA, as he lets them out.
      if (index === 1 && this.story?.layer && this.mode !== "endless-roof") this.story.layer.talk(STORY_LINES.valeRoof[0]);
    });
    on("patient-windup", ({ position }) => this._patientSound("growl", position, 1));
    on("patient-climb", ({ position }) => {
      this._patientSound(Math.random() < 0.5 ? "moan" : "growl", position, 0.9);
      hud.toast("OVER THE LEDGE", position.x < 0 ? "WEST SIDE" : "EAST SIDE");
    });
    on("patient-stunned", ({ position }) => {
      debris.dust(position.clone().setY(1), { size: 2 });
      audio.clang();
      this._patientSound("pain", position, 0.9);
    });
    on("enemy-fall", ({ enemy, position }) => {
      if (!this.sfx) audio.scream();
      else if (enemy?.kind === "scientist") this.sfx.play("scream-m", { ...this._placeOf(position), volume: 0.6 });
      else this._patientSound("shriek", position, 0.9);
      hud.toast("OVER THE EDGE", "");
    });
    on("enemy-down", ({ enemy, position }) => {
      audio.bodyFall();
      if (enemy?.kind === "scientist") this.sfx?.play("hurt-m", { ...this._placeOf(position), volume: 0.7 });
      else this._patientSound("death", position, 1);
      hud.toast("DOWN", enemy.kind === "scientist" ? "SCIENTIST" : "");
    });
    // The canisters, the drop and the brute (roof.js).
    on("canister", ({ position, downs }) => {
      this.sphereImpact.splash(position, "fire", CANISTER_RADIUS, [3.2, 1.2, 0.3]);
      debris.burst(position, { kind: "metal", count: 30, speed: 7 });
      debris.sparks(position, { count: 40, speed: 9 });
      debris.dust(position, { size: 4, life: 1.4, color: 0x2a1a12 });
      audio.crash(1.3);
      this.sfx?.impact(1);
      this.sfx?.explosion(1, this._placeOf(position).pan);
      this.trauma = Math.min(1, this.trauma + 0.6);
      if (downs > 1) hud.toast("CHAIN BLAST", `${downs} DOWN`, "power");
      // Too close to it yourself.
      const d = this.hero.position.distanceTo(position.clone().setY(0));
      if (d < CANISTER_RADIUS) this._roofHit({ damage: Math.round(24 * (1 - d / CANISTER_RADIUS)) + 6, from: position.clone(), knock: 8, source: "blast" });
    });
    on("drop-incoming", () => {
      hud.toast("SUPPLY DROP", "INBOUND - WATCH FOR THE FLARE", "power", 3000);
      audio.whoosh();
    });
    on("drop-landed", ({ position }) => {
      debris.dust(position.clone().setY(0.2), { size: 3, life: 1.2 });
      audio.thud();
      hud.toast("SUPPLY DROP", "SPHERES AND A SERUM", "power", 2400);
    });
    on("brute", () => {
      if (this.sfx) this.sfx.patient("roar", { strength: 1.2 });
      else audio.growl(1.3);
      hud.showBanner("A BIG ONE", "TWO SPHERES WON'T STOP IT", 2600);
    });
    on("orb-fired", () => audio.zap());
    on("orb-burst", ({ position }) => debris.sparks(position, { count: 22, speed: 5 }));
    on("clear", () => hud.showBanner("ROOF CLEAR", "HERE IT COMES", 3000));
    on("heli-arrived", ({ ending }) => {
      if (ending === "victory") {
        roof.beginEnding(this.hero.position);
        this._startCutscene();
        hud.showBanner("EXTRACTION", "CLIMB THE LADDER", 3000);
      } else {
        // Not a cutscene: it waits off the east ledge and you have to get there.
        hud.showBanner("IT CAN'T LAND", "JUMP FOR THE LADDER", 3200);
        audio.stinger();
      }
    });
    on("ladder-grab", () => {
      this._startCutscene();
      audio.whoosh();
    });
    on("heli-left", () => {
      hud.showBanner("IT COULDN'T WAIT", "LEFT BEHIND", 3000);
      this.runner.firing = false;
      this._after(3, () => {
        if (this.phase !== "roof" || this.roof !== roof) return;
        this._roofSummary(false, "LEFT BEHIND");
      });
    });
    // The roof coming apart.
    on("explosion", ({ position, strength }) => {
      debris.burst(position.clone().setY(Math.max(0.3, position.y + 2)), { kind: "concrete", count: 24, speed: 7, up: 5 });
      debris.sparks(position.clone().setY(0.5), { count: 40, speed: 9 });
      debris.dust(position.clone().setY(1), { size: 7, life: 2.2, color: 0x3a2e28 });
      const near = Math.max(0.2, 1 - position.distanceTo(this.hero.position) / 30);
      this.trauma = Math.min(1, this.trauma + strength * near * 0.7);
      audio.crash(0.4 + near * strength * 0.6);
      this.sfx?.explosion(0.4 + near * strength * 0.6, this._placeOf(position).pan);
    });
    on("tremor", ({ strength }) => {
      this.trauma = Math.min(1, this.trauma + strength * 0.55);
      audio.crash(0.25 + strength * 0.3);
      this.sfx?.distantCollapse(0.5 + strength * 0.5);
      if (this.phase === "roof") hud.toast("THE BUILDING IS GOING", "", "warn", 1400);
    });
    on("roof-fire", ({ position }) => {
      debris.sparks(position.clone().setY(0.3), { count: 20, speed: 4 });
      audio.crash(0.15);
    });
  }

  /**
   * The story's jump for the ladder: the leap starts, time slows, and the
   * latch reaction decides it. Caught: the existing leap-and-hang ending.
   * Missed: you fall (the story layer's death), then you're back on the
   * roof just before the jump - and the helicopter is still there, its
   * window held open for the retry.
   */
  _startLadderLatch() {
    const layer = this.story.layer;
    if (this.phase !== "roof" || layer.active) return;
    this.phase = "latch";
    this.runner.firing = false;
    const hero = this.hero;
    this._latch = { from: hero.position.clone(), fall: 0 };
    this.hud.setPrompt(null);
    // The reaction keys have the screen: no banner over them, no HUD behind.
    this.hud.hideBanner();
    this.audio.whoosh();
    layer.play(
      {
        id: "ladderLatch",
        letterbox: false,
        hideHud: true,
        skippable: false,
        duration: 0.7,
        reactions: [{ at: 0.3, id: "latch", spec: latchReaction(), lead: 0.3, slow: 0.15 }],
      },
      {
        camera: null,
        deathSeconds: 1.7,
        deathLine: STORY_LINES.fallen[0],
        on: {
          fail: () => {
            this._latch.falling = true;
            if (this.sfx) this.sfx.fallScream();
            else this.audio.scream?.();
          },
          retry: () => {
            // Back on the roof just before the jump; it waits for you.
            layer.stop();
            hero.position.copy(this._latch.from);
            hero.velocity.set(0, 0, 0);
            this.roof.holdExtraction?.();
            this.phase = "roof";
            this.snapCamera = true;
            this._latch = null;
          },
          done: () => {
            this._latch = null;
            this.phase = "roof";
            if (!this.roof.grab(hero.position)) this.hud.toast("TOO LATE", "", "warn");
          },
        },
      }
    );
  }

  /** The story's ending (ending-director.js), then the usual summary. */
  _startFinale(title) {
    this.phase = "finale";
    this.runner.firing = false;
    this.ui.letterbox.classList.remove("on");
    // The ending is a film: nothing of the fight stays on screen - no
    // section title, no toasts, no prompt, no HUD panels (story.css hides
    // every level's HUD under body.story-cutscene).
    this.hud.hideBanner();
    this.hud.toasts.replaceChildren();
    this.hud.setPrompt(null);
    // The flight-record beacons are a game thing; the hero shots don't need them.
    if (this.files) this.files.root.visible = false;
    this.sphereImpact.clear();
    document.body.classList.add("story-cutscene", "finale-film");
    this.finale?.dispose();
    this.finale = new EndingDirector(this, this.story, () => {
      document.body.classList.remove("story-cutscene", "finale-film");
      this.finale?.dispose();
      this.finale = null;
      this.phase = "ending";
      this._roofSummary(true, title);
    });
    this.events.emit("phase", { phase: "finale" });
  }

  _startCutscene() {
    this.phase = "ending";
    this.runner.firing = false;
    this.ui.letterbox.classList.add("on");
    this.hud.vitals.style.visibility = "hidden";
    this.hud.setPrompt(null);
  }

  _onRoofBreakable(object, point, ball) {
    const { roof, debris, audio, hud, runner: r } = this;
    const result = roof.breakTarget(object, ball.power, this.avatar.root.position);
    if (!result) return true;
    if (result.kind === "sack") {
      if (result.partial) return true;
      r.balls = Math.min(MAX_BALLS, r.balls + (result.spheres ?? 0));
      debris.burst(result.position, { kind: "sack", count: 26, speed: 4 });
      this._chunks(result.position, 14, { tint: 0xd8f6ff, speed: 3.5 });
      this.sfx?.glassBreak();
      this.sfx?.sphereCollected();
      hud.toast("SPHERES", `+${result.spheres}`);
      audio.glassShatter(false);
      audio.pickup();
      return true;
    }
    // A canister's blast is handled by its event (the level's, roof.js).
    if (result.kind === "canister") return true;
    if (result.kind === "powerup") {
      this._applyPowerup(result.powerupKind);
      debris.sparks(result.position, { count: 30 });
      this._chunks(result.position, 18, { tint: 0xfff0a8, speed: 4.5 });
      this.sfx?.glassBreak();
      this.sfx?.serumCollected();
      audio.powerup();
      return true;
    }
    // A ball into a person: an impact, a burst, a stagger - not a shatter.
    debris.burst(point, { kind: "concrete", count: result.partial ? 6 : 12, speed: 3, size: 0.1 });
    debris.dust(point, { size: result.partial ? 1.2 : 2.2, life: 0.7, color: 0x5a2a22 });
    debris.sparks(point, { count: 8, speed: 3 });
    audio.thud();
    this.sfx?.impact(result.partial ? 0.4 : 0.7);
    r.breaks += result.partial ? 0 : 1;
    if (!result.partial) r.downs += 1;
    return true;
  }

  _updateRoofCamera(dt) {
    // High and behind (south of) the player, looking north over their head,
    // leaning a little toward where they aim.
    const { hero, camera } = this;
    const V = this._v;
    V.desired.copy(hero.position).add(_roofCam);
    V.look.copy(hero.position).add(_roofLook).lerp(hero.aim, 0.16);
    this._follow(V.desired, 60, dt);
    if (this.snapCamera) V.smoothedLook.copy(V.look);
    else V.smoothedLook.lerp(V.look, 1 - Math.exp(-dt * 10));
    camera.up.copy(UP);
    camera.lookAt(V.smoothedLook);
    // Overdrive (a serum) widens the view, as in every level.
    const fov = BASE_FOV + this.arsenal.level("overdrive") * (this.reducedMotion ? 3 : 9);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
    this._shake(dt, 0.4, 0.3, 0);
    this.snapCamera = false;
    this.roof?.updateOcclusion(camera.position, dt, this.phase === "roof");
  }

  _roofHit(hit) {
    const { runner: r, hero } = this;
    if (r.invulnerable > 0 || this.phase !== "roof") return;
    if (this.arsenal.absorb()) {
      r.invulnerable = 0.8;
      this.debris.sparks(this.avatar.root.position.clone().setY(1.2), { count: 20 });
      this.hud.toast(this.arsenal.shieldCharges > 0 ? "SHIELD ABSORBED" : "SHIELD BROKEN", "", "power", 1400);
      return;
    }
    r.vitality = Math.max(0, r.vitality - hit.damage);
    r.hits += 1;
    r.invulnerable = 1.0;
    hero.knock.subVectors(hero.position, hit.from).setY(0).normalize().multiplyScalar(hit.knock);
    this.trauma = Math.min(1, this.trauma + (hit.source === "patient" ? 0.8 : 0.45));
    this.hitFlash = 1;
    this.hud.flashDamage();
    this.hud.toast(hit.source === "fire" ? "BURNING" : "HIT", "", "warn");
    this.audio.stumble();
    this.sfx?.impact(hit.source === "patient" ? 1 : 0.7);
    this.sfx?.hurt(hit.source === "patient" ? 1.1 : 0.85);
    this.debris.sparks(this.avatar.root.position.clone().setY(1.2), { count: 16 });
    if (r.vitality <= 0) {
      r.alive = false;
      this._roofSummary(false, "THEY GOT YOU");
    }
  }

  /** Off the edge of the roof: down past the facade, and that's the run. */
  _roofFell() {
    const r = this.runner;
    // Down an open hatch, or off an open ledge.
    const hatch = this.roof?.overHatch(this.hero.position);
    r.alive = false;
    r.vitality = 0;
    r.firing = false;
    this.trauma = 1;
    if (this.sfx) this.sfx.fallScream();
    else this.audio.scream?.();
    this.hud.toast(hatch ? "DOWN A HATCH" : "YOU FELL", "", "warn", 2400);
    this._roofSummary(false, hatch ? "DOWN A HATCH" : "YOU FELL");
  }

  _roofSummary(escaped, title) {
    const r = this.runner;
    this._end(escaped, title, [
      ["Total time", `${this.clock.toFixed(1)}s`],
      ["On the roof", `${this.roofClock.toFixed(1)}s`],
      ["Shot down (both phases)", r.downs],
      ["Sent over the edge", this.roof ? this.roof.state.falls : 0],
      ["Hits taken", r.hits],
      ["Spheres left", r.balls, true],
    ], escaped ? "YOU GOT OUT" : "THE ROOF");
  }

  _updateRoofFrame(dt, time) {
    const { roof, hero, avatar, runner: r } = this;
    const cut = roof.cutscene;
    const slow = this.phase === "ending" && cut ? cut.timeScale : 1;
    const sdt = dt * slow;
    if (this.phase === "roof") this.roofClock += dt;

    if (this.phase === "roofArrive") {
      roof.update({ dt, time, player: hero.position, playerVelocity: hero.velocity });
      const c = roof.cutscene;
      if (c) this._applyCutscene(c, dt);
      if (!c || c.done) {
        this.phase = "roof";
        hero.position.copy(ROOF_SPAWN);
        this.events.emit("phase", { phase: "roof-fight" });
      }
    } else if (this.phase === "roof") {
      // Movement, camera-relative (the camera looks down -Z).
      const held = this.held;
      const ix = (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) - (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
      const iz = (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0) - (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0);
      const input = _input.set(ix, 0, iz);
      if (input.lengthSq() > 1) input.normalize();
      hero.velocity.lerp(input.multiplyScalar(ROOF_SPEED * (this.arsenal.isActive("overdrive") ? 1.25 : 1)), 1 - Math.exp(-dt * 12));
      hero.dodge = Math.max(0, hero.dodge - dt);
      hero.dodgeCooldown = Math.max(0, hero.dodgeCooldown - dt);
      hero.knock.multiplyScalar(Math.max(0, 1 - dt * 6));
      hero.position.addScaledVector(hero.velocity, dt).addScaledVector(hero.knock, dt);
      if (hero.dodge > 0) hero.position.addScaledVector(hero.dodgeDir, DODGE_SPEED * dt);
      roof.clampPlayer(hero.position);
      // Underfoot: the roof - or, past an open ledge, nothing: you fall.
      const ground = roof.groundAt(hero.position);
      hero.vy = hero.vy ?? 0;
      if (ground !== null && hero.position.y >= ground - 0.3 && hero.vy <= 0) {
        hero.position.y = ground;
        hero.vy = 0;
      } else {
        hero.vy -= ROOF_GRAVITY * dt;
        hero.position.y += hero.vy * dt;
      }
      if (hero.position.y < ROOF_FALL_LIMIT && r.alive) this._roofFell();
      this.aimPlane.constant = -(hero.position.y + 1.15);

      // Aim: an enemy or sack under the cursor, else a point at chest height.
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(roof.breakables, false)[0];
      if (hit) hero.aim.copy(hit.point);
      else if (!this.raycaster.ray.intersectPlane(this.aimPlane, hero.aim)) hero.aim.copy(hero.position).add(_ahead);
      this.ui.reticle.classList.toggle("hot", Boolean(hit));

      // Face the aim while shooting, otherwise the way you move.
      hero.lastShot += dt;
      const face = hero.lastShot < 0.6 || r.firing ? _face.copy(hero.aim).sub(hero.position) : hero.velocity.lengthSq() > 0.5 ? _face.copy(hero.velocity) : null;
      if (face) {
        const want = Math.atan2(-face.x, -face.z);
        let delta = want - hero.yaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        hero.yaw += delta * Math.min(1, dt * 14);
      }
      avatar.root.position.copy(hero.position);
      avatar.root.rotation.y = hero.yaw;
      const speed = hero.velocity.length() + (hero.dodge > 0 ? DODGE_SPEED : 0);
      avatar.update(dt, { speed, lateralVel: 0, height: hero.vy < -1 ? 1 : 0, sliding: hero.dodge > 0, aiming: r.firing });

      const hits = roof.update({ dt, time, player: hero.position, playerVelocity: hero.velocity });
      for (const h of hits) this._roofHit(h);
      this._updateRoofCamera(dt);
      // Endless: a supply drop every so often you hold out.
      if (this.mode === "endless-roof" && r.alive) {
        this._supply = (this._supply ?? 0) + dt;
        if (this._supply >= SUPPLY_SECONDS) {
          this._supply -= SUPPLY_SECONDS;
          r.balls = Math.min(MAX_BALLS + SUPPLY_SPHERES, r.balls + SUPPLY_SPHERES);
          this.hud.toast("SUPPLY DROP", `+${SUPPLY_SPHERES} SPHERES`, "power", 2400);
          this.sfx?.sphereCollected();
          this.audio.pickup();
          this.debris.burst(hero.position.clone().setY(hero.position.y + 1.2), { kind: "ball", count: 5, speed: 2.5, up: 3 });
        }
      }
    } else if (this.phase === "finale") {
      // The story's ending: the roof burns on under the departing cabin.
      roof.update({ dt, time, player: hero.position, playerVelocity: hero.velocity });
      this.finale?.update(dt, time);
    } else if (this.phase === "latch") {
      // The story's latch: the world holds (the helicopter's window too)
      // while the keys are up. A miss: over the edge and down.
      const l = this._latch;
      if (l?.falling) {
        l.fall += dt;
        hero.position.x += dt * 2.2;
        hero.position.y = -4.9 * l.fall * l.fall;
      } else {
        // The leap toward the ladder, slowed right down.
        hero.position.x += dt * 0.4;
        hero.position.y = Math.min(0.9, hero.position.y + dt * 1.5);
      }
      avatar.root.position.copy(hero.position);
      avatar.update(dt * 0.3, { speed: 0, height: 1, aiming: false });
      avatar.reachUp = l?.falling ? 0.3 : 0.8;
      this._updateRoofCamera(dt);
    } else {
      roof.update({ dt: sdt, time, player: hero.position, playerVelocity: hero.velocity });
      if (cut && cut.kind !== "arrival") {
        this._applyCutscene(cut, dt, sdt);
        if (cut.done && this.phase === "ending") {
          this.avatar.hold = 1;
          this.avatar.reachUp = 0;
          const title = roof.state.ending === "victory" ? "EXTRACTED" : "BARELY OUT";
          // The story: the pilot, the reveal, the title and the credits first.
          if (this.story) this._startFinale(title);
          else this._roofSummary(true, title);
        }
      } else {
        this._updateRoofCamera(dt);
      }
    }

    this._placeLauncher(false);
    this._placeKeyLight(hero.position);
    this.police?.update(dt, time, { worldZ: (d) => 70 - d, distance: 0, deckY: 0, overDeck: true, cityY: -60, spotZ: 0, spotSpread: 14 });
    // Balls fly through the cutscene's slow motion too.
    this.projectiles.update(sdt, { breakables: roof.breakables, solids: roof.solids, onBreakable: (o, p, b) => this._onBallHit(o, p, b), onSolid: (o, p, b) => this._onBallSolid(o, p, b), onFloor: (p, b) => this._onBallFloor(p, b) });
    this.debris.update(sdt);
    this.shatter.update(sdt);
    this.sphereImpact.update(sdt);
    this._updateFiles(sdt, time, this.phase === "roof" ? this.hero.position : null);
    // Walk into a sphere cache or a serum on the roof (the supply drop's) to take it.
    if (this.phase === "roof") {
      for (const target of roof.breakables.slice()) {
        const kind = target.userData.kind;
        if ((kind !== "sack" && kind !== "powerup") || !target.userData.alive) continue;
        target.getWorldPosition(this._v.sfxPos);
        if (this._v.sfxPos.setY(0).distanceTo(this.hero.position) < 1.4) {
          this._onRoofBreakable(target, this._v.sfxPos.clone().setY(1), { power: 99, velocity: new THREE.Vector3(), kind: "glass" });
        }
      }
    }
    this.launcher.muzzle.getWorldPosition(this._v.muzzle);
    this.beam.update(dt, { origin: this._v.muzzle, target: hero.aim, darkness: 0, time, projectiles: this.projectiles });
    this.audio.setRotor(roof.rotorLevel);
  }

  _updateRoofPresentation(dt, time, playing) {
    const { runner: r, roof } = this;
    const danger = THREE.MathUtils.clamp(1 - r.vitality / START_VITALITY, 0, 1);
    this.hud.setDanger(danger);
    // The roof coming apart: thicker smoke, heat haze, louder everything.
    const chaos = roof?.state.chaos ?? 0;
    this.scene.fog.density = 0.0058 + chaos * 0.007;
    // The wind across the top of the tallest tower in the city, gusting.
    this.sfx?.updateWind(playing ? 0.7 + Math.sin(time * 0.31) * 0.2 + Math.sin(time * 1.13) * 0.1 : 0.3);
    // The alarm below, through the roof hatches; your breath, moving and hurt.
    const fighting = playing && this.phase === "roof";
    this.sfx?.updateAlarm(fighting ? 0.55 : 0, 0.65);
    this.sfx?.updateBreath(fighting ? Math.min(1, this.hero.velocity.length() / 6) * 0.5 + danger * 0.4 : 0);
    // Them: one of the living ones, every few seconds, wherever it is.
    if (fighting && this.sfx && roof) {
      this._moanIn = (this._moanIn ?? 2) - dt;
      if (this._moanIn <= 0) {
        this._moanIn = 2.5 + Math.random() * 4;
        const them = roof.enemies.filter((e) => e.alive && e.kind === "patient");
        const one = them[Math.floor(Math.random() * them.length)];
        if (one) this._patientSound(Math.random() < 0.25 ? "speech" : "moan", one.position, 0.8);
      }
    }
    this.renderer.toneMappingExposure = 1.0;
    this.audio.setFireProximity(0.25 + chaos * 0.5);
    this.audio.setDanger(Math.max(danger * 0.8, chaos * 0.65));
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    const g = this.grade.uniforms;
    g.uTime.value = time;
    g.uDanger.value = danger;
    g.uDark.value = 0.15 + chaos * 0.1;
    g.uHeat.value = this.reducedMotion ? 0 : chaos * 0.35;
    g.uHit.value = this.reducedMotion ? this.hitFlash * 0.3 : this.hitFlash;
    const reticle = this.ui.reticle;
    reticle.hidden = !this.visible || this.phase !== "roof";
    reticle.classList.toggle("overheated", r.lockout > 0);
    reticle.classList.toggle("weak", r.weakened > 0);
    this.hud.setVitality(r.vitality, START_VITALITY);
    this.hud.setBalls(r.balls);
    const hint = this.phase === "roof" ? roof?.extractionHint(this.hero.position) : null;
    this.hud.setPrompt(hint === "jump" ? "SPACE - JUMP FOR THE LADDER!" : hint === "go" ? "GET TO THE EAST LEDGE" : r.balls <= 0 && playing ? "NO SPHERES" : null);
    this.hud.update({ fps: this._fps(dt), renderer: this.renderer });
  }

  /* ================================================================ */
  /* Tests and demos                                                   */
  /* ================================================================ */

  /** Jump the run to a route distance (tests, screenshots, demos). */
  teleport(distance, { camera: mode = this.cameraMode, invulnerable = 999 } = {}) {
    if (this.phase === "idle" || this.phase === "arrive") {
      this.phase = "run";
      this.cut = null;
      this.level.updateArrival(99);
    }
    const r = this.runner;
    r.distance = distance;
    r.fireDistance = distance - 30;
    r.invulnerable = invulnerable;
    this.cameraMode = mode;
    this.snapCamera = true;
  }
}

const _roofCam = new THREE.Vector3(0, 9.9, 7.3);
const _roofLook = new THREE.Vector3(0, 0.6, -3.4);
const _ahead = new THREE.Vector3(0, 1.15, -10);
const _input = new THREE.Vector3();
const _face = new THREE.Vector3();

