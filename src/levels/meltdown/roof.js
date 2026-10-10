/**
 * Level 3, Phase B - the roof.
 *
 * You come up the stairwell onto the roof of the burning building. The
 * scientists who ran the experiments are up here waiting for their own way
 * out, and they send the last of their test subjects at you. Somewhere a
 * rescue helicopter is inbound - you are never told when.
 *
 *   - Three waves, each a scientist with a gadget (ranged: telegraphs, then
 *     fires a slow orb you can dodge) who lets patients loose (melee: they
 *     stalk you, wind up, then charge in a straight line).
 *   - The east and west ledges are open: the parapet has collapsed. Sidestep
 *     a charging patient near one and they go straight over - a kill that
 *     costs no balls. Step off one yourself and you fall (the host's roof
 *     physics: `groundAt` says where there is roof under you).
 *   - The helicopter timer is hidden and random (40-58 s). The only tells
 *     are the rotor sound growing and, late, the helicopter itself.
 *   - It gets worse the longer you are up here (`chaos`): the facade
 *     explodes, the building shudders, ash fills the air, and the last wave
 *     comes all at once. No fire on the roof (the team's call).
 *   - Clear the roof: the helicopter comes down over the pad and you climb
 *     its rope ladder (victory). Still fighting when it arrives: it cannot
 *     land, so it hangs off the east ledge with the ladder down, and you
 *     have to get to the edge and jump for it before it gives up on you
 *     (survived - or left behind).
 *
 * The level owns the arena, the enemies and their AI, their projectiles, the
 * helicopter and both endings (including where the camera goes). The host
 * owns the player: movement, the launcher, vitality - exactly the split
 * Phase A uses. Everything is in world space around the origin; the host
 * hides Phase A's root while the roof is up.
 *
 *   RoofRoot
 *   |-- Set         slab, parapets, stair hut, hatches, helipad, cover, skyline
 *   |-- Hazards     smoke off the ledges, ash
 *   |-- Pickups     ball sacks
 *   |-- Enemies     scientists and patients (their hurtboxes are breakables)
 *   |-- Orbs        the scientists' shots
 *   |-- Helicopter
 *   `-- Lights      moon, sky fill, floods, the city's glow from below
 */

import * as THREE from "../../three.js";
import { createMeltdownKit, heatSignature } from "./kit.js";
import { createFireMaterials } from "./fire.js";
import { fillAssetSlots } from "./assets.js";
import { cloneCharacter, HumanoidRig } from "./characters.js";
import { Helicopter } from "./helicopter.js";
import { createLift, ROOF_LIFT } from "./elevator.js";
import { photoReady, applyPhotoSet, PHOTO_SETS } from "./photo-textures.js";
import { CityAtNight } from "./city.js";
import { createPropKit } from "../../story/stages/props.js";

/** Half-size of the roof. Parapets at z = +/-EDGE; open ledges at x = +/-EDGE. */
export const EDGE = 16;
const WALK_LIMIT = EDGE - 0.7;
const HELIPAD = new THREE.Vector3(0, 0, -8);
export const ROOF_SPAWN = new THREE.Vector3(0, 0, 8);
/** The lift housing's doorway (the lift you come up in; see elevator.js). */
const LIFT_DOOR = new THREE.Vector3(0, 0, EDGE - 3.1);
/** Seconds of the arrival: doors open, you walk out, the camera settles. */
const ARRIVAL_SECONDS = 3.4;
const ARRIVAL_CUT = 2.9;
/** Where the arrival hands the camera over: the host's roof camera offsets. */
const ARRIVAL_CAMERA = new THREE.Vector3(0, 11.5, 8.5);
const ARRIVAL_LOOK = new THREE.Vector3(0, 0.6, -3.4);

const HATCHES = [new THREE.Vector3(-10, 0, 3), new THREE.Vector3(10, 0, -1), new THREE.Vector3(-6, 0, -12), new THREE.Vector3(8, 0, 10)];
/** Half the hatch opening (1.2 m) less a little: your feet have to be over the hole, not the rim. */
const HATCH_HOLE = 0.5;
const MACHINE_DOOR = new THREE.Vector3(12.5, 0, -12.5);

/** Seconds the helicopter waits at the ledge for you to jump for the ladder. */
export const EXTRACT_WINDOW = 16;

const PATIENT = { hp: 2, stalk: 2.3, charge: 10, windup: 0.62, chargeRange: 22, damage: 14, notice: 12 };
const SCIENTIST = { hp: 3, walk: 2.8, aim: 0.85, orbSpeed: 11, damage: 10 };
/** The last wave's brute: a bigger subject, slower to wind up, much harder to stop. */
const BRUTE = { hp: 6, stalk: 2.0, charge: 12, windup: 0.85, chargeRange: 24, damage: 24, notice: 14 };
/** Gas canisters by the cover: shoot one and everything near it goes down (you too, if you're close). */
const CANISTERS = [new THREE.Vector3(-12.5, 0, 7.5), new THREE.Vector3(11.5, 0, -6.5), new THREE.Vector3(-7, 0, -6), new THREE.Vector3(5, 0, 13)];
export const CANISTER_RADIUS = 4.5;
/** Where a supply drop can come down: open roof, clear of the cover. */
const DROP_SPOTS = [new THREE.Vector3(-12, 0, -9), new THREE.Vector3(0.5, 0, 4), new THREE.Vector3(6, 0, 3), new THREE.Vector3(-3, 0, 9)];
const DROP_HEIGHT = 38;

function rng(seed) {
  // Scramble the seed and throw the first draws away: a Lehmer generator's
  // first output tracks a small seed almost linearly, which made the
  // "random" helicopter timer land within a few seconds every attempt.
  let value = (Math.floor(Math.abs(seed) * 2654435761) % 2147483646) + 1;
  const next = () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
  for (let i = 0; i < 4; i += 1) next();
  return next;
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

/* ------------------------------------------------------------------ */
/* Canvas textures                                                      */
/* ------------------------------------------------------------------ */

function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d"), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 4;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * An AC unit's housing: grey-green sheet steel, a louvred grille across the
 * middle, rust streaks running down from the rivets, grime at the foot.
 */
function acHousingTexture() {
  return canvasTexture(256, (ctx, s) => {
    const r = rng(91);
    ctx.fillStyle = "#4a524c";
    ctx.fillRect(0, 0, s, s);
    // Panel seams and rivets.
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(6, 6, s - 12, s - 12);
    ctx.beginPath(); ctx.moveTo(s / 2, 6); ctx.lineTo(s / 2, s * 0.22); ctx.stroke();
    // Louvres.
    for (let y = s * 0.26; y < s * 0.8; y += 9) {
      ctx.fillStyle = "#1c201e";
      ctx.fillRect(22, y, s - 44, 5);
      ctx.fillStyle = "rgba(160,170,160,0.35)";
      ctx.fillRect(22, y + 5, s - 44, 1.5);
    }
    // Rust running down, grime at the foot.
    for (let i = 0; i < 14; i += 1) {
      const x = 10 + r() * (s - 20);
      const g = ctx.createLinearGradient(0, 10, 0, 10 + 60 + r() * 120);
      g.addColorStop(0, "rgba(110,55,25,0.55)");
      g.addColorStop(1, "rgba(110,55,25,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, 10, 2 + r() * 3, 200);
    }
    const foot = ctx.createLinearGradient(0, s * 0.8, 0, s);
    foot.addColorStop(0, "rgba(0,0,0,0)");
    foot.addColorStop(1, "rgba(15,12,10,0.75)");
    ctx.fillStyle = foot;
    ctx.fillRect(0, s * 0.8, s, s * 0.2);
  });
}

/** Tar-and-gravel roofing, with seams. */
function roofingTexture() {
  return canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = "#3a3734";
      ctx.fillRect(0, 0, s, s);
      const r = rng(77);
      const image = ctx.getImageData(0, 0, s, s);
      for (let i = 0; i < image.data.length; i += 4) {
        const n = (r() - 0.5) * 46;
        image.data[i] += n;
        image.data[i + 1] += n;
        image.data[i + 2] += n;
      }
      ctx.putImageData(image, 0, 0);
      ctx.strokeStyle = "rgba(10,9,8,0.8)";
      ctx.lineWidth = 3;
      for (const y of [0, 128]) {
        ctx.beginPath();
        ctx.moveTo(0, y + 1);
        ctx.lineTo(s, y + 1);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 9; i += 1) {
        ctx.beginPath();
        ctx.ellipse(r() * s, r() * s, 8 + r() * 26, 5 + r() * 14, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeat: [8, 8] }
  );
}

/** The helipad marking: a yellow ring and an H. */
function helipadTexture() {
  return canvasTexture(512, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = "#23262a";
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.49, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e5b52a";
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.41, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#e8e4d8";
    const w = s * 0.07;
    ctx.fillRect(s * 0.33, s * 0.28, w, s * 0.44);
    ctx.fillRect(s * 0.67 - w, s * 0.28, w, s * 0.44);
    ctx.fillRect(s * 0.33, s * 0.465, s * 0.34, w);
    // Scuffs, so it has been used.
    const r = rng(5);
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 40; i += 1) {
      ctx.fillStyle = `rgba(80,70,60,${0.1 + r() * 0.2})`;
      ctx.fillRect(r() * s, r() * s, 4 + r() * 40, 2 + r() * 6);
    }
  });
}

/** A lit-window facade for the city, and the building under you. */
function windowsTexture(seed, litRatio = 0.3) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = "#07080a";
    ctx.fillRect(0, 0, s, s);
    const r = rng(seed);
    const cols = 8;
    const rows = 16;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const lit = r() < litRatio;
        const warm = r() < 0.8;
        ctx.fillStyle = lit ? (warm ? `rgba(255,${180 + r() * 50},${90 + r() * 60},${0.5 + r() * 0.5})` : "rgba(160,200,255,0.7)") : "rgba(20,24,30,1)";
        ctx.fillRect(x * (s / cols) + 5, y * (s / rows) + 3, s / cols - 10, s / rows - 7);
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Sky                                                                  */
/* ------------------------------------------------------------------ */

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SKY_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float h = vDir.y;
    // Night sky, orange at the horizon from a city lit from below; drifting
    // smoke across it.
    vec3 top = vec3(0.012, 0.016, 0.035);
    vec3 horizon = vec3(0.1, 0.06, 0.05);
    vec3 col = mix(horizon, top, smoothstep(-0.05, 0.45, h));
    vec2 p = vDir.xz / max(0.15, h + 0.3) * 1.6 + vec2(uTime * 0.02, uTime * 0.01);
    float smoke = noise(p) * 0.6 + noise(p * 2.7) * 0.4;
    col = mix(col, vec3(0.07, 0.05, 0.045), smoothstep(0.45, 0.85, smoke) * 0.7 * smoothstep(-0.1, 0.3, h));
    // A few stars through the gaps.
    vec2 sp = floor(vDir.xz / (h + 1.0) * 380.0);
    float star = step(0.9975, hash(sp)) * smoothstep(0.25, 0.6, h) * (1.0 - smoothstep(0.4, 0.7, smoke));
    col += star * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/* Enemies                                                              */
/* ------------------------------------------------------------------ */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

