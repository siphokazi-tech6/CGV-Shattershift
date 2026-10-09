/**
 * The game's recorded and rendered sounds, sharing the music manager's
 * unlocked AudioContext. Started for Level 1 (the Skyline's fire, water and
 * glass), now every level's: the patients (growls, moans, what is left of
 * their speech), the tower's fire alarm, the player's breathing and voice,
 * explosions and the building coming down, and the cutscenes' sound cues.
 *
 * The rendered sets (assets/audio/creatures, assets/audio/sfx) come from
 * tools/audio/ - see tools/audio/README.md.
 *
 * Sounds load lazily: the first click fetches the original Level 1 set and
 * the player's breath; each stage preloads its own (`preloadStage`).
 */

import { outputFor } from "./output.js";

export const LEVEL1_SFX_VOLUME = Object.freeze({
  /*
   * Balanced by measured loudness (EBU R128) against the dialogue, which
   * plays at about -19 LUFS: one-shots land around -20 to -24, the beds
   * (fire, water, wind, the alarm, your breath) around -25 to -29, the music
   * under it all. The supplied recordings vary by 30 dB between files, hence
   * gains above 1 for the quiet ones (the glass, the wind, the ricochet).
   */
  fire: 1.0,
  impact: 1.5,
  water: 0.25,
  glass: 2.4,
  podBreak: 1.1,
  falling: 0.6,
  gameOver: 0.7,
  glassStep: 0.25,
  elevator: 3.0,
  wind: 3.5,
  throw: 0.45,
  pickup: 0.6,
  wall: 4.0,
  ui: 0.22,
  alarm: 0.38,
  breath: 1.3,
  // The rendered sets are mastered to a common loudness: one gain each.
  patient: 0.85,
  player: 1.0,
  blast: 0.5,
  cue: 0.75,
});

export const LEVEL1_SFX_RANGE = Object.freeze({
  fireNear: 2.5,
  fireMax: 18,
  waterNear: 2,
  waterMax: 14,
});

const url = (path) => new URL(`../../assets/audio/${path}`, import.meta.url).href;

const ASSETS = {
  fire: url("sound-effects/vanzetpictures-fire-457848.mp3"),
  impact: url("sound-effects/sumaga123-wood-hit-432148.mp3"),
  water: url("sound-effects/fire_sprinkler_water_flow_splash.wav"),
  glass: url("sound-effects/eaglaxle-glass-shattering-461637.mp3"),
  podBreak: url("sound-effects/universfield-glass-bottle-breaking-351297.mp3"),
  falling: url("sound-effects/dragon-studio-falling-tree-356127.mp3"),
  gameOver: url("sound-effects/universfield-marimba-game-over-250960.mp3"),
  glassStep: url("sound-effects/368343__johandeecke__glass-hit-32.wav"),
  elevator: url("sound-effects/wind1.wav"),
  wind: url("sound-effects/wind1.wav"),
  throw: url("sound-effects/floraphonic-swing-whoosh-9-198502.mp3"),
  pickup: url("sound-effects/floraphonic-arcade-ui-6-229503.mp3"),
  wall: url("sound-effects/freesound_community-wall-hit-1-100717.mp3"),
  ui: url("sound-effects/justsomesounds-click-sound-432501.mp3"),
};
const ORIGINAL = Object.keys(ASSETS);