class Enemy {
  constructor(level, { kind, model, position, hp }) {
    this.level = level;
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.name = kind === "patient" ? "RoofPatient" : "Scientist";
    this.root.position.copy(position);
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.position = this.root.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.hp = hp;
    this.maxHp = hp;
    this.state = "idle";
    this.t = 0;
    this.stagger = 0;
    this.alive = true;
    this.removed = false;
    this.rig = null;

    if (model) {
      this.model = model;
      this.body.add(model);
      const rig = new HumanoidRig(model);
      this.rig = rig.valid ? rig : null;
      heatSignature(model);
    } else {
      this.body.add(level.kit.personStandIn());
    }

    // The hurtbox is what balls hit; it follows the body.
    this.hurt = new THREE.Mesh(level.kit.geometries.unitBox, level.kit.materials.collider);
    this.hurt.scale.set(0.9, 1.9, 0.8);
    this.hurt.position.y = 0.95;
    this.hurt.userData = { kind: "enemy", breakable: true, alive: true, enemy: this };
    this.root.add(this.hurt);
  }

  face(target, dt, rate = 8) {
    _v.subVectors(target, this.position);
    const want = Math.atan2(_v.x, _v.z);
    let delta = want - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.yaw += delta * Math.min(1, dt * rate);
    this.body.rotation.y = this.yaw;
  }

  /** Returns true if this hit took them down. */
  hit(power, from) {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - power);
    this.stagger = 1;
    if (from) {
      _v.subVectors(this.position, from).setY(0).normalize();
      this.velocity.addScaledVector(_v, 2.5);
    }
    if (this.hp > 0) return false;
    this.die("down");
    return true;
  }

  die(how) {
    this.alive = false;
    this.hurt.userData.alive = false;
    this.state = how;
    this.t = 0;
  }

  /** Push out of cover and keep on the roof (patients can leave by the ledge). */
  collide(radius = 0.45) {
    this.level.resolveCircle(this.position, radius);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -WALK_LIMIT, WALK_LIMIT);
  }

  updateDown(dt) {
    const k = Math.min(1, this.t / 0.8);
    this.body.rotation.x = -k * k * Math.PI * 0.47;
    this.velocity.multiplyScalar(Math.max(0, 1 - dt * 4));
    this.position.addScaledVector(this.velocity, dt);
    this.rig?.pose({ headNod: -0.6 * k, elbow: 0.9, lean: -0.4 * k, spread: 0.18 * k });
  }
}

class Patient extends Enemy {
  constructor(level, opts) {
    super(level, { ...opts, kind: "patient", hp: (opts.brute ? BRUTE : PATIENT).hp });
    this.stats = opts.brute ? BRUTE : PATIENT;
    if (opts.brute) {
      // Bigger, and harder to stop.
      this.root.scale.setScalar(1.3);
      this.brute = true;
    }
    this.state = "emerge";
    this.hatch = opts.position.clone();
    this.position.y = -1.7;
    // A climber comes up the outside of the building and over an open ledge
    // (x = +/-EDGE) instead of out of a hatch.
    this.climb = opts.climb ?? 0;
    if (this.climb) this.position.x = this.climb * (EDGE + 0.5);
    this.cooldown = 0.5 + opts.delay;
    this.dir = new THREE.Vector3();
    this.travelled = 0;
    this.phase = Math.random() * 10;
  }

  update(dt, time, ctx) {
    this.t += dt;
    this.stagger = Math.max(0, this.stagger - dt * 2.5);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const player = ctx.player;
    const rig = this.rig;

    switch (this.state) {
      case "emerge": {
        // Hauling themselves up out of the hatch.
        const k = Math.min(1, this.t / (this.climb ? 1.8 : 1.3));
        this.position.y = THREE.MathUtils.lerp(-1.7, 0, 1 - (1 - k) * (1 - k));
        if (this.climb) this.position.x = this.climb * THREE.MathUtils.lerp(EDGE + 0.5, EDGE - 1.4, Math.max(0, k * 1.4 - 0.4));
        this.face(player, dt, 4);
        rig?.pose({ reach: (this.climb ? 1.4 : 1.1) - k * 0.4, lean: 0.4, headNod: 0.3, phase: time * 6, stride: 0.2 * (1 - k) });
        if (k >= 1) this.setState("stalk");
        break;
      }
      case "stalk": {
        this.face(player, dt, 5);
        _v.subVectors(player, this.position).setY(0);
        const d = _v.length();
        if (d > 1.2) this.position.addScaledVector(_v.divideScalar(d), this.stats.stalk * dt);
        this.position.addScaledVector(this.velocity, dt);
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
        this.collide();
        this.position.x = THREE.MathUtils.clamp(this.position.x, -WALK_LIMIT, WALK_LIMIT);
        rig?.pose({ phase: time * 4.2 + this.phase, stride: 0.35, knee: 0.6, reach: 0.9, lean: 0.3, headTilt: Math.sin(time * 1.7 + this.phase) * 0.3 });
        if (d < this.stats.notice && this.cooldown <= 0 && !ctx.frozen && this.level.clearLine(this.position, player)) {
          this.setState("windup");
          this.level.events.emit("patient-windup", { position: this.position.clone() });
        }
        break;
      }
      case "windup": {
        // The telegraph: a crouch and a scream, arms thrown back. The
        // direction locks at the end - move and they miss.
        this.face(player, dt, 10);
        const k = Math.min(1, this.t / this.stats.windup);
        rig?.pose({ crouch: 0.35 * k, lean: 0.5 * k, reach: -0.6 * k, headNod: -0.5 * k, elbow: 0.2 });
        this.body.position.x = Math.sin(time * 60) * 0.02 * k;
        if (this.t >= this.stats.windup) {
          this.dir.subVectors(player, this.position).setY(0).normalize();
          this.yaw = Math.atan2(this.dir.x, this.dir.z);
          this.body.rotation.y = this.yaw;
          this.body.position.x = 0;
          this.travelled = 0;
          this.setState("charge");
          this.level.events.emit("patient-charge", { position: this.position.clone() });
        }
        break;
      }
      case "charge": {
        const step = this.stats.charge * dt;
        this.position.addScaledVector(this.dir, step);
        this.travelled += step;
        rig?.pose({ phase: time * 13 + this.phase, stride: 0.7, knee: 1.1, lean: 0.55, reach: 0.4, armSwing: 0.2 });
        // Straight off the open ledge.
        if (Math.abs(this.position.x) > EDGE - 0.1) {
          this.velocity.copy(this.dir).multiplyScalar(this.stats.charge * 0.7);
          this.die("fall");
          this.level.events.emit("enemy-fall", { enemy: this, position: this.position.clone() });
          break;
        }
        if (!ctx.frozen && this.position.distanceTo(_w.copy(player).setY(0)) < 0.95) {
          ctx.hits.push({ damage: this.stats.damage, from: this.position.clone(), knock: 7, source: "patient" });
          this.setState("recover");
          break;
        }
        if (this.level.blocked(this.position, 0.45) || Math.abs(this.position.z) > WALK_LIMIT) {
          // Into cover or a parapet: stunned for a moment. Shoot them now.
          this.collide();
          this.setState("stunned");
          this.level.events.emit("patient-stunned", { position: this.position.clone() });
          break;
        }
        if (this.travelled > this.stats.chargeRange) this.setState("recover");
        break;
      }
      case "recover":
      case "stunned": {
        const hold = this.state === "stunned" ? 1.5 : 0.9;
        rig?.pose({ lean: 0.2 - this.stagger * 0.6, headNod: 0.6, headTilt: Math.sin(this.t * 9) * 0.3, reach: 0.2, elbow: 0.7 });
        this.position.addScaledVector(this.velocity, dt);
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
        this.collide();
        if (this.t > hold) {
          this.cooldown = 1.2;
          this.setState("stalk");
        }
        break;
      }
      case "fall": {
        // Over the edge: gravity, a tumble, gone.
        this.velocity.y -= 22 * dt;
        this.position.addScaledVector(this.velocity, dt);
        this.body.rotation.x -= dt * 3.2;
        this.body.rotation.z += dt * 1.3;
        rig?.pose({ reach: 1.3, spread: 0.3, headNod: -0.5, elbow: 0.2, phase: time * 20, stride: 0.4 });
        if (this.position.y < -40) this.removed = true;
        break;
      }
      case "down":
        this.updateDown(dt);
        break;
      default:
        break;
    }
    if (this.stagger > 0 && this.alive && this.state !== "charge") {
      this.body.rotation.x = -this.stagger * 0.3;
    } else if (this.alive) this.body.rotation.x = 0;
  }

  setState(state) {
    this.state = state;
    this.t = 0;
  }
}

class Scientist extends Enemy {
  constructor(level, opts) {
    super(level, { ...opts, kind: "scientist", hp: SCIENTIST.hp });
    this.state = opts.enter ? "enter" : "release";
    this.target = new THREE.Vector3().copy(opts.enter ?? opts.position);
    this.random = rng(opts.seed ?? 3);
    this.cooldown = 1;
    this.phase = Math.random() * 10;
    this.gadget = opts.gadget ?? null;
    this.charge = 0;
    // The gadget glows before it fires - that is the tell.
    this.glowMaterial = new THREE.MeshBasicMaterial({ color: 0x7ef4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow = new THREE.Mesh(level.kit.geometries.unitSphere, this.glowMaterial);
    this.glow.scale.setScalar(0.5);
    this.root.add(this.glow);
    if (this.gadget && this.rig?.bones.handR) {
      this.rig.bones.handR.add(this.gadget);
    }
  }

  handPosition(target) {
    const hand = this.rig?.bones.handR;
    if (hand) return hand.getWorldPosition(target);
    return target.copy(this.position).add(_v.set(Math.sin(this.yaw) * 0.5, 1.4, Math.cos(this.yaw) * 0.5));
  }

  pickSpot(player) {
    // A point on a ring around the player, kept off the ledges.
    for (let i = 0; i < 8; i += 1) {
      const a = this.random() * Math.PI * 2;
      const r = 9 + this.random() * 4;
      this.target.set(player.x + Math.cos(a) * r, 0, player.z + Math.sin(a) * r);
      this.target.x = THREE.MathUtils.clamp(this.target.x, -EDGE + 3.5, EDGE - 3.5);
      this.target.z = THREE.MathUtils.clamp(this.target.z, -EDGE + 2.5, EDGE - 2.5);
      if (!this.level.blocked(this.target, 0.6)) return;
    }
  }

  update(dt, time, ctx) {
    this.t += dt;
    this.stagger = Math.max(0, this.stagger - dt * 2.5);
    this.cooldown = Math.max(0, this.cooldown - dt);
    const player = ctx.player;
    const rig = this.rig;
    let glow = 0;

    switch (this.state) {
      case "enter":
      case "move": {
        _v.subVectors(this.target, this.position).setY(0);
        const d = _v.length();
        if (d > 0.3) {
          this.face(this.target, dt, 6);
          this.position.addScaledVector(_v.divideScalar(d), SCIENTIST.walk * dt);
        }
        this.position.addScaledVector(this.velocity, dt);
        this.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
        this.collide();
        this.position.x = THREE.MathUtils.clamp(this.position.x, -WALK_LIMIT, WALK_LIMIT);
        rig?.pose({ phase: time * 7 + this.phase, stride: 0.45, knee: 0.8, armSwing: 0.45, lean: 0.12, aimR: 0.3 });
        if (d <= 0.3 || this.t > 5) this.setState(this.state === "enter" ? "release" : "aim");
        break;
      }
      case "release": {
        // Throws an arm at you: go.
        this.face(player, dt, 5);
        const k = Math.min(1, this.t / 1.1);
        rig?.pose({ aimL: Math.sin(k * Math.PI) * 1.2, aimR: 0.3, headNod: -0.2 });
        if (this.t > 1.1) {
          this.cooldown = 1.2;
          this.pickSpot(player);
          this.setState("move");
        }
        break;
      }
      case "aim": {
        this.face(player, dt, 8);
        const k = Math.min(1, this.t / SCIENTIST.aim);
        glow = k;
        rig?.pose({ aimR: 1, lean: -0.05, headNod: 0.1 });
        if (this.t >= SCIENTIST.aim && !ctx.frozen) {
          this.handPosition(_w);
          // Lead the target a little: standing still is how you get hit.
          const aimAt = player.clone().addScaledVector(ctx.playerVelocity, 0.35).setY(1.15);
          this.level.fireOrb(_w, aimAt);
          this.cooldown = 1.1 + this.random() * 0.8;
          this.setState("recoil");
        }
        break;
      }
      case "recoil": {
        rig?.pose({ aimR: 0.7, lean: -0.15, headNod: -0.1 });
        this.face(player, dt, 4);
        if (this.cooldown <= 0) {
          if (this.random() < 0.55) {
            this.pickSpot(player);
            this.setState("move");
          } else this.setState("aim");
        }
        break;
      }
      case "down":
        this.updateDown(dt);
        break;
      default:
        break;
    }

    if (this.alive && this.stagger > 0) {
      this.body.rotation.x = -this.stagger * 0.28;
      if (this.state === "aim") this.t = Math.min(this.t, SCIENTIST.aim * 0.3); // a hit spoils the shot
    } else if (this.alive) this.body.rotation.x = 0;

    this.handPosition(this.glow.position).sub(this.position);
    this.glowMaterial.opacity = glow * (0.6 + Math.sin(time * 40) * 0.2);
    this.glow.scale.setScalar(0.25 + glow * 0.45);
  }

  setState(state) {
    this.state = state;
    this.t = 0;
  }
}

/* ------------------------------------------------------------------ */
/* The roof                                                             */
/* ------------------------------------------------------------------ */

export class RoofLevel {
  /**
   * @param {object} o
   * @param {Map} o.assets       loaded assets (characters, helicopter, gadgets, kit models)
   * @param {number} [o.seed]    randomises the helicopter timer
   * @param {number} [o.heliSeconds] force the hidden timer (tests)
   */
  /**
   * @param {object} [o]
   * @param {boolean} [o.endless]  survival: no helicopter, waves keep coming,
   *   the roof comes apart over two minutes; it ends when you go down.
   */
  constructor({ assets = new Map(), seed = Date.now() % 100000, heliSeconds, endless = false, assetBase = null } = {}) {
    this.assets = assets;
    this.endless = endless;
    this.events = createEmitter();
    this.root = new THREE.Group();
    this.root.name = "RoofRoot";
    this.groups = {};
    for (const name of ["set", "hazards", "pickups", "enemies", "orbs", "lights"]) {
      const g = new THREE.Group();
      g.name = name[0].toUpperCase() + name.slice(1);
      this.groups[name] = g;
      this.root.add(g);
    }

    this.fire = createFireMaterials();
    this.kit = createMeltdownKit({ fire: this.fire });
    this.owned = { materials: [], textures: [], geometries: [] };
    this.random = rng(seed + 11);

    /** Box3s the player and enemies cannot pass through. */
    this.cover = [];
    /** Invisible meshes the player's balls bounce off. */
    this.solids = [];
    /** Hurtboxes and sacks. */
    this.breakables = [];
    this.enemies = [];
    this._ticking = [];

    this.state = {
      time: 0,
      wave: 0,
      heliAt: endless ? Infinity : heliSeconds ?? 40 + this.random() * 18,
      nextWaveAt: 0,
      heliSeen: false,
      heliArrived: false,
      cleared: false,
      ending: null,
      downs: 0,
      falls: 0,
      chaos: 0,
      extractT: 0,
    };

    this._buildSet();
    this._dressRoof();
    this._buildSkyline(assetBase);
    this._buildLights();
    this._buildEdges();
    this._buildPickups();
    this._buildCanisters();
    this._buildOrbs();
    this._buildHelicopter();
    this._buildChaos();
    fillAssetSlots(this.root, this.assets);
  }

  /* ---------------- Building ---------------- */

  _track(material) {
    this.owned.materials.push(material);
    return material;
  }

  /**
   * The fight camera, high behind the player: when it is close over the
   * lift housing, the housing fades to a ghost instead of filling the bottom
   * of the frame. Off (solid) for the cutscenes.
   */
  updateOcclusion(cameraPosition, dt, enabled = true) {
    if (!this._hutBox) return;
    const near = enabled && this._hutBox.distanceToPoint(cameraPosition) < 8;
    const target = near ? 0.18 : 1;
    this._hutFade += (target - this._hutFade) * Math.min(1, dt * 6);
    const solid = this._hutFade > 0.98;
    for (const m of this._hutMaterials) {
      if (m.transparent === solid) { m.transparent = !solid; m.needsUpdate = true; }
      m.opacity = solid ? 1 : this._hutFade;
      m.depthWrite = solid;
    }
  }

  _box(w, h, d, material, x, y, z, { solid = false, cover = false } = {}) {
    const mesh = this.kit.box(w, h, d, material, y, x, z);
    this.groups.set.add(mesh);
    if (solid || cover) {
      const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(w, h, d));
      if (cover) this.cover.push(box);
      const collider = new THREE.Mesh(this.kit.geometries.unitBox, this.kit.materials.collider);
      collider.scale.set(w, h, d);
      collider.position.set(x, y + h / 2, z);
      this.groups.set.add(collider);
      this.solids.push(collider);
    }
    return mesh;
  }

  _put(piece, x, y, z, rotY = 0) {
    piece.position.set(x, y, z);
    piece.rotation.y = rotY;
    this.groups.set.add(piece);
    if (typeof piece.userData.tick === "function") this._ticking.push(piece);
    return piece;
  }

  _buildSet() {
    const k = this.kit;
    const mat = k.materials;
    const roofing = this._track(new THREE.MeshStandardMaterial(photoReady({ map: roofingTexture(), roughnessMap: k.textures.floorRoughness, roughness: 1, metalness: 0.05 })));
    roofing.envMapIntensity = 0.5;
    this.owned.textures.push(roofing.map);
    // Tarred gravel (Poly Haven, CC0) when it arrives; the wet patches stay.
    applyPhotoSet(roofing, PHOTO_SETS.roofing, { repeat: [15, 15], roughness: false }); // 2.2 m a tile
    k.applyPhotos(); // the parapets' concrete, too
    // Weathered grey concrete for the roof's walls (the Labs' painted
    // concrete photo reads green up here under the floods).
    const concrete = this._track(new THREE.MeshStandardMaterial({ color: 0x75787a, map: k.textures.concreteWall, normalMap: k.textures.concreteWallNormal, roughness: 0.94, metalness: 0.02 }));

    // The slab, and the building falling away beneath it.
    this._box(EDGE * 2 + 0.6, 0.6, EDGE * 2 + 0.6, roofing, 0, -0.6, 0);
    const facade = this._track(new THREE.MeshStandardMaterial({ color: 0x3a3a3c, emissive: 0xffffff, emissiveMap: windowsTexture(19, 0.12), emissiveIntensity: 0.9, roughness: 0.9 }));
    // All the way down, into the haze (the city's streets are 160 m below).
    facade.emissiveMap.repeat.set(3, 26);
    this.owned.textures.push(facade.emissiveMap);
    this._box(EDGE * 2 - 0.2, 300, EDGE * 2 - 0.2, facade, 0, -300.6, 0);

    // Parapets north and south; the east and west ones have collapsed.
    for (const z of [-EDGE, EDGE]) {
      this._box(EDGE * 2 + 0.6, 1.0, 0.45, concrete, 0, 0, z, { solid: true, cover: true });
      this._box(EDGE * 2 + 0.6, 0.12, 0.6, mat.trim, 0, 1.0, z);
    }
    for (const x of [-EDGE, EDGE]) {
      // Stubs of the fallen parapet at the corners, rubble on the lip, and
      // a painted warning line you will learn to respect.
      for (const z of [-EDGE + 1.2, EDGE - 1.2]) this._box(0.45, 0.9, 2.4, concrete, x, 0, z, { solid: true, cover: true });
      this._box(0.3, 0.02, EDGE * 2 - 4, mat.hazard, x - Math.sign(x) * 0.6, 0.005, 0);
      const r = rng(Math.round(x + 40));
      for (let i = 0; i < 7; i += 1) {
        const rock = new THREE.Mesh(k.geometries.rock, mat.rubbleDark);
        const s = 0.25 + r() * 0.45;
        rock.scale.set(s * 1.4, s, s);
        rock.position.set(x - Math.sign(x) * r() * 0.8, s * 0.3, (r() - 0.5) * (EDGE * 2 - 6));
        rock.rotation.set(r(), r() * 3, r());
        this.groups.set.add(rock);
      }
    }

    // The lift housing you come up in, doors facing the roof: a hollow hut
    // (so the open doors show the cabin) around a placeholder lift.
    const hutZ = LIFT_DOOR.z + 1.4;
    const hutH = 3.5;
    // Its own materials, so it can fade when the fight camera is right over
    // it (it sits just in front of the camera at the start of every wave).
    const hutConcrete = this._track(concrete.clone());
    const hutTrim = this._track(mat.trim.clone());
    this._hutMaterials = [hutConcrete, hutTrim];
    this._hutFade = 1;
    this._hutBox = new THREE.Box3(new THREE.Vector3(-2.7, 0, LIFT_DOOR.z - 0.1), new THREE.Vector3(2.7, hutH + 0.3, hutZ + 1.5));
    this._box(5, hutH, 2.8, mat.collider, 0, 0, hutZ, { solid: true, cover: true });
    for (const s of [-1, 1]) {
      this._box(1.15, hutH, 0.3, hutConcrete, s * 1.925, 0, LIFT_DOOR.z + 0.15);
      this._box(0.25, hutH, 2.8, hutConcrete, s * 2.375, 0, hutZ);
    }
    this._box(2.7, hutH - ROOF_LIFT.height, 0.3, hutConcrete, 0, ROOF_LIFT.height, LIFT_DOOR.z + 0.15);
    this._box(5, hutH, 0.25, hutConcrete, 0, 0, hutZ + 1.275);
    this._box(5.3, 0.2, 3.1, hutTrim, 0, hutH, hutZ);
    this.lift = this._put(createLift(k, { ...ROOF_LIFT, label: "R" }), LIFT_DOOR.x, 0, LIFT_DOOR.z);
    this.lift.userData.lift.setLight(1);
    this._put(k.alarmBeacon({ x: 0, y: 2.6, speed: 3.6 }), 1.95, 0.35, LIFT_DOOR.z - 0.2);

    // The machine room the second scientist comes out of.
    this._box(7, 3.8, 5, concrete, EDGE - 4.6, 0, -EDGE + 3.6, { solid: true, cover: true });
    this._box(1.5, 2.4, 0.1, mat.pitBlack, MACHINE_DOOR.x - 0.8, 0, -EDGE + 6.12);

    // Hatches the patients climb out of.
    for (const h of HATCHES) {
      this._box(1.6, 0.35, 1.6, mat.darkMetal, h.x, 0, h.z);
      this._box(1.2, 0.02, 1.2, mat.pitBlack, h.x, 0.35, h.z);
      const lid = this._box(1.6, 0.08, 1.6, mat.paintedMetal, h.x, 0, h.z);
      lid.position.set(h.x - 0.8, 0.75, h.z);
      lid.rotation.z = 1.2;
    }

    // Helipad.
    const pad = this._track(new THREE.MeshStandardMaterial({ map: helipadTexture(), transparent: true, roughness: 0.7, metalness: 0.1 }));
    this.owned.textures.push(pad.map);
    const padMesh = new THREE.Mesh(new THREE.CircleGeometry(6.5, 48), pad);
    padMesh.rotation.x = -Math.PI / 2;
    padMesh.position.set(HELIPAD.x, 0.01, HELIPAD.z);
    this.owned.geometries.push(padMesh.geometry);
    this.groups.set.add(padMesh);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const led = new THREE.Mesh(k.geometries.unitSphere, mat.warning);
      led.scale.setScalar(0.18);
      led.position.set(HELIPAD.x + Math.cos(a) * 6.7, 0.08, HELIPAD.z + Math.sin(a) * 6.7);
      this.groups.set.add(led);
    }

    // Cover: AC units (the vent fan model), a water tank, vents, a dish.
    // Their housings get their own weathered steel: plain paint went white
    // under the floodlights.
    const housing = this._track(new THREE.MeshStandardMaterial({ map: acHousingTexture(), color: 0x9aa39c, metalness: 0.45, roughness: 0.72 }));
    this.owned.textures.push(housing.map);
    const acUnit = (x, z, rot = 0) => {
      const w = 2.6;
      const d = 1.8;
      this._box(rot ? d : w, 1.7, rot ? w : d, housing, x, 0, z, { solid: true, cover: true });
      const fan = k.ventFanUnit();
      fan.scale.setScalar(0.75);
      // The fan model is factory white: weather it, or the floods blow it out.
      const slot = fan.children[1];
      if (slot) slot.userData.onFilled = (model) => model.traverse((o) => {
        if (!o.isMesh) return;
        o.material = this._track(o.material.clone());
        // Down to the housing's grey-green (linear), whatever the model's paint.
        o.material.color?.setRGB(0.13, 0.15, 0.14);
        if ("roughness" in o.material) o.material.roughness = Math.max(0.65, o.material.roughness);
      });
      this._put(fan, x, 1.7, z, rot);
    };
    acUnit(-8, 5);
    acUnit(7.5, -2, Math.PI / 2);
    acUnit(-3.5, -1);
    acUnit(4, 8, Math.PI / 2);

    const tank = new THREE.Group();
    const barrel = new THREE.Mesh(k.geometries.unitCyl, mat.ductMetal);
    barrel.scale.set(3, 3.2, 3);
    barrel.position.y = 3.6;
    tank.add(barrel);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tank.add(k.box(0.18, 2, 0.18, mat.darkMetal, 0, x, z));
    this._put(tank, -11, 0, 11);
    this.cover.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(-11, 1, 11), new THREE.Vector3(2.4, 2, 2.4)));

    for (const [x, z] of [[11, 7], [-12, -6], [2, -14]]) {
      const vent = new THREE.Mesh(k.geometries.unitCyl, mat.ductMetal);
      vent.scale.set(0.9, 1.4, 0.9);
      vent.position.set(x, 0.7, z);
      this.groups.set.add(vent);
      this.cover.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 0.7, z), new THREE.Vector3(0.9, 1.4, 0.9)));
    }
    for (const [x, z, r] of [[-EDGE + 0.7, 13, 0], [EDGE - 0.7, 12, Math.PI]]) {
      this._put(k.utilityBoxUnit(), x, 0, z, r + Math.PI / 2);
    }
    // Floodlights on poles at the parapets.
    this.floods = [];
    for (const [x, z] of [[-EDGE + 1, -EDGE + 0.6], [EDGE - 1, EDGE - 0.6]]) {
      this._box(0.16, 5.5, 0.16, mat.darkMetal, x, 0, z);
      const head = this._box(0.9, 0.4, 0.5, mat.trim, x, 5.5, z);
      head.rotation.x = 0.4;
      this._box(0.7, 0.05, 0.35, mat.lightTube, x, 5.45, z - Math.sign(z) * 0.25);
      this.floods.push(new THREE.Vector3(x, 5.2, z - Math.sign(z) * 0.4));
    }

    // Sky dome.
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: this.fire.time },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this._track(this.skyMaterial);
    // Inside the camera's far plane (320 m), or it is clipped into an arch.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(270, 32, 16), this.skyMaterial);
    sky.name = "Sky";
    sky.renderOrder = -1;
    this.owned.geometries.push(sky.geometry);
    this.root.add(sky);
  }

  /**
   * What a real roof carries - all of it decoration, none of it in your
   * way: pipe runs along the parapets, masts and a dish on the machine
   * room, red aircraft lights at the corners, puddles, steam from the
   * exhaust stacks, a wind sock by the pad.
   */
  _dressRoof() {
    const own = (x) => {
      (x.isMaterial ? this.owned.materials : x.isTexture ? this.owned.textures : this.owned.geometries).push(x);
      return x;
    };
    const p = createPropKit(own);
    const g = this.groups.set;
    const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; g.add(o); return o; };
    // Pipe runs along the inside of both parapets, on stands.
    g.add(p.pipe([[-14.5, 0.35, -EDGE + 0.55], [6.8, 0.35, -EDGE + 0.55]], { radius: 0.11, material: p.M.pipeGrey }));
    g.add(p.pipe([[-14.5, 0.62, -EDGE + 0.5], [-2, 0.62, -EDGE + 0.5], [-2, 1.4, -EDGE + 0.5]], { radius: 0.06, material: p.M.pipeYellow }));
    g.add(p.pipe([[-8.5, 0.35, EDGE - 0.55], [-2.8, 0.35, EDGE - 0.55]], { radius: 0.09, material: p.M.pipeRed }));
    g.add(p.pipe([[2.8, 0.35, EDGE - 0.55], [14.5, 0.35, EDGE - 0.55]], { radius: 0.09, material: p.M.pipeRed }));
    for (let x = -14; x <= 6; x += 2.5) p.part(g, p.M.darkSteel, 0.08, 0.3, 0.3, x, 0.15, -EDGE + 0.55);
    // The machine room's roof: two masts, a dish, a condenser; cable down its wall.
    const mx = EDGE - 4.6;
    const mz = -EDGE + 3.6;
    const blinkers = [];
    const glowTex = own(new THREE.CanvasTexture((() => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d");
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.3, "rgba(255,255,255,0.45)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      return c;
    })()));
    const red = own(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a1a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    const mast = (x, z, h) => {
      p.rod(g, p.M.darkSteel, 0.06, h, x, 3.8 + h / 2, z);
      for (let y = 1; y < h; y += 1.4) p.part(g, p.M.steel, 0.5, 0.03, 0.03, x, 3.8 + y, z);
      const light = new THREE.Sprite(red);
      light.position.set(x, 3.8 + h + 0.2, z);
      light.scale.setScalar(1.6);
      g.add(light);
      blinkers.push(light);
    };
    mast(mx + 2.4, mz - 1.4, 7);
    mast(mx - 2.6, mz + 1.6, 4.5);
    const dish = new THREE.Group();
    const bowl = new THREE.Mesh(own(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.32)), p.M.painted);
    bowl.rotation.x = -Math.PI / 2 - 0.5;
    bowl.position.y = 1.1;
    dish.add(bowl);
    p.rod(dish, p.M.darkSteel, 0.06, 1.0, 0, 0.5, 0);
    p.rod(dish, p.M.darkSteel, 0.02, 0.9, 0, 1.3, 0.4, { rx: 0.9 });
    at(dish, mx - 1.2, 3.8, mz - 1.2, 2.4);
    p.part(g, p.M.plasticGrey, 1.4, 0.9, 0.8, mx + 0.6, 3.8 + 0.45, mz + 1.4, { r: 0.04 });
    p.part(g, p.M.darkSteel, 0.3, 3.6, 0.12, mx - 3.55, 1.9, mz + 1.0);
    const danger = p.sign([["DANGER", 50], ["HIGH VOLTAGE", 30]], { width: 0.6, height: 0.42, bg: "#f2f2ec", fg: "#b81d12", stripe: "#d6a520" });
    at(danger, mx - 3.52, 1.8, mz - 0.6, -Math.PI / 2);
    // A dish on the lift housing too, and its aerial.
    const hutZ = LIFT_DOOR.z + 1.4;
    const small = dish.clone();
    small.scale.setScalar(0.6);
    at(small, 1.6, 3.7, hutZ + 0.6, 0.6);
    p.rod(g, p.M.darkSteel, 0.03, 2.2, -1.8, 3.7 + 1.1, hutZ + 0.8);
    // Red aircraft lights at the four corners of the tower.
    for (const [x, z] of [[-EDGE, -EDGE], [EDGE, -EDGE], [-EDGE, EDGE], [EDGE, EDGE]]) {
      p.rod(g, p.M.darkSteel, 0.05, 1.2, x * 0.98, 1.6, z * 0.98);
      const light = new THREE.Sprite(red);
      light.position.set(x * 0.98, 2.3, z * 0.98);
      light.scale.setScalar(2.2);
      g.add(light);
      blinkers.push(light);
    }
    // Puddles: standing water in the dips, the floods and the city in them.
    const water = own(new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.85 }));
    const r = rng(77);
    for (let i = 0; i < 9; i += 1) {
      const puddle = new THREE.Mesh(own(new THREE.CircleGeometry(0.6 + r() * 1.1, 20)), water);
      puddle.rotation.x = -Math.PI / 2;
      puddle.scale.set(1, 0.5 + r() * 0.6, 1);
      puddle.rotation.z = r() * Math.PI;
      puddle.position.set((r() - 0.5) * (EDGE * 1.6), 0.012, (r() - 0.5) * (EDGE * 1.6));
      if (puddle.position.distanceTo(HELIPAD) < 7) continue;
      puddle.receiveShadow = true;
      g.add(puddle);
    }
    // Exhaust stacks, steaming.
    for (const [x, z] of [[-14.2, -9], [14.2, 4]]) {
      p.rod(g, p.M.darkSteel, 0.28, 2.6, x, 1.3, z);
      p.rod(g, p.M.steel, 0.32, 0.12, x, 2.6, z);
      this.cover.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 1.3, z), new THREE.Vector3(0.6, 2.6, 0.6)));
      const steam = this.kit.smokeJet({ count: 10 });
      steam.position.set(x, 2.6, z);
      steam.scale.setScalar(0.8);
      this.groups.hazards.add(steam);
      this._ticking.push(steam);
    }
    // A wind sock at the pad, its cloth streaming in the wind.
    const sock = new THREE.Group();
    p.rod(sock, p.M.steel, 0.04, 3.2, 0, 1.6, 0);
    const cone = new THREE.Mesh(own(new THREE.CylinderGeometry(0.28, 0.1, 1.4, 14, 4, true)), own(new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.9, side: THREE.DoubleSide })));
    cone.rotation.z = Math.PI / 2;
    cone.position.set(0.72, 0, 0);
    const swing = new THREE.Group();
    swing.position.y = 3.15;
    swing.add(cone);
    sock.add(swing);
    at(sock, HELIPAD.x + 7.6, 0, HELIPAD.z - 3.5);
    this.cover.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(HELIPAD.x + 7.6, 1.6, HELIPAD.z - 3.5), new THREE.Vector3(0.12, 3.2, 0.12)));
    sock.userData.tick = (dt, time) => {
      swing.rotation.y = 0.6 + Math.sin(time * 0.7) * 0.35;
      swing.rotation.z = -0.15 + Math.sin(time * 2.3) * 0.08;
      for (const b of blinkers) b.material.opacity = Math.sin(time * 2.6) > 0 ? 1 : 0.05;
    };
    this._ticking.push(sock);
  }

  /**
   * The city around and below you (city.js): towers rising out of the haze
   * from streets 160 m down, the street grid glowing with traffic, aircraft
   * lights on the masts, police helicopters circling with their searchlights.
   */
  _buildSkyline(assetBase) {
    this.city = new CityAtNight({ seed: 41, streetY: -160, neighbours: 3 });
    this.city.root.name = "Skyline";
    this.root.add(this.city.root);
    if (assetBase) this.city.loadHelicopters(assetBase).catch(() => {});
  }

  _buildLights() {
    const g = this.groups.lights;
    this.hemisphere = new THREE.HemisphereLight(0x33405e, 0x3a1a0c, 0.55);
    this.moon = new THREE.DirectionalLight(0x9fb2d6, 0.9);
    this.moon.position.set(-30, 60, -20);
    g.add(this.hemisphere, this.moon);
    // Two floods and two dim glows up from the city past the ledges: a fixed four.
    this.points = [];
    for (const f of this.floods) {
      const light = new THREE.PointLight(0xffe2b8, 55, 30, 1.6);
      light.position.copy(f);
      g.add(light);
      this.points.push({ light, base: 55, flicker: 0 });
    }
    for (const x of [-EDGE - 0.5, EDGE + 0.5]) {
      const light = new THREE.PointLight(0xffa868, 10, 22, 1.5);
      light.position.set(x, -1.5, 0);
      g.add(light);
      this.points.push({ light, base: 10, flicker: 1 });
    }
  }

  /** Smoke drifting up past both open ledges (the demolition below). */
  _buildEdges() {
    const k = this.kit;
    for (const x of [-EDGE - 0.6, EDGE + 0.6]) {
      for (let i = 0; i < 3; i += 1) {
        const smoke = k.smokeJet({ count: 18 });
        smoke.scale.set(3, 5, 3);
        smoke.position.set(x + Math.sign(x) * 1.5, 0, -10 + i * 10);
        this.groups.hazards.add(smoke);
        this._ticking.push(smoke);
      }
    }
  }

  _buildPickups() {
    const k = this.kit;
    for (const [x, z] of [[-13, 0], [13, 5], [0, 2]]) {
      const sack = k.sack({ hp: 1, spheres: 7 });
      sack.position.set(x, 0, z); // the crystal floats over its duffel
      this.groups.pickups.add(sack);
      this._ticking.push(sack);
      this.breakables.push(sack.userData.glass);
    }
  }

  /**
   * Gas canisters standing by the cover. Shoot one and it blows: everyone
   * within CANISTER_RADIUS goes down (lure the patients to them), and it
   * hurts you too if you're that close (the host checks).
   */
  _buildCanisters() {
    const k = this.kit;
    const red = this._track(new THREE.MeshStandardMaterial({ color: 0xa3201a, roughness: 0.45, metalness: 0.45 }));
    const band = this._track(new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.6 }));
    this.canisters = [];
    for (const [i, at] of CANISTERS.entries()) {
      const group = new THREE.Group();
      group.name = "GasCanister";
      group.position.copy(at);
      for (const [dx, dz] of [[0, 0], [0.55, 0.25]]) {
        const body = new THREE.Mesh(k.geometries.unitCyl, red);
        body.scale.set(0.6, 1.3, 0.6);
        body.position.set(dx, 0.65, dz);
        group.add(body);
        const stripe = new THREE.Mesh(k.geometries.unitCyl, band);
        stripe.scale.set(0.62, 0.12, 0.62);
        stripe.position.set(dx, 1.0, dz);
        group.add(stripe);
        const valve = new THREE.Mesh(k.geometries.unitCyl, k.materials.darkMetal);
        valve.scale.set(0.16, 0.18, 0.16);
        valve.position.set(dx, 1.38, dz);
        group.add(valve);
      }
      const hit = new THREE.Mesh(k.geometries.unitBox, k.materials.collider);
      hit.scale.set(1.3, 1.5, 1.0);
      hit.position.set(0.27, 0.75, 0.12);
      hit.userData = { kind: "canister", breakable: true, alive: true, index: i };
      group.add(hit);
      this.groups.set.add(group);
      this.breakables.push(hit);
      const box = new THREE.Box3().setFromCenterAndSize(at.clone().add(new THREE.Vector3(0.27, 0.75, 0.12)), new THREE.Vector3(1.3, 1.5, 1.0));
      this.cover.push(box);
      this.canisters.push({ group, hit, box, at: at.clone().setY(0.9) });
    }
  }

  /** A canister going up: the blast takes down everyone near it. */
  _blowCanister(hit) {
    const c = this.canisters.find((x) => x.hit === hit);
    if (!c) return null;
    hit.userData.alive = false;
    c.group.visible = false;
    const ci = this.cover.indexOf(c.box);
    if (ci >= 0) this.cover.splice(ci, 1);
    let downs = 0;
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.position.distanceTo(c.at) > CANISTER_RADIUS) continue;
      if (enemy.hit(6, c.at)) {
        downs += 1;
        this.state.downs += 1;
        const i = this.breakables.indexOf(enemy.hurt);
        if (i >= 0) this.breakables.splice(i, 1);
        this.events.emit("enemy-down", { enemy, position: enemy.position.clone() });
      }
      // Thrown back hard by it.
      _v.subVectors(enemy.position, c.at).setY(0).normalize();
      enemy.velocity.addScaledVector(_v, 6);
    }
    // Any canister in reach goes up with it - a chain.
    for (const other of this.canisters) {
      if (other !== c && other.hit.userData.alive && other.at.distanceTo(c.at) < CANISTER_RADIUS) {
        other.chain = 0.35;
      }
    }
    this.events.emit("canister", { position: c.at.clone(), downs });
    return { kind: "canister", position: c.at.clone(), downs };
  }

  /**
   * A supply drop: a crate under a parachute from high above, a red flare
   * where it will land. When it's down, a sphere cache and a serum capsule
   * stand over it - shoot them or walk into them.
   */
  _startDrop(player) {
    const spots = DROP_SPOTS.filter((p) => !player || p.distanceTo(player) > 6);
    const at = (spots.length ? spots : DROP_SPOTS)[Math.floor(this.random() * (spots.length || DROP_SPOTS.length))].clone();
    const k = this.kit;
    const crate = new THREE.Group();
    crate.name = "SupplyDrop";
    const wood = this._track(new THREE.MeshStandardMaterial({ color: 0x4b5232, roughness: 0.8, metalness: 0.2 }));
    const box = new THREE.Mesh(k.geometries.unitBox, wood);
    box.scale.set(1.3, 0.9, 1.0);
    box.position.y = 0.45;
    crate.add(box);
    for (const z of [-0.3, 0.3]) {
      const strap = new THREE.Mesh(k.geometries.unitBox, k.materials.hazard);
      strap.scale.set(1.34, 0.94, 0.08);
      strap.position.set(0, 0.45, z);
      crate.add(strap);
    }
    // The canopy and its lines.
    const canopy = new THREE.Mesh((() => { const g = new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42); this.owned.geometries.push(g); return g; })(), this._track(new THREE.MeshStandardMaterial({ color: 0xd8dccf, roughness: 0.9, side: THREE.DoubleSide })));
    canopy.position.y = 4.2;
    canopy.scale.y = 0.6;
    const lines = new THREE.Group();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const line = new THREE.Mesh(k.geometries.unitBox, k.materials.darkMetal);
      const top = new THREE.Vector3(Math.cos(a) * 1.9, 4.1, Math.sin(a) * 1.9);
      const bottom = new THREE.Vector3(0, 0.9, 0);
      line.scale.set(0.02, top.distanceTo(bottom), 0.02);
      line.position.copy(top).add(bottom).multiplyScalar(0.5);
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bottom).normalize());
      lines.add(line);
    }
    const chute = new THREE.Group();
    chute.add(canopy, lines);
    crate.add(chute);
    crate.position.set(at.x, DROP_HEIGHT, at.z);
    this.groups.set.add(crate);
    // A red flare burning where it'll land.
    const flare = k.smokeJet({ count: 14 });
    flare.scale.set(0.8, 2.2, 0.8);
    flare.position.copy(at);
    this.groups.hazards.add(flare);
    this._ticking.push(flare);
    const glow = new THREE.Mesh(k.geometries.unitSphere, this._track(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 0.2) })));
    glow.scale.setScalar(0.12);
    glow.position.copy(at).setY(0.1);
    this.groups.set.add(glow);
    this.drop = { crate, chute, flare, glow, at, landed: false, t: 0 };
    this.events.emit("drop-incoming", { position: at.clone() });
  }

  _updateDrop(dt, time) {
    const d = this.drop;
    if (!d) return;
    d.t += dt;
    if (!d.landed) {
      // Down at 4.5 m/s, swaying under the canopy.
      d.crate.position.y = Math.max(0, DROP_HEIGHT - d.t * 4.5);
      d.crate.rotation.z = Math.sin(time * 1.4) * 0.12 * (d.crate.position.y / DROP_HEIGHT);
      d.crate.rotation.x = Math.sin(time * 1.1 + 1) * 0.1 * (d.crate.position.y / DROP_HEIGHT);
      if (d.crate.position.y <= 0) {
        d.landed = true;
        d.crate.rotation.set(0, d.crate.rotation.y, 0);
        d.chute.visible = false;
        d.glow.visible = false;
        this.cover.push(new THREE.Box3().setFromCenterAndSize(d.at.clone().setY(0.45), new THREE.Vector3(1.3, 0.9, 1.0)));
        // What it brought: spheres, and a serum.
        const kinds = ["coolant", "adrenaline", "overcharge", "barrier"];
        const cache = this.kit.sack({ hp: 1, spheres: 10 });
        cache.position.copy(d.at).add(new THREE.Vector3(-1.2, 0, 0));
        const serum = this.kit.powerup({ kind: kinds[Math.floor(this.random() * kinds.length)] });
        serum.position.copy(d.at).add(new THREE.Vector3(1.2, 0, 0));
        for (const piece of [cache, serum]) {
          this.groups.pickups.add(piece);
          this._ticking.push(piece);
          this.breakables.push(piece.userData.glass);
        }
        this.events.emit("drop-landed", { position: d.at.clone() });
      }
    }
    // The flare burns out a while after it lands.
    if (d.landed && d.t > DROP_HEIGHT / 4.5 + 12) d.flare.visible = false;
  }

  _buildOrbs() {

    this.orbs = [];
    const core = this._track(new THREE.MeshBasicMaterial({ color: 0xc8fbff }));
    const halo = this._track(new THREE.MeshBasicMaterial({ color: 0x46d8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (let i = 0; i < 8; i += 1) {
      const mesh = new THREE.Mesh(this.kit.geometries.unitSphere, core);
      mesh.scale.setScalar(0.28);
      const glow = new THREE.Mesh(this.kit.geometries.unitSphere, halo);
      glow.scale.setScalar(2.6);
      mesh.add(glow);
      mesh.visible = false;
      this.groups.orbs.add(mesh);
      this.orbs.push({ mesh, velocity: new THREE.Vector3(), life: 0, active: false });
    }
  }

  _buildHelicopter() {
    const asset = this.assets.get("helicopter");
    this.heli = asset ? new Helicopter(asset.template) : null;
    if (this.heli) {
      this.heli.root.visible = false;
      this.root.add(this.heli.root);
      // The approach, ending in a hover over the pad.
      this.heliPath = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-150, 45, -170),
        new THREE.Vector3(-70, 30, -90),
        new THREE.Vector3(-20, 16, -30),
        new THREE.Vector3(HELIPAD.x, 7.5, HELIPAD.z - 1),
      ]);
    }
  }

  /* ---------------- Collision helpers ---------------- */

  /** Is a circle at `p` inside any cover? */
  blocked(p, radius = 0.45) {
    for (const box of this.cover) {
      if (p.x > box.min.x - radius && p.x < box.max.x + radius && p.z > box.min.z - radius && p.z < box.max.z + radius) return true;
    }
    return false;
  }

  /** Push a circle at `p` (in place) out of every cover box. */
  resolveCircle(p, radius = 0.45) {
    for (const box of this.cover) {
      const cx = THREE.MathUtils.clamp(p.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(p.z, box.min.z, box.max.z);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * radius;
        p.z = cz + (dz / d) * radius;
      } else {
        // Centre inside the box: out through the nearest face.
        const pushes = [
          [box.min.x - radius - p.x, 0],
          [box.max.x + radius - p.x, 0],
          [0, box.min.z - radius - p.z],
          [0, box.max.z + radius - p.z],
        ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += pushes[0][0];
        p.z += pushes[0][1];
      }
    }
    return p;
  }

  /** Keep the player on the roof: the ledges are not a way out. */
  clampPlayer(p) {
    // The parapets (north and south) hold you; the open ledges (east and
    // west) do not - walk off one and there is no roof under you (groundAt).
    p.z = THREE.MathUtils.clamp(p.z, -WALK_LIMIT, WALK_LIMIT);
    if (p.y < -0.3) return p; // already over the edge and falling
    return this.resolveCircle(p, 0.45);
  }

  /**
   * The roof's surface under `p` (it is flat: y = 0), or null past an open
   * ledge - the host's physics lets you fall there.
   */
  groundAt(p) {
    if (this.overHatch(p)) return null;
    return Math.abs(p.x) <= EDGE && Math.abs(p.z) <= EDGE ? 0 : null;
  }

  /**
   * Over one of the open hatches the patients climb out of? Those are holes
   * (1.2 m square) down into the building: step in and you fall.
   */
  overHatch(p) {
    return HATCHES.some((h) => Math.abs(p.x - h.x) < HATCH_HOLE && Math.abs(p.z - h.z) < HATCH_HOLE);
  }

  /** Nothing in the way between two points (for a patient deciding to charge)? */
  clearLine(a, b) {
    const steps = Math.ceil(a.distanceTo(b) / 0.6);
    for (let i = 1; i < steps; i += 1) {
      _w.lerpVectors(a, b, i / steps);
      if (this.blocked(_w, 0.2)) return false;
    }
    return true;
  }

  /* ---------------- Waves ---------------- */

  _character(name) {
    const asset = this.assets.get(name);
    return asset ? cloneCharacter(asset.template) : null;
  }

  _gadget(name, length) {
    const asset = this.assets.get(name);
    if (!asset) return null;
    const g = asset.template.clone(true);
    const size = asset.size;
    g.scale.setScalar(length / Math.max(size.x, size.y, size.z));
    if (name === "gadgetBrass") {
      g.traverse((o) => {
        if (o.isMesh) {
          o.material = this._track(new THREE.MeshStandardMaterial({ color: 0xb4863a, metalness: 0.85, roughness: 0.35 }));
        }
      });
    }
    const holder = new THREE.Group();
    holder.add(g);
    // Bone space is not metres: undo the bone chain's scale so the gadget
    // keeps its real size in the hand.
    holder.userData.fixScale = length;
    return holder;
  }

  _spawnWave(index) {
    this.state.wave = index;
    const SPECS = {
      1: { scientist: "scientistRadioman", gadget: "gadgetBrass", at: new THREE.Vector3(-3, 0, -10), enter: null, hatches: [0, 1] },
      2: { scientist: "scientistRust", gadget: "gadgetCoil", at: MACHINE_DOOR.clone().add(new THREE.Vector3(-0.8, 0, 1.5)), enter: new THREE.Vector3(6, 0, -6), hatches: [2, 3] },
      // The last of them: everyone left, at once, as the helicopter nears.
      3: { scientist: "scientistRadioman", gadget: "gadgetCoil", at: MACHINE_DOOR.clone().add(new THREE.Vector3(-0.8, 0, 1.5)), enter: new THREE.Vector3(-5, 0, -4), hatches: [0, 1, 3] },
    };
    const spec = SPECS[index] ?? this._endlessWave(index);
    const scientist = new Scientist(this, {
      model: this._character(spec.scientist),
      position: spec.at,
      enter: spec.enter,
      gadget: this._gadget(spec.gadget, 0.6),
      seed: index * 17 + 3,
    });
    this._addEnemy(scientist);
    for (const [i, hatch] of spec.hatches.entries()) {
      const patient = new Patient(this, { model: this._character("patient"), position: HATCHES[hatch], delay: 0.6 + i * 0.8 });
      this._addEnemy(patient);
    }
    // The last wave brings the brute out of the far hatch (and endless, every
    // third wave after it).
    if (index === 3 || (index > 3 && index % 3 === 0)) {
      const brute = new Patient(this, { model: this._character("patient"), position: HATCHES[2], delay: 2.2, brute: true });
      this._addEnemy(brute);
      this.events.emit("brute", { position: HATCHES[2].clone() });
    }
    this.events.emit("wave", { index, scientist: spec.scientist });
  }

  /** Waves after the third (endless): bigger as it goes on, from random hatches. */
  _endlessWave(index) {
    const r = this.random;
    const hatches = [0, 1, 2, 3].sort(() => r() - 0.5).slice(0, Math.min(4, 2 + Math.floor((index - 3) / 2)));
    const fromDoor = r() < 0.5;
    return {
      scientist: index % 2 ? "scientistRadioman" : "scientistRust",
      gadget: index % 2 ? "gadgetBrass" : "gadgetCoil",
      at: fromDoor ? MACHINE_DOOR.clone().add(new THREE.Vector3(-0.8, 0, 1.5)) : new THREE.Vector3(-3 + r() * 6, 0, -12),
      enter: fromDoor ? new THREE.Vector3(-4 + r() * 10, 0, -5) : null,
      hatches,
    };
  }

  /** Endless runs spawn forever: drop enemies that have gone over the edge or been gone a while. */
  _cullFallen() {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      if (!e.removed) continue;
      this.groups.enemies.remove(e.root);
      this.enemies.splice(i, 1);
    }
  }

  _addEnemy(enemy) {
    // Hand gadgets live in bone space; correct their scale for the bone chain.
    if (enemy.gadget?.userData.fixScale && enemy.gadget.parent) {
      enemy.root.updateMatrixWorld(true);
      const s = new THREE.Vector3();
      enemy.gadget.parent.getWorldScale(s);
      enemy.gadget.scale.setScalar(1 / Math.max(1e-6, s.x));
      enemy.gadget.position.set(0, 0, 0);
    }
    this.enemies.push(enemy);
    this.groups.enemies.add(enemy.root);
    this.breakables.push(enemy.hurt);
  }

  get enemiesAlive() {
    return this.enemies.filter((e) => e.alive).length;
  }

  /* ---------------- Orbs ---------------- */

  fireOrb(from, to) {
    const orb = this.orbs.find((o) => !o.active);
    if (!orb) return;
    orb.active = true;
    orb.life = 0;
    orb.mesh.position.copy(from);
    orb.velocity.subVectors(to, from).normalize().multiplyScalar(SCIENTIST.orbSpeed);
    orb.mesh.visible = true;
    this.events.emit("orb-fired", { position: from.clone() });
  }

  _updateOrbs(dt, ctx) {
    for (const orb of this.orbs) {
      if (!orb.active) continue;
      orb.life += dt;
      const p = orb.mesh.position;
      p.addScaledVector(orb.velocity, dt);
      orb.mesh.scale.setScalar(0.28 + Math.sin(orb.life * 30) * 0.03);
      let end = orb.life > 4 || p.y < 0.1 || Math.abs(p.x) > EDGE + 20 || Math.abs(p.z) > EDGE + 20;
      if (!end && this.blocked(p, 0.05) && p.y < 2.2) end = true;
      if (!end && !ctx.frozen) {
        _v.copy(ctx.player).setY(1.1);
        if (p.distanceTo(_v) < 0.75) {
          ctx.hits.push({ damage: SCIENTIST.damage, from: p.clone(), knock: 3, source: "orb" });
          end = true;
        }
      }
      if (end) {
        orb.active = false;
        orb.mesh.visible = false;
        this.events.emit("orb-burst", { position: p.clone() });
      }
    }
  }

  /* ---------------- Balls ---------------- */

  /**
   * A player's ball hit a breakable. Returns null, {partial} or the result -
   * the same contract as MeltdownLevel.breakTarget.
   */
  breakTarget(mesh, power = 1, from = null) {
    const data = mesh?.userData;
    if (!data?.alive) return null;
    const position = mesh.getWorldPosition(new THREE.Vector3());
    const remove = () => {
      const i = this.breakables.indexOf(mesh);
      if (i >= 0) this.breakables.splice(i, 1);
    };
    if (data.kind === "enemy") {
      const enemy = data.enemy;
      const down = enemy.hit(Math.min(power, 3), from);
      if (!down) {
        this.events.emit("enemy-hit", { enemy, position });
        return { partial: true, kind: "enemy", enemyKind: enemy.kind, position };
      }
      remove();
      this.state.downs += 1;
      this.events.emit("enemy-down", { enemy, position });
      return { kind: "enemy", enemyKind: enemy.kind, position };
    }
    if (data.kind === "sack") {
      if (!data.node.userData.hit(power)) return { partial: true, kind: "sack", position };
      remove();
      return { kind: "sack", spheres: data.spheres, position };
    }
    if (data.kind === "canister") {
      remove();
      return this._blowCanister(mesh);
    }
    if (data.kind === "powerup") {
      if (!data.node.userData.onBreak()) return null;
      remove();
      return { kind: "powerup", powerupKind: data.powerupKind, position };
    }
    return null;
  }

  /* ---------------- Runtime ---------------- */

  /**
   * @param {object} p
   * @param {number} p.dt
   * @param {number} p.time
   * @param {THREE.Vector3} p.player         the player's position
   * @param {THREE.Vector3} p.playerVelocity
   * @returns {{damage:number, from:THREE.Vector3, knock:number, source:string}[]} hits on the player this frame
   */
  update({ dt, time, player, playerVelocity }) {
    const s = this.state;
    this.fire.setTime(time);
    this.city?.update(dt, time, { haze: this.cityHaze });
    if (this.cutscene?.kind === "arrival") {
      // The arrival is over (the host has seen `done`): hand the roof over.
      if (!this._arrival) this.cutscene = null;
      else {
        // Nothing starts while the doors are opening: no waves, no clock.
        for (const piece of this._ticking) piece.userData.tick?.(dt, time);
        this._updateArrival(dt);
        return [];
      }
    }
    if (this._liftClose < 1) {
      this._liftClose = Math.min(1, this._liftClose + dt / 1.2);
      this.lift?.userData.lift.setDoors(1 - this._liftClose);
    }
    s.time += dt;
    const hits = [];
    // Enemies keep fighting while the helicopter waits at the ledge; they
    // only stand down for the cutscenes and once it has gone.
    const frozen = s.ending === "victory" || s.ending === "survive" || s.ending === "left";
    const ctx = { player, playerVelocity, hits, frozen };

    if (!frozen && s.wave === 0 && s.time > 1.2) this._spawnWave(1);
    if (!frozen && s.wave === 1 && (s.time > 19 || (s.time > 4 && this.enemiesAlive === 0))) this._spawnWave(2);
    if (!frozen && s.wave === 2 && (s.time > 36 || (s.time > 24 && this.enemiesAlive === 0))) this._spawnWave(3);
    // Mid-wave, more of them come up the outside of the tower and over the
    // open ledges - the fight is not only at the hatches.
    s.climbers ??= [{ wave: 1, at: 9, side: -1 }, { wave: 2, at: 27, side: 1 }, { wave: 2, at: 29.5, side: -1 }, { wave: 3, at: 44, side: 1 }];
    if (!frozen && s.climbers.length && s.wave >= s.climbers[0].wave && s.time > s.climbers[0].at) {
      const { side } = s.climbers.shift();
      const z = THREE.MathUtils.clamp(player.z + (this.random() - 0.5) * 8, -EDGE + 3, EDGE - 4);
      const climber = new Patient(this, { model: this._character("patient"), position: new THREE.Vector3(side * EDGE, 0, z), delay: 0.4, climb: side });
      this._addEnemy(climber);
      this.events.emit("patient-climb", { position: climber.position.clone() });
    }
    // Endless: after the three set waves, another every 12-24 s (sooner the
    // longer you last), or as soon as the roof is nearly clear.
    if (this.endless && s.wave >= 3) {
      if (!s.nextWaveAt) s.nextWaveAt = s.time + 24;
      if (s.time > s.nextWaveAt || (this.enemiesAlive <= 1 && s.time > s.nextWaveAt - 16)) {
        this._spawnWave(s.wave + 1);
        s.nextWaveAt = s.time + Math.max(12, 24 - s.wave * 0.8);
      }
      this._cullFallen();
    }

    for (const enemy of this.enemies) {
      if (enemy.removed) continue;
      enemy.update(dt, time, ctx);
      if (enemy.state === "fall" && !enemy.counted) {
        enemy.counted = true;
        enemy.hurt.userData.alive = false;
        const i = this.breakables.indexOf(enemy.hurt);
        if (i >= 0) this.breakables.splice(i, 1);
        s.falls += 1;
      }
      if (enemy.removed) enemy.root.visible = false;
    }
    this._updateOrbs(dt, ctx);
    this._updateChaos(dt, time, ctx);
    for (const piece of this._ticking) piece.userData.tick?.(dt, time);

    for (const p of this.points) {
      if (p.flicker) {
        p.flash = Math.max(0, (p.flash ?? 0) - dt * 3);
        // Steady (no fire to flicker), flaring with each blast in the facade.
        p.light.intensity = p.base * (1 + s.chaos * 0.4 + p.flash * 12);
      }
    }

    // The roof is clear: the helicopter stops circling and comes in now.
    const everyone = !this.endless && s.wave === 3 && this.enemiesAlive === 0;
    if (!s.cleared && everyone) {
      s.cleared = true;
      this.events.emit("clear", {});
      if (!s.heliArrived) s.heliAt = Math.min(s.heliAt, s.time + 8);
      else if (s.ending === "extraction") this._startVictory();
    }

    // A supply drop once the second wave is in (endless: every 45 s).
    if (!frozen && !this.drop && s.wave >= 2 && s.time > 24) this._startDrop(player);
    if (this.endless && this.drop?.landed && s.time - (this._lastDrop ?? 0) > 45) { this._lastDrop = s.time; this.drop = null; }
    this._updateDrop(dt, time);
    for (const c of this.canisters) {
      if (c.chain === undefined || !c.hit.userData.alive) continue;
      c.chain -= dt;
      if (c.chain <= 0) {
        const i = this.breakables.indexOf(c.hit);
        if (i >= 0) this.breakables.splice(i, 1);
        this._blowCanister(c.hit);
      }
    }

    this._updateHelicopter(dt, time);
    if (s.ending === "victory" || s.ending === "survive") this._updateEnding(dt, time);
    return hits;
  }

  /* ---------------- Arrival (the lift) ---------------- */

  /**
   * Phase B opens on the lift housing: the doors open, the player walks out
   * onto the roof, the camera settles behind them - then the roof starts.
   * A cutscene like the endings: `cutscene` says where the camera and the
   * player are, the host applies it. PLACEHOLDER staging (see elevator.js).
   */
  beginArrival() {
    this._arrival = { t: 0, opened: false };
    this._liftClose = 0;
    this.lift?.userData.lift.setDoors(0);
    this.cutscene = {
      kind: "arrival", camera: new THREE.Vector3(), look: new THREE.Vector3(), player: new THREE.Vector3(),
      playerYaw: 0, action: "stand", timeScale: 1, done: false, hidePlayer: false, hold: 1, reachUp: 0,
      elevatorInside: true, elevatorVelocity: 0,
    };
    this._updateArrival(0);
    return this.cutscene;
  }

  _updateArrival(dt) {
    const a = this._arrival;
    const out = this.cutscene;
    a.t += dt;
    const t = a.t;
    const smooth = THREE.MathUtils.smoothstep;
    const lift = this.lift?.userData.lift;
    if (!a.opened && t > 0.7) {
      a.opened = true;
      this.events.emit("lift-open", {});
    }
    lift?.setDoors((t - 0.7) / 0.9);
    lift?.setLight(t < 0.5 ? (Math.sin(t * 40) > 0 ? 1 : 0.3) : 1);

    // Walk out of the cabin to the spawn point.
    const walk = smooth(t, 1.2, 2.8);
    out.player.set(LIFT_DOOR.x, 0, LIFT_DOOR.z + 1.4).lerp(ROOF_SPAWN, walk);
    out.playerYaw = 0;
    out.action = t > 1.2 && t < 2.8 ? "run" : "stand";
    out.speed = out.action === "run" ? 4.5 : 0;
    out.elevatorInside = walk < 1;

    // In front of the housing, dollying back as the player walks toward the
    // camera; then a cut to the game camera (a swing round would turn the
    // view through 180 degrees - the doors face away from the game camera).
    if (t < ARRIVAL_CUT) {
      const dolly = smooth(t, 0.9, ARRIVAL_CUT);
      out.camera.set(-1.3, 1.8, LIFT_DOOR.z - 5.9).lerp(_w.set(-1.6, 2.0, LIFT_DOOR.z - 7.7), dolly);
      out.look.set(0, 1.3, LIFT_DOOR.z).lerp(_w.copy(out.player).setY(1.2), smooth(t, 1.2, 2.4));
    } else {
      out.camera.copy(ROOF_SPAWN).add(ARRIVAL_CAMERA);
      out.look.copy(ROOF_SPAWN).add(ARRIVAL_LOOK);
    }
    if (t >= ARRIVAL_SECONDS) {
      out.done = true;
      this._arrival = null;
      this.events.emit("arrived", {});
    }
  }

  /** 0 (silent) .. 1 (overhead): how loud the rotors should be. */
  get rotorLevel() {
    const s = this.state;
    if (s.ending === "left") return Math.max(0, 1 - s.extractT / 6);
    const lead = s.heliAt - s.time;
    return s.ending ? 1 : THREE.MathUtils.clamp(1 - lead / 16, 0, 1);
  }

  /* ---------------- Chaos ---------------- */

  /**
   * The roof gets worse the longer you are on it: `chaos` runs 0 -> 1 as the
   * hidden timer runs down: explosions tear out of the facade, the building
   * shudders, ash fills the air. The host reads `chaos` for fog, shake and
   * sound.
   */
  _buildChaos() {
    this.state.blastTimer = 7;
    this.state.tremorTimer = 13;

    // Ash: one Points cloud over the whole roof.
    const count = 260;
    const positions = new Float32Array(count * 3);
    this.emberSpeed = new Float32Array(count);
    const r = rng(99);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (r() - 0.5) * 44;
      positions[i * 3 + 1] = r() * 14;
      positions[i * 3 + 2] = (r() - 0.5) * 44;
      this.emberSpeed[i] = 0.6 + r() * 1.8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.owned.geometries.push(geometry);
    this.embers = new THREE.Points(geometry, this.kit.materials.ember.clone());
    this._track(this.embers.material);
    // Grey ash, not glowing embers.
    this.embers.material.color?.set(0x7d7a76);
    this.embers.material.blending = THREE.NormalBlending;
    this.embers.material.opacity = 0;
    this.embers.frustumCulled = false;
    this.groups.hazards.add(this.embers);
  }

  _updateChaos(dt, time, ctx) {
    const s = this.state;
    const chaos = s.heliArrived ? 1 : THREE.MathUtils.clamp(s.time / (this.endless ? 120 : s.heliAt), 0, 1);
    s.chaos = chaos;
    const live = s.ending !== "left" && s.ending !== "victory";

    // Explosions tearing out of the facade below the ledges.
    s.blastTimer -= dt;
    if (live && s.time > 5 && s.blastTimer <= 0) {
      const side = this.random() < 0.5 ? -1 : 1;
      const position = new THREE.Vector3(side * (EDGE + 0.8), -1 - this.random() * 5, (this.random() - 0.5) * 28);
      this.events.emit("explosion", { position, strength: 0.5 + chaos * 0.7 });
      const glow = this.points.find((p) => p.flicker && Math.sign(p.light.position.x) === side);
      if (glow) glow.flash = 1;
      s.blastTimer = 9 - chaos * 6 + this.random() * 2;
    }

    // The building shudders.
    s.tremorTimer -= dt;
    if (live && s.time > 10 && s.tremorTimer <= 0) {
      this.events.emit("tremor", { strength: 0.3 + chaos * 0.5 });
      s.tremorTimer = 15 - chaos * 8 + this.random() * 3;
    }

    // Ash, thicker as it goes on.
    this.embers.material.opacity = 0.15 + chaos * 0.6;
    const array = this.embers.geometry.attributes.position.array;
    for (let i = 0; i < this.emberSpeed.length; i += 1) {
      array[i * 3 + 1] += this.emberSpeed[i] * dt * (0.6 + chaos);
      array[i * 3] += Math.sin(time * 0.7 + i) * dt * 0.8 + dt * 1.2;
      if (array[i * 3 + 1] > 14) {
        array[i * 3 + 1] = -2;
        array[i * 3] = (this.random() - 0.5) * 44;
      }
    }
    this.embers.geometry.attributes.position.needsUpdate = true;
  }

  /* ---------------- The helicopter ---------------- */

  _updateHelicopter(dt, time) {
    const s = this.state;
    if (!this.heli) {
      if (!s.heliArrived && s.time >= s.heliAt) this._arrive();
      else if (s.ending === "extraction" || s.ending === "left") this._updateExtraction(dt, time);
      return;
    }
    const heli = this.heli;
    const lead = s.heliAt - s.time;
    const flight = 12; // seconds from first glimpse to the hover
    if (!s.heliArrived) {
      if (lead < flight) {
        const t = THREE.MathUtils.clamp(1 - lead / flight, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2.2);
        this.heliPath.getPointAt(eased, heli.root.position);
        const ahead = this.heliPath.getPointAt(Math.min(1, eased + 0.02)).sub(heli.root.position);
        if (ahead.lengthSq() > 1e-4) {
          // Nose down while it is going fast, flattening out into the hover.
          heli.orient(ahead, { pitch: -0.16 * (1 - eased), bank: Math.sin(time * 0.9) * 0.03 + (1 - eased) * 0.1 });
          this._heliYaw = heli.root.rotation.y;
        }
        heli.root.visible = true;
        if (!s.heliSeen) {
          s.heliSeen = true;
          this.events.emit("heli-seen", {});
        }
      }
      if (s.time >= s.heliAt) this._arrive();
    } else if (s.ending === "extraction" || s.ending === "left") {
      this._updateExtraction(dt, time);
    }
    if (heli.root.visible) heli.update(dt, { rotor: 1, light: 1 });
  }

  _arrive() {
    const s = this.state;
    s.heliArrived = true;
    if (s.cleared || this.enemiesAlive === 0) {
      this._startVictory();
    } else {
      // It cannot land with them still up here. It swings out beyond the
      // east ledge and waits, ladder down - for a while.
      s.ending = "extraction";
      s.extractT = 0;
      this._extractFrom = this.heli ? this.heli.root.position.clone() : new THREE.Vector3();
      this.events.emit("heli-arrived", { ending: "extraction", window: EXTRACT_WINDOW });
    }
  }

  _startVictory() {
    const s = this.state;
    s.ending = "victory";
    s.endingT = 0;
    this.cutscene = null;
    this._victoryFrom = this.heli ? this.heli.root.position.clone() : HELIPAD.clone();
    this.events.emit("heli-arrived", { ending: "victory" });
  }

  /** Where the helicopter holds while it waits for you at the east ledge. */
  get _holdPoint() {
    // Nose to +Z (yaw pi), so its door side - and the ladder - faces the roof.
    return new THREE.Vector3(EDGE + 3.45, 7.1, -2.5);
  }

  _updateExtraction(dt, time) {
    const s = this.state;
    const heli = this.heli;
    s.extractT += dt;
    const t = s.extractT;
    const hold = this._holdPoint;
    if (!heli) {
      if (s.ending === "extraction" && t > EXTRACT_WINDOW) {
        s.ending = "left";
        s.extractT = 0;
        this.events.emit("heli-left", {});
      }
      return;
    }
    if (s.ending === "extraction") {
      const k = THREE.MathUtils.smoothstep(t, 0, 3);
      heli.root.position.lerpVectors(this._extractFrom, hold, k);
      heli.root.position.y += Math.sin(time * 1.3) * 0.25 * k;
      heli.root.position.z += Math.sin(time * 0.6) * 0.4 * k;
      const yaw = THREE.MathUtils.lerp(this._heliYaw ?? 0, Math.PI, k);
      heli.root.rotation.set(0, yaw, Math.sin(time * 0.8) * 0.04);
      // Still here, still waiting... then it has to go.
      if (t > EXTRACT_WINDOW) {
        s.ending = "left";
        s.extractT = 0;
        this._leaveFrom = heli.root.position.clone();
        this.events.emit("heli-left", {});
      }
    } else {
      const k = t;
      heli.root.position.copy(this._leaveFrom).add(new THREE.Vector3(k * k * 1.6, k * k * 1.1, k * 3));
      heli.root.rotation.set(-0.15, Math.PI - Math.min(0.6, k * 0.2), -0.1);
      if (k > 12) heli.root.visible = false;
    }
  }

  /**
   * A point on the ladder, `h` metres up from its foot (world). Without the
   * helicopter model (tests, or a failed load) the ladder is where it would
   * hang, so every ending still plays.
   */
  ladderPoint(h, target = new THREE.Vector3()) {
    if (this.heli) return this.heli.ladderPoint(h, target);
    const base = this.state.ending === "victory" ? new THREE.Vector3(HELIPAD.x + 0.25, 0.05, HELIPAD.z + 1.2) : new THREE.Vector3(EDGE + 2.2, 1.0, -1.3);
    return target.copy(base).setY(base.y + h);
  }

  ladderBottom(target = new THREE.Vector3()) {
    return this.ladderPoint(0, target);
  }

  /**
   * While the helicopter waits at the ledge: "go" (get over there) or
   * "jump" (close enough - press jump), else null.
   */
  extractionHint(player) {
    const s = this.state;
    if (s.ending !== "extraction" || s.extractT < 2.6) return s.ending === "extraction" ? "go" : null;
    return this.canGrab(player) ? "jump" : "go";
  }

  /** Close enough to the ledge and the ladder to jump for it? */
  canGrab(player) {
    const s = this.state;
    if (s.ending !== "extraction" || s.extractT < 2.6) return false;
    const bottom = this.ladderBottom(_w);
    const dx = bottom.x - player.x;
    const dz = bottom.z - player.z;
    return player.x > EDGE - 4.5 && Math.hypot(dx, dz) < 4.6;
  }

  /**
   * The story's latch was missed and the player is back on the roof: the
   * helicopter's waiting window starts over, so a retry can't run it out.
   */
  holdExtraction() {
    const s = this.state;
    if (s.ending === "extraction") s.extractT = Math.min(s.extractT, 2.7);
  }

  /** The player jumped for it: play the leap and carry them off. */
  grab(player) {
    const s = this.state;
    if (!this.canGrab(player)) return false;
    s.ending = "survive";
    s.endingT = 0;
    this.cutscene = null;
    this._playerAtEnding = player.clone();
    this._leaveFrom = this.heli ? this.heli.root.position.clone() : this._holdPoint;
    this.events.emit("ladder-grab", {});
    return true;
  }

  /* ---------------- Endings ---------------- */

  /**
   * The cutscenes, as data the host applies: where the camera is and looks,
   * and where the player is, which way they face, and what their arms are
   * doing (`hold` on the launcher, `reachUp` for the ladder).
   *
   * Victory: the helicopter comes down over the pad until its ladder
   * touches, the player runs to it and climbs, and it lifts away.
   * Survive: the player has jumped from the ledge for the ladder - the leap
   * in slow motion, the catch, and the helicopter hauling them off with the
   * patients still on the roof.
   */
  _updateEnding(dt, time) {
    const s = this.state;
    s.endingT += dt * (this.cutscene?.timeScale ?? 1);
    const t = s.endingT;
    const heli = this.heli;
    const out = this.cutscene ?? (this.cutscene = { camera: new THREE.Vector3(), look: new THREE.Vector3(), player: new THREE.Vector3(), playerYaw: 0, action: "run", timeScale: 1, done: false, hidePlayer: false, playerStart: null, hold: 1, reachUp: 0 });
    if (!out.playerStart) out.playerStart = this._playerAtEnding?.clone() ?? ROOF_SPAWN.clone();
    const start = out.playerStart;

    if (s.ending === "victory") {
      // Down until the ladder's foot is on the pad.
      const low = new THREE.Vector3(HELIPAD.x + 1.5, 6.25, HELIPAD.z);
      const come = THREE.MathUtils.smoothstep(t, 0, 3.2);
      const lift = THREE.MathUtils.smoothstep(t, 7.4, 10);
      if (heli) {
        heli.root.position.lerpVectors(this._victoryFrom, low, come);
        heli.root.position.y += lift * 16 + Math.sin(time * 1.2) * 0.08 * (1 - lift);
        heli.root.position.z -= lift * lift * 14;
        heli.root.rotation.set(-lift * 0.14, THREE.MathUtils.lerp(this._heliYaw ?? 0, 0, come), Math.sin(time) * 0.02);
      }
      const foot = this.ladderPoint(0);
      foot.y = Math.max(0, foot.y);
      const run = THREE.MathUtils.smoothstep(t, 1.6, 4.4);
      const climb = THREE.MathUtils.clamp((t - 4.5) / 2.6, 0, 1);
      if (climb <= 0) {
        out.player.lerpVectors(start, foot.clone().setY(0), run);
        _v.subVectors(foot, start);
        out.playerYaw = Math.atan2(-_v.x, -_v.z);
        out.action = run > 0 && run < 1 ? "run" : "idle";
        out.reachUp = 0;
        out.hold = 1;
      } else {
        // Hand over hand up the rungs: hands 2.1 m above the feet.
        this.ladderPoint(0.2 + climb * 4.6, out.player);
        out.player.y -= 1.9;
        out.player.y += Math.abs(Math.sin(climb * 18)) * 0.08;
        const centre = heli ? heli.root.getWorldPosition(new THREE.Vector3()) : low.clone();
        _v.subVectors(centre, out.player).setY(0).normalize();
        out.playerYaw = Math.atan2(-_v.x, -_v.z);
        // Body just in front of the rungs, facing them - not inside them.
        out.player.addScaledVector(_v, -0.32);
        out.action = "climb";
        out.reachUp = 1;
        out.hold = 0;
      }
      out.hidePlayer = t > 7.3;
      const orbit = t * 0.1 + 0.6;
      out.camera.set(HELIPAD.x + Math.sin(orbit) * 15, 3.5 + t * 0.45, HELIPAD.z + Math.cos(orbit) * 15);
      out.look.copy(heli ? heli.root.position : low).lerp(out.player, 0.5);
      out.done = t > 10.5;
    } else {
      // Survive: from wherever they jumped, to the rungs 2.8 m up.
      const leap = Math.min(1, t / 0.95);
      const away = Math.max(0, t - 0.95);
      if (heli) {
        heli.root.position.copy(this._leaveFrom).add(new THREE.Vector3(away * away * 1.2, away * away * 0.9 + away * 0.4, away * 1.5));
        heli.root.rotation.set(-0.12 * Math.min(1, away), Math.PI - Math.min(0.5, away * 0.15), -0.08 * Math.min(1, away));
      }
      const grip = this.ladderPoint(2.8);
      grip.y -= 2.05; // hands on the rung, body hanging below
      if (leap < 1) {
        out.player.lerpVectors(start, grip.clone().setX(grip.x - 0.32), leap);
        out.player.y += Math.sin(leap * Math.PI) * 1.1;
        out.action = "jump";
        out.reachUp = THREE.MathUtils.smoothstep(leap, 0.1, 0.7);
        out.hold = 1 - out.reachUp;
      } else {
        out.player.copy(grip);
        out.player.x -= 0.32; // hanging on the roof side of the rungs, facing them
        out.player.z += Math.sin(time * 2.1) * 0.08;
        out.action = "hang";
        out.reachUp = 1;
        out.hold = 0;
      }
      _v.set(1, 0, 0);
      out.playerYaw = Math.atan2(-_v.x, -_v.z);
      // Slow motion over the gap.
      out.timeScale = leap > 0.15 && leap < 0.8 ? 0.3 : 1;
      // First watching from the roof, then riding along beside the ladder
      // as it hauls you out over the burning city.
      const fixed = start.clone().add(new THREE.Vector3(-5.5, 2.2, 6.5));
      const trail = out.player.clone().add(new THREE.Vector3(-6.5, 1.2, 7));
      out.camera.lerpVectors(fixed, trail, THREE.MathUtils.smoothstep(away, 0.5, 2.5));
      out.look.copy(out.player).lerp(heli ? heli.root.position : grip, 0.3);
      out.done = t > 7;
    }
  }

  /** The host tells the level where the player stood when the ending began. */
  beginEnding(playerPosition) {
    this._playerAtEnding = playerPosition.clone();
  }

  /* ---------------- Lifecycle ---------------- */

  addTo(scene) {
    scene.add(this.root);
    return this;
  }

  /** Compile and upload everything before the roof is shown. */
  prewarm(renderer, camera) {
    const scene = this.root.parent ?? this.root;
    renderer.compile(scene, camera);
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.userData?.disposeGeometry) o.userData.disposeGeometry.dispose();
    });
    this.lift?.userData.dispose?.();
    this.city?.dispose();
    for (const m of this.owned.materials) m.dispose();
    for (const t of this.owned.textures) t.dispose();
    for (const g of this.owned.geometries) g.dispose();
    this.kit.dispose();
    this.fire.dispose();
    this.root.parent?.remove(this.root);
    this.enemies.length = 0;
    this.breakables.length = 0;
    this.events.clear();
  }
}