/** Sets with variants: one is picked at random each time (never the same twice running). */
export const GROUPS = Object.freeze({
  "patient-growl": 6,
  "patient-moan": 6,
  "patient-speech": 8,
  "patient-shriek": 4,
  "patient-pain": 5,
  "patient-death": 4,
  "patient-roar": 2,
  "patient-horde": 2,
  explosion: 2,
  "distant-collapse": 2,
  "metal-groan": 2,
  "hurt-f": 3,
  "hurt-m": 3,
});
for (const [group, count] of Object.entries(GROUPS)) {
  for (let i = 1; i <= count; i += 1) {
    const name = `${group}-${i}`;
    if (group.startsWith("patient-")) ASSETS[name] = url(`creatures/${name}.mp3`);
    else if (group.startsWith("hurt-")) ASSETS[name] = url(`sfx/hurt-${i}-${group.slice(-1)}.mp3`);
    else ASSETS[name] = url(`sfx/${name}.mp3`);
  }
}
for (const name of [
  "fire-alarm", "demolition-charges", "building-collapse", "debris", "sprinkler-burst", "glass-cascade",
  "monitor-beep", "pistol", "clatter", "brake", "cable-snap", "lift-chime", "lift-doors", "body-hit", "clank", "spark",
]) ASSETS[name] = url(`sfx/${name}.mp3`);
for (const g of ["f", "m"]) {
  for (const kind of ["run", "pant", "scared", "recover"]) ASSETS[`breath-${kind}-${g}`] = url(`sfx/breath-${kind}-${g}.mp3`);
  for (const kind of ["grunt", "scream"]) ASSETS[`${kind}-${g}`] = url(`sfx/${kind}-${g}.mp3`);
}

/** What each stage will want, fetched as it starts. */
const STAGE_SETS = {
  common: ["fire-alarm", "explosion", "distant-collapse", "debris", "glass-cascade", "clank"],
  player: ["breath-run", "breath-pant", "hurt", "grunt", "scream"],
  foundry: ["metal-groan", "spark"],
  lift: ["cable-snap", "brake", "clatter", "lift-chime", "lift-doors", "metal-groan", "spark", "breath-scared", "breath-recover"],
  labs: ["patient-growl", "patient-moan", "patient-speech", "patient-shriek", "patient-pain", "patient-death", "patient-horde", "pistol", "body-hit", "breath-scared", "monitor-beep"],
  skyline: ["demolition-charges", "building-collapse", "metal-groan", "sprinkler-burst", "breath-recover"],
  roof: ["patient-growl", "patient-moan", "patient-shriek", "patient-pain", "patient-death", "patient-roar", "patient-horde", "building-collapse"],
};

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smoothstep = (edge0, edge1, value) => {
  const x = clamp((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
};

export class Level1Audio {
  constructor(getContext) {
    this.getContext = getContext;
    this.context = null;
    this.buffers = new Map();
    this.loads = new Map();
    this.buses = null;
    this.ambient = new Map();
    this.falling = new Map();
    this.gameOverChannel = null;
    this.gameplayChannels = new Set();
    this.cooldowns = new Map();
    this.lastPick = new Map();
    this.debris = [];
    this.generation = 0;
    this.paused = false;
    this.ended = false;
    this.lastGlassStep = -Infinity;
    /** The character picked: "f" or "m" (the player's breath and voice). */
    this.gender = "f";
    this.voiceDucked = false;
  }

  unlock() {
    const context = this.getContext();
    if (!context) return false;
    this.context = context;
    this._ensureBuses();
    // Decode lazily, but begin fetching after the same gesture that unlocks music.
    for (const name of ORIGINAL) this._load(name);
    this.preloadStage("player");
    return true;
  }

  /** "playerFemale" / "playerMale" (meltdown's CHARACTERS keys). */
  setCharacter(name) {
    this.gender = name === "playerMale" ? "m" : "f";
    if (this.context) this.preloadStage("player");
  }

  /** Fetch and decode a stage's sounds ahead of need (common, player, foundry, lift, labs, skyline, roof). */
  preloadStage(stage) {
    if (!this.context) return;
    for (const item of STAGE_SETS[stage] ?? []) {
      for (const name of this._expand(item)) this._load(name);
    }
  }

  _expand(item) {
    if (GROUPS[item]) return Array.from({ length: GROUPS[item] }, (_, i) => `${item}-${i + 1}`);
    if (item === "hurt") return this._expand(`hurt-${this.gender}`);
    if (ASSETS[item]) return [item];
    if (ASSETS[`${item}-${this.gender}`]) return [`${item}-${this.gender}`];
    return [];
  }

  _ensureBuses() {
    if (this.buses || !this.context) return;
    const make = (volume) => {
      const gain = this.context.createGain();
      gain.gain.value = volume;
      gain.connect(outputFor(this.context));
      return gain;
    };
    this.buses = { sfx: make(0.9), ambient: make(0.8), ui: make(0.8) };
  }

  async _load(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    if (!this.context || !ASSETS[name]) return null;
    if (!this.loads.has(name)) {
      const request = fetch(ASSETS[name])
        .then((response) => {
          if (!response.ok) throw new Error(`SFX request failed (${response.status}): ${ASSETS[name]}`);
          return response.arrayBuffer();
        })
        .then((data) => this.context.decodeAudioData(data))
        .then((buffer) => { this.buffers.set(name, buffer); return buffer; })
        .catch((error) => {
          this.loads.delete(name);
          console.warn(`Sound effect could not be loaded: ${name}`, error);
          return null;
        });
      this.loads.set(name, request);
    }
    return this.loads.get(name);
  }

  /** A variant of a group, never the one played last. */
  _pick(group) {
    const count = GROUPS[group] ?? 1;
    let i = 1 + Math.floor(Math.random() * count);
    if (count > 1 && i === this.lastPick.get(group)) i = (i % count) + 1;
    this.lastPick.set(group, i);
    return `${group}-${i}`;
  }

  async _play(name, {
    volume = LEVEL1_SFX_VOLUME[name], bus = "sfx", cooldown = 0, cooldownKey = name,
    playbackRate = 1, offset = 0, gameplay = true, pan = 0, lowpass = 0, delay = 0,
  } = {}) {
    if (!this.context || !this.buses) return null;
    const now = this.context.currentTime;
    const last = this.cooldowns.get(cooldownKey) ?? -Infinity;
    if (cooldown && now - last < cooldown) return null;
    this.cooldowns.set(cooldownKey, now);
    const generation = gameplay ? this.generation : null;
    const buffer = await this._load(name);
    if (!buffer || (gameplay && generation !== this.generation)) return null;
    const ctx = this.context;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume ?? 0.5;
    let node = source;
    if (lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lowpass;
      node = node.connect(filter);
    }
    if (pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      node = node.connect(panner);
    }
    node.connect(gain).connect(this.buses[bus]);
    const channel = { source, gain, name };
    if (gameplay) this.gameplayChannels.add(channel);
    source.onended = () => {
      this.gameplayChannels.delete(channel);
      source.disconnect();
      gain.disconnect();
      if (this.gameOverChannel === channel) this.gameOverChannel = null;
    };
    source.start(ctx.currentTime + delay, Math.min(offset, Math.max(0, buffer.duration - 0.02)));
    return channel;
  }

  /** Any named sound or group, once: { volume, pan, lowpass, playbackRate, cooldown, delay }. */
  play(name, options = {}) {
    if (GROUPS[name]) return this._play(this._pick(name), { cooldownKey: name, volume: LEVEL1_SFX_VOLUME.blast, ...options });
    return this._play(name, { volume: LEVEL1_SFX_VOLUME.cue, ...options });
  }

  uiClick() { this._play("ui", { bus: "ui", cooldown: 0.035, gameplay: false }); }
  throwBall() { this._play("throw", { cooldown: 0.08 }); }
  serumCollected() { this._play("pickup"); }
  sphereCollected() { this._play("pickup"); }
  podBreak() { this._play("podBreak"); }
  surfaceRicochet() { this._play("wall"); }
  glassBreak() {
    // A little different every time: the recording re-pitched.
    this._play("glass", { cooldown: 0.045, playbackRate: 0.86 + Math.random() * 0.3 });
  }
  impact(strength = 1) {
    this._play("impact", { volume: LEVEL1_SFX_VOLUME.impact * clamp(strength, 0.55, 1.15), cooldown: 0.18 });
  }

  /* ---- The patients ------------------------------------------------- */

  /**
   * One of them: growl, moan, speech, shriek, pain, death, roar, horde.
   * `distance` (metres) quietens and muffles it; `pan` -1..1 places it.
   */
  patient(kind, { strength = 1, distance = 0, pan = 0, cooldown = 0.25 } = {}) {
    const group = `patient-${kind}`;
    if (!GROUPS[group]) return null;
    const far = smoothstep(6, 45, distance);
    return this._play(this._pick(group), {
      volume: LEVEL1_SFX_VOLUME.patient * clamp(strength, 0.2, 1.4) * (1 - far * 0.75),
      cooldown,
      cooldownKey: group,
      playbackRate: 0.9 + Math.random() * 0.18,
      pan,
      lowpass: far > 0.05 ? 9000 - far * 7600 : 0,
    });
  }

  /* ---- The player --------------------------------------------------- */

  /** Hit: a grunt of pain (the character's own voice). */
  hurt(strength = 1) {
    this._play(this._pick(`hurt-${this.gender}`), { volume: LEVEL1_SFX_VOLUME.player * clamp(strength, 0.5, 1.2), cooldown: 0.45, cooldownKey: "hurt" });
  }

  /** Effort: a jump, a climb, pulling yourself up. */
  grunt() {
    this._play(`grunt-${this.gender}`, { volume: LEVEL1_SFX_VOLUME.player, cooldown: 0.6 });
  }

  /** Over the edge. */
  fallScream() {
    this._play(`scream-${this.gender}`, { volume: LEVEL1_SFX_VOLUME.player, cooldown: 2 });
  }

  /** A breath one-shot: "pant" (out of breath), "scared" (hiding), "recover" (slowing down). */
  breath(kind) {
    this._play(`breath-${kind}-${this.gender}`, { volume: LEVEL1_SFX_VOLUME.player, cooldown: 1.5, cooldownKey: `breath-${kind}` });
  }

  /**
   * Huffing and puffing while you run: 0 (not running) .. 1 (sprinting, hurt).
   * A loop under everything, in the character's voice.
   */
  updateBreath(level) {
    const want = `breath-run-${this.gender}`;
    const other = `breath-run-${this.gender === "f" ? "m" : "f"}`;
    if (this.ambient.has(other)) this._setAmbient(other, 0, 0);
    this._setAmbient(want, clamp(level) * LEVEL1_SFX_VOLUME.breath, 0, { rate: 0.92 + clamp(level) * 0.16 });
  }

  /* ---- The building ------------------------------------------------- */

  /** The fire alarm, 0..1, muffled 0..1 (a floor away, through concrete). */
  updateAlarm(level, muffle = 0) {
    this._setAmbient("fire-alarm", clamp(level) * LEVEL1_SFX_VOLUME.alarm, 0, { lowpass: muffle > 0.01 ? 16000 - clamp(muffle) * 15000 : 0 });
  }

  explosion(strength = 1, pan = 0) {
    this.play("explosion", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.3, 1.2), pan, cooldown: 0.15 });
  }

  /** Somewhere above or beyond: the building giving way. */
  distantCollapse(strength = 1) {
    this.play("distant-collapse", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.3, 1.2), cooldown: 1.5 });
  }

  /** The tower coming down (the Skyline's demolition, the ending). */
  buildingCollapse(strength = 1) {
    this._play("building-collapse", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.2, 1.2), cooldown: 3 });
  }

  demolitionCharges(strength = 1) {
    this._play("demolition-charges", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.2, 1.2), cooldown: 2 });
  }

  metalGroan(strength = 1, pan = 0) {
    this.play("metal-groan", { volume: LEVEL1_SFX_VOLUME.blast * 0.8 * clamp(strength, 0.2, 1.2), pan, cooldown: 1.2 });
  }

  /** Chunks coming down and settling. */
  debrisFall(strength = 1, pan = 0) {
    this._play("debris", { volume: LEVEL1_SFX_VOLUME.blast * clamp(strength, 0.2, 1.2), pan, cooldown: 0.4 });
  }

  sprinklerBurst(pan = 0) {
    this._play("sprinkler-burst", { volume: LEVEL1_SFX_VOLUME.cue, pan, cooldown: 0.3 });
  }

  glassCascade(strength = 1) {
    this._play("glass-cascade", { volume: LEVEL1_SFX_VOLUME.cue * clamp(strength, 0.3, 1.2), cooldown: 1 });
  }

  async gameOver() {
    if (this.gameOverChannel) return;
    this.ended = true;
    this._applyAmbientTargets();
    for (const channel of this.falling.values()) this._fadeAndStop(channel, 0.1);
    this.falling.clear();
    this.gameOverChannel = await this._play("gameOver", { cooldown: 0.5 });
  }

  stopGameOver(seconds = 0.12) {
    const channel = this.gameOverChannel;
    this.gameOverChannel = null;
    if (!channel || !this.context) return;
    this._fadeAndStop(channel, seconds);
  }

  async startFalling(id) {
    if (this.falling.has(id)) return;
    const generation = this.generation;
    const buffer = await this._load("falling");
    if (!buffer || generation !== this.generation || this.falling.has(id)) return;
    // The supplied eight-second tree clip is much longer than the ~1 second
    // ceiling fall. Use its final 1.35 seconds, then stop on the real landing.
    const channel = await this._play("falling", { offset: Math.max(0, buffer.duration - 1.35), cooldown: 0 });
    if (channel) this.falling.set(id, channel);
  }

  stopFalling(id) {
    const channel = this.falling.get(id);
    if (!channel) return;
    this.falling.delete(id);
    this._fadeAndStop(channel, 0.1);
  }

  addGlassDebris(position, radius = 1.8) {
    if (!this.context) return;
    this.debris.push({ x: position.x, z: position.z, radius: clamp(radius, 1.2, 3.5), expires: this.context.currentTime + 5 });
    if (this.debris.length > 20) this.debris.shift();
  }

  updateBrokenGlass(position, moving) {
    if (!this.context || this.paused || this.ended || !moving) return;
    const now = this.context.currentTime;
    this.debris = this.debris.filter((zone) => zone.expires > now);
    const onGlass = this.debris.some((zone) => Math.hypot(position.x - zone.x, position.z - zone.z) <= zone.radius);
    if (onGlass && now - this.lastGlassStep >= 0.58) {
      this.lastGlassStep = now;
      this._play("glassStep", { cooldown: 0.52, playbackRate: 0.9 + Math.random() * 0.2 });
    }
  }

  updateEnvironment(environment) {
    if (!environment) return;
    const fire = environment.fire;
    const fireLevel = fire
      ? (1 - smoothstep(LEVEL1_SFX_RANGE.fireNear, LEVEL1_SFX_RANGE.fireMax, fire.distance)) * fire.intensity
      : 0;
    const water = environment.water;
    const waterLevel = water
      ? (1 - smoothstep(LEVEL1_SFX_RANGE.waterNear, LEVEL1_SFX_RANGE.waterMax, water.distance)) * water.flow
      : 0;
    this._setAmbient("fire", fireLevel * LEVEL1_SFX_VOLUME.fire, fire?.offsetX ?? 0);
    this._setAmbient("water", waterLevel * LEVEL1_SFX_VOLUME.water, water?.offsetX ?? 0);
  }

  /** Wind across the top of a tower (the Roof): 0..1. */
  updateWind(level) {
    this._setAmbient("wind", clamp(level) * LEVEL1_SFX_VOLUME.wind, 0);
  }

  updateElevator(velocity, active) {
    const level = active ? smoothstep(0.2, 5, velocity) * LEVEL1_SFX_VOLUME.elevator : 0;
    this._setAmbient("elevator", level, 0);
  }

  async _setAmbient(name, volume, offsetX, { lowpass = 0, rate = 1 } = {}) {
    const desired = { volume, pan: clamp(offsetX / 7, -0.65, 0.65), lowpass, rate };
    let channel = this.ambient.get(name);
    if (channel === undefined && volume > 0.001 && this.context) {
      // A placeholder while it loads, so a second call does not start a second loop.
      this.ambient.set(name, null);
      (this.pendingAmbient ??= new Map()).set(name, desired);
      const generation = this.generation;
      const buffer = await this._load(name);
      if (generation !== this.generation || this.ambient.get(name) !== null) return;
      if (!buffer) { this.ambient.delete(name); return; }
      const ctx = this.context;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner?.() ?? null;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 20000;
      source.buffer = buffer;
      source.loop = true;
      // Skip the encoder's silent padding at either end, so the loop has no gap.
      const [start, end] = loopBounds(buffer);
      source.loopStart = start;
      source.loopEnd = end;
      gain.gain.value = 0;
      let node = source.connect(filter);
      if (panner) node = node.connect(panner);
      node.connect(gain);
      gain.connect(this.buses.ambient);
      channel = { source, gain, panner, filter, desired: this.pendingAmbient.get(name) ?? desired };
      this.pendingAmbient.delete(name);
      this.ambient.set(name, channel);
      source.start(0, start);
      this._rampAmbient(channel, 0.18);
      return;
    }
    if (!channel) {
      // Still loading: remember the latest wish for when it is ready.
      this.pendingAmbient?.set(name, desired);
      return;
    }
    channel.desired = desired;
    this._rampAmbient(channel, 0.18);
  }

  _rampAmbient(channel, seconds) {
    if (!this.context || !channel) return;
    const factor = this.paused ? 0 : this.ended ? 0.45 : 1;
    const d = channel.desired;
    this._ramp(channel.gain.gain, d.volume * factor, seconds);
    if (channel.panner) this._ramp(channel.panner.pan, d.pan, seconds);
    if (channel.filter) this._ramp(channel.filter.frequency, d.lowpass || 20000, seconds);
    if (d.rate && Math.abs(channel.source.playbackRate.value - d.rate) > 0.005) this._ramp(channel.source.playbackRate, d.rate, 0.5);
  }

  _applyAmbientTargets() {
    for (const channel of this.ambient.values()) this._rampAmbient(channel, 0.18);
  }

  /** Someone is talking: the beds (fire, alarm, breath) step back a little. */
  duckForVoice(on) {
    if (!this.buses || on === this.voiceDucked) return;
    this.voiceDucked = on;
    this._ramp(this.buses.ambient.gain, on ? 0.5 : 0.8, on ? 0.25 : 0.6);
  }

  setPaused(paused) {
    this.paused = paused;
    if (this.buses) this._ramp(this.buses.sfx.gain, paused ? 0 : 0.9, 0.12);
    this._applyAmbientTargets();
  }

  startLevel() {
    this.cleanupLevel();
    this.paused = false;
    this.ended = false;
  }

  cleanupLevel() {
    this.generation += 1;
    this.paused = false;
    this.ended = false;
    this.stopGameOver();
    for (const channel of this.ambient.values()) if (channel) this._fadeAndStop(channel, 0.12);
    for (const channel of this.falling.values()) this._fadeAndStop(channel, 0.08);
    for (const channel of [...this.gameplayChannels]) this._stop(channel);
    this.ambient.clear();
    this.pendingAmbient?.clear();
    this.falling.clear();
    this.gameplayChannels.clear();
    this.debris.length = 0;
    this.cooldowns.clear();
    this.lastGlassStep = -Infinity;
  }

  _ramp(param, value, seconds) {
    const now = this.context.currentTime;
    if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(now);
    else { param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); }
    param.linearRampToValueAtTime(value, now + seconds);
  }

  _fadeAndStop(channel, seconds) {
    if (!this.context) return;
    this._ramp(channel.gain.gain, 0, seconds);
    try { channel.source.stop(this.context.currentTime + seconds + 0.02); } catch (error) {}
  }

  _stop(channel) {
    try { channel.source.stop(); } catch (error) {}
  }

  snapshot() {
    return {
      ambient: [...this.ambient.keys()],
      falling: this.falling.size,
      gameplayChannels: this.gameplayChannels.size,
      debrisZones: this.debris.length,
      gameOver: Boolean(this.gameOverChannel),
      paused: this.paused,
      ended: this.ended,
      loaded: this.buffers.size,
    };
  }
}

/**
 * Where a looped buffer's sound really starts and ends: an mp3 decoder may
 * leave the encoder's padding (exact silence) at either end, which a loop
 * would play as a gap.
 */
export function loopBounds(buffer) {
  const data = buffer.getChannelData(0);
  const quiet = 1e-4;
  let a = 0;
  let b = data.length - 1;
  const limit = Math.min(data.length >> 2, Math.round(buffer.sampleRate * 0.1));
  while (a < limit && Math.abs(data[a]) < quiet) a += 1;
  while (data.length - 1 - b < limit && Math.abs(data[b]) < quiet) b -= 1;
  return [a / buffer.sampleRate, (b + 1) / buffer.sampleRate];
}
