import * as THREE from "./src/three.js";
import { FoundryLevel } from "./src/levels/foundry/index.js";
import { FoundryHud } from "./src/ui/foundry-hud.js";
import { CausewayLevel, LAYERS, ROUTE as CAUSEWAY_ROUTE } from "./src/levels/causeway/index.js";
import { CausewayHud, HUD_PANELS, applyHudPanels } from "./src/ui/causeway-hud.js";
import { PostFX } from "./src/fx/postfx.js";
import { Minimap } from "./src/fx/minimap.js";
import { PhotoMode } from "./src/fx/photo-mode.js";
import { Arsenal, BALLS, SERUMS } from "./src/systems/arsenal.js";
import { SPHERE_GEOMETRY, sphereMaterial, sphereHalo } from "./src/systems/spheres.js";
import { buildBallPickers, buildTabs, showMoves, savedBall } from "./src/ui/menus.js";
import { PowerupBanner } from "./src/ui/powerup-banner.js";
import { MissionTracker, loadProgress } from "./src/systems/missions.js";
import { CalibrationLift, LIFT_RADIUS } from "./src/levels/common/calibration-lift.js";
import { PlayerAvatar, THROW_RELEASE } from "./src/levels/meltdown/player.js";
import { loadMeltdownAssets } from "./src/levels/meltdown/assets.js";
import { MeltdownGame, CHARACTERS, START_BALLS as MELTDOWN_START_BALLS, savedCharacter, saveCharacter } from "./src/levels/meltdown/game.js";
import { MusicManager } from "./src/audio/music-manager.js";
import { Level1Audio } from "./src/audio/level1-audio.js";
import { FoundryAmbience } from "./src/audio/foundry-ambience.js";
import { GravityFaultRide } from "./src/elevators/gravity-fault.js";
import { QuietRide, LINES as RADIO_LINES } from "./src/elevators/quiet-ride.js";
import { ShatterFX } from "./src/fx/shatter.js";
import { SphereImpactFX } from "./src/fx/sphere-impact.js";
import { CollectibleSet, foundSummary } from "./src/systems/collectibles.js";
import { StoryLayer } from "./src/story/story-layer.js";
import { Companion, loadStoryCharacter } from "./src/story/companion.js";
import { wakeScene, walkOutScene } from "./src/story/scenes.js";
import { WardStage } from "./src/story/stages/ward.js";
import { FoundryGuide } from "./src/story/foundry-guide.js";
import { DemolitionTower } from "./src/story/stages/demolition-tower.js";
import { LedgeHands } from "./src/story/stages/ledge-hands.js";
import { SmokeSky } from "./src/story/stages/night-sky.js";
import { PoliceHelicopters } from "./src/fx/police-helicopters.js";
import { Prologue } from "./src/story/prologue.js";
import { themeAt as causewayThemeAt } from "./src/levels/causeway/layout.js";
import { blastScene } from "./src/story/scenes-skyline.js";
import { SCENES as STORY_LINES } from "./src/story/script.js";
import { figureStage, SKIN_TONES, savedSkinTone, saveSkinTone } from "./src/figure/look.js";

const canvas = document.querySelector("#game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
// Shadows: one map, rendered once per frame by the post pipeline rather than
// once per render call (the reflection probe and minimap render too).
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
// Draw calls are summed across every render call in a frame, then reset.
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x140b09);
scene.fog = new THREE.FogExp2(0x140b09, 0.032);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 150);
// The main camera sees the world, glass, and effects layers - never the
// minimap icons.
camera.layers.enable(LAYERS.GLASS);
camera.layers.enable(LAYERS.FX);
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
raycaster.layers.enableAll();
const pointer = new THREE.Vector2();
const lanes = [-3.2, 0, 3.2];
const breakables = [];
const RENDER_AHEAD = 95;
const projectiles = [];
const obstacles = [];
let state = "intro";
let lane = 1;
let playerX = 0;
let runZ = 7;
let ammo = 12;
let health = 100;
let score = 0;
let cameraThird = false;
let liftTimer = 0;
let messageTimer = 0;
let currentLevel = 1;
let transitionTarget = 0;
let playerY = 0;
let paused = false;
let launchTimer = 0;
let captionIndex = -1;
let settingsFrom = null;
let shake = 0;
// Jump and slide. Level 2's barriers need them: a low barrier is hurdled and a
// high one is slid under, and each is cleared by exactly one of the two.
let jumpVelocity = 0;
let jumpHeight = 0;
let sliding = 0;
/** A jump pressed just before landing still happens (seconds left on it). */
let jumpBuffer = 0;

/** Jump (Space, or W / up in the Foundry - as in the Labs). */
function pressJump() {
  if (jumpHeight <= 0.01) jumpVelocity = 7.4;
  else jumpBuffer = 0.16;
}
/** Slide (Shift, or S / down in the Foundry); in the air, slam down into it. */
function pressSlide() {
  sliding = 0.65;
  if (jumpHeight > 0.05) jumpVelocity = Math.min(jumpVelocity, -12);
}
/**
 * Set when the player is teleported - a demo jump, or arriving in a sector that
 * lives elsewhere in world space. The chase camera eases toward its target,
 * which crawls across hundreds of metres after a jump and leaves the player
 * staring at the level from outside it.
 */
let snapCamera = true;
/** Level 3 (src/levels/meltdown/game.js), built on the way into it. */
let meltdown = null;
/** The Level 2 -> 3 lift ride (src/elevators/gravity-fault.js), while it runs. */
let gravityLift = null;
/**
 * The story runs Foundry (sector 1) -> Labs (sector 2) -> Skyline (sector 3)
 * -> Roof (the finale), riding a lift up between each. `currentLevel` still
 * names the *environment* - 1 Causeway (the Skyline), 2 Foundry, 3 Meltdown
 * (the Labs and the Roof) - so each level's own code keeps its id;
 * `sectorNumber()` is the order the player sees. Endless mode is separate:
 * pick any one environment and run it until you go down.
 */
let runKind = "story"; // "story" | "endless"
/** Seconds actually played this run (not paused, not in the menus): the records' clock. */
let runClock = 0;
/** A story run begun at Sector 01 - only those can set the story record. */
let runFromStart = false;
/** False once a demo key (1-6) or a debug jump has been used: no records for this run. */
let runRecordable = false;
/** A demo jump: the run goes on, but its time no longer counts. */
function markDemo() {
  runFromStart = false;
  runRecordable = false;
}
let endlessEnv = null; // "foundry" | "labs" | "skyline" | "roof"
const endlessRun = { laps: 0, distance: 0 };
let foundrySpeedScale = 1;
/** Launcher balls carried from the Labs up to the Roof. */
let storyBalls = null;
/** Level 3's module is running the Roof (not the Labs). */
let onRoofStage = false;
/**
 * A real story run, started from the menu (Start / Run again): the only
 * kind that plays cutscenes and has Dr. Okoro along. Endless never does,
 * and neither do the demo jumps (keys 1-5) - `__dbg.story.jump()` reaches
 * any scene instead.
 */
let storyRun = false;
/** The check harness steps the game itself (`__dbg.manual`). */
let manualStep = false;
/**
 * The story's checkpoint: the sector the player is in and what they carried
 * into it. A death in a story run restarts that sector - with its cutscenes -
 * not the whole run. { stage: "foundry"|"labs"|"skyline"|"roof", score, ammo, balls }
 */
let storyCheckpoint = null;
/** The last run ended in a story death (the end screen offers the sector again). */
let storyDeath = false;


const settingsDefaults = {
  sensitivity: 100, aimAssist: true, reducedMotion: false, quality: "auto",
  // The story's reaction hits (src/story/reaction.js).
  longReactions: false, holdInsteadOfMash: false,
  // Subtitle size (there are no voiceovers, so they must be easy to read):
  // "normal", "large" or "xl" - see --sub-scale in styles.css.
  subtitleSize: "large",
  // Which HUD panels are shown. See HUD_PANELS in src/ui/causeway-hud.js.
  hud: Object.fromEntries(HUD_PANELS.map((p) => [p.key, p.on])),
};
let settings = { ...settingsDefaults };
try {
  const saved = JSON.parse(localStorage.getItem("fractureRunSettings"));
  if (saved) settings = { ...settingsDefaults, ...saved, hud: { ...settingsDefaults.hud, ...(saved.hud ?? {}) } };
} catch (error) {}

function saveSettings() {
  try { localStorage.setItem("fractureRunSettings", JSON.stringify(settings)); } catch (error) {}
  document.body.classList.toggle("reduced-motion", !!settings.reducedMotion);
}
document.body.classList.toggle("reduced-motion", !!settings.reducedMotion);

// Music belongs to the application shell, not a level: Level 1 can be rebuilt
// by Play Again while its soundtrack and playback position remain untouched.
// Level 3's existing synthesized effects remain independent.
const music = new MusicManager();
const level1Audio = new Level1Audio(() => music.context);
// The player's breath, grunts and screams are the character's own.
level1Audio.setCharacter(savedCharacter());
// The Foundry's machinery, heard (synthesized on the same context).
const foundryAmbience = new FoundryAmbience(() => (music.context?.state === "running" ? music.context : null));
// Level 1's GPU glass shards, for the Foundry (the Causeway has its own; the
// Labs and the Roof make theirs in their own scene). The Foundry runs down
// -Z at x = 0 with a floor at y = 0, 5.6 m either side.
const shatterFX = new ShatterFX(scene, { floorHalfWidth: 5.6, env: [0x9fb4ba, 0x14110e, 0x4c5a5e] });
// A special sphere going off: its colour pulsing out (the Skyline has its own).
const sphereImpact = new SphereImpactFX(scene);
music.showMenu();
const unlockMusic = async (event) => {
  // Set the briefing intent before unlocking on the same pointer/key gesture,
  // so the menu track cannot briefly start while the piano is loading.
  if (event.target?.closest?.("#storyBeginButton, #replayStoryButton")) music.showStory();
  const ready = music.unlock(); // Creates the shared context synchronously.
  level1Audio.unlock();
  if (await ready) level1Audio.unlock();
};
addEventListener("pointerdown", unlockMusic, { passive: true });
addEventListener("keydown", unlockMusic);

/*
 * The story layer: one per page, shared by every level (src/story/). The
 * cutscenes, reaction hits, subtitles and Dr. Okoro's talk during play. It is
 * clocked by updateGame, so pausing freezes it.
 */
const story = new StoryLayer({
  getAudioContext: () => music.context,
  // The stage directions' sounds ([breathing hard], [a pistol shot]...).
  sfx: level1Audio,
  blurTargets: [canvas],
  options: { longWindows: settings.longReactions, holdInsteadOfMash: settings.holdInsteadOfMash, reducedMotion: settings.reducedMotion },
});
// Esc tapped during a cutscene: the pause menu (held: skip).
story.player.on("pause-request", () => openPause());
/** Dr. Okoro: one companion in the main scene (the ward and the Foundry). */
const okoro = new Companion({ bag: true });
okoro.root.visible = false;
/** The ward the story opens in, while it exists. */
let ward = null;
/** Okoro's run through the Foundry, while it runs. */
let foundryGuide = null;
/** The player's body is shown during a main-scene cutscene from this point on. */
let cutsceneShowsPlayer = false;

const $ = (selector) => document.querySelector(selector);
const ui = {
  level: $("#level"), ammo: $("#ammo"), health: $("#health"), score: $("#score"),
  camera: $("#cameraMode"), reticle: $("#reticle"), message: $("#message"), caption: $("#caption"),
  launchControls: $("#launchControls"),
  story: $("#storyScreen"), storyLine: $("#storyLine"),
  storyPrompt: $("#storyPrompt"), storyPlayer: $("#storyPlayer"),
  storyDots: $("#storyDots"), storySkipButton: $("#storySkipButton"),
  start: $("#startScreen"), end: $("#endScreen"), final: $("#finalScore"),
  endEyebrow: $("#endEyebrow"), endTitle: $("#endTitle"), endText: $("#endText"), endStats: $("#endStats"),
  pause: $("#pauseScreen"), pauseLevel: $("#pauseLevel"), pauseScore: $("#pauseScore"),
  pauseAmmo: $("#pauseAmmo"), pauseHealth: $("#pauseHealth"), pauseMissions: $("#pauseMissions"),
  settings: $("#settingsScreen"),
  settingsBackButton: $("#settingsBackButton"),
  sensitivitySlider: $("#sensitivitySlider"), reducedMotionToggle: $("#reducedMotionToggle"),
  aimAssistToggle: $("#aimAssistToggle"),
  longReactionsToggle: $("#longReactionsToggle"), holdInsteadOfMashToggle: $("#holdInsteadOfMashToggle"),
  subtitleSizeSelect: $("#subtitleSizeSelect"),
  viewButton: $("#viewButton"), viewMenu: $("#viewMenu"), briefing: $("#briefingMissions"),
  qualitySelect: $("#qualitySelect"),
  qualityNote: $("#qualityNote"),
  manual: $("#manualScreen"), chapters: $("#chaptersScreen"), fade: $("#fadeOverlay"),
  endlessButton: $("#endlessButton"), progressLine: $("#progressLine"), endless: $("#endlessScreen"),
};

function applySettingsToControls() {
  ui.sensitivitySlider.value = settings.sensitivity;
  ui.aimAssistToggle.checked = settings.aimAssist;
  ui.reducedMotionToggle.checked = settings.reducedMotion;
  document.body.classList.toggle("reduced-motion", settings.reducedMotion);
  if (ui.longReactionsToggle) ui.longReactionsToggle.checked = settings.longReactions;
  if (ui.holdInsteadOfMashToggle) ui.holdInsteadOfMashToggle.checked = settings.holdInsteadOfMash;
  ui.qualitySelect.value = settings.quality;
  ui.subtitleSizeSelect.value = settings.subtitleSize;
  applySubtitleSize();
  for (const input of document.querySelectorAll("[data-hud-key]")) input.checked = !!settings.hud[input.dataset.hudKey];
  applyHudPanels(settings.hud);
}

/** Every subtitle in the game (cutscenes, the intercom, the lift rides) scales with this. */
function applySubtitleSize() {
  const scale = { normal: 1, large: 1.25, xl: 1.55 }[settings.subtitleSize] ?? 1.25;
  document.documentElement.style.setProperty("--sub-scale", String(scale));
}

/** Build the HUD panel checkboxes into every [data-hud-toggles] container. */
function buildHudToggles() {
  for (const container of document.querySelectorAll("[data-hud-toggles]")) {
    container.innerHTML = HUD_PANELS.map((p) => `
      <label class="setting-row toggle-row"><span>${p.label}</span><input type="checkbox" data-hud-key="${p.key}" /></label>`).join("");
  }
  for (const input of document.querySelectorAll("[data-hud-key]")) {
    input.addEventListener("change", () => {
      settings.hud[input.dataset.hudKey] = input.checked;
      saveSettings();
      applySettingsToControls();
    });
  }
}
buildHudToggles();
applySettingsToControls();

// Named so Level 2 can dim it - the foundry brings its own lighting.
const hemi = new THREE.HemisphereLight(0xffd0a0, 0x2a1510, 1.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe4c4, 2.5);
sun.position.set(-8, 16, 12);
scene.add(sun);

// Level 3's old prototype (the "Inverted Core": slabs, gravity rings, panes
// and crystals along z = 0..-438, and the Level 2 -> 3 lift at z = -282)
// was removed when the real Level 3 - The Meltdown - was integrated. It
// lives in src/levels/meltdown/ with its own scene; see the MELTDOWN
// INTEGRATION block below.

const railMat = new THREE.MeshStandardMaterial({ color: 0x35241c, metalness: 0.75, roughness: 0.26 });

function makeSmokeTexture() {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,170,110,0.45)");
  gradient.addColorStop(1, "rgba(255,170,110,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

const smokeTexture = makeSmokeTexture();
const smokeSprites = [];
for (let i = 0; i < 12; i++) {
  const material = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: .4, blending: THREE.AdditiveBlending, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(7 + Math.random() * 6);
  sprite.userData = { speed: .3 + Math.random() * .4, phase: Math.random() * Math.PI * 2 };
  sprite.position.set((Math.random() - .5) * 8, .5 + Math.random() * 4, 4 - i * 8);
  scene.add(sprite); smokeSprites.push(sprite);
}

function updateSmoke(dt, time) {
  for (const sprite of smokeSprites) {
    sprite.visible = currentLevel !== 1;
    sprite.position.x += Math.sin(time * sprite.userData.speed + sprite.userData.phase) * dt * .4;
    if (sprite.position.z > runZ + 8 || sprite.position.z < runZ - RENDER_AHEAD) {
      sprite.position.set((Math.random() - .5) * 8, .5 + Math.random() * 4, runZ - 25 - Math.random() * (RENDER_AHEAD - 25));
    }
  }
}

const avatar = new THREE.Group();
const body = new THREE.Mesh(new THREE.CapsuleGeometry(.42, 1.05, 6, 12), new THREE.MeshStandardMaterial({ color: 0xffece0, roughness: .3, metalness: .45 })); body.position.y = 1.1; avatar.add(body);
const pack = new THREE.Mesh(new THREE.BoxGeometry(.65, .8, .3), railMat); pack.position.set(0, 1.2, .42); avatar.add(pack); scene.add(avatar);
// The figure is unchanged; it only casts a shadow now that Level 1 has sun shadows.
avatar.traverse((o) => { if (o.isMesh) o.castShadow = true; });

/**
 * The player's body in Levels 1 and 2 is the same character as in Level 3:
 * the patient picked on the start screen ("Play as"), animated by Level 3's
 * body rig (src/levels/meltdown/player.js) from the run's real speed, lane
 * changes, jumps and slides. Subject 07 throws spheres by hand, so there is
 * no launcher to hold here. The capsule above stays as a stand-in until the
 * model has loaded (or if it cannot load).
 */
const playerBody = new PlayerAvatar();
playerBody.hold = 0;
playerBody.setSkinTone(savedSkinTone());
let playerBodyReady = false;
/** The chosen character's model template, for the lift ride to show the same person. */
let playerBodyTemplate = null;
let playerBodyX = 0;
const playerBodyMaterials = [];
async function loadPlayerBody(name = savedCharacter()) {
  const assets = await loadMeltdownAssets(MELTDOWN_ASSET_BASE, { names: [name] });
  const asset = assets.get(name);
  if (!asset || name !== savedCharacter()) return;
  playerBody.setModel(asset.template);
  playerBodyTemplate = asset.template;
  playerBodyMaterials.length = 0;
  // A touch of self-light, so the body reads in Level 1's dark, fire-lit
  // halls (Level 1 turns the global lights off). Set once; the per-level
  // strength is a uniform, so changing it costs nothing.
  playerBody.model?.traverse((o) => {
    if (!o.isMesh || !o.material?.map) return;
    o.material.emissiveMap = o.material.map;
    o.material.emissive.setRGB(1, 1, 1);
    o.material.needsUpdate = true;
    playerBodyMaterials.push(o.material);
  });
  if (!playerBodyReady) {
    avatar.add(playerBody.root);
    body.visible = false;
    pack.visible = false;
    playerBodyReady = true;
  }
}

/**
 * Where the run is in the story, for the figure's wear (src/figure/look.js):
 * 0 waking up (the menus), then the sector - 1 the Foundry, 2 the Labs,
 * 3 the Skyline and the Roof.
 */
function storyPosition() {
  return state === "intro" ? 0 : sectorNumber();
}

function updatePlayerBody(dt) {
  // Damage follows the story: clean waking up, worse with every level.
  const stage = figureStage(storyPosition());
  playerBody.setWear(stage.wear);
  playerBody.setGear(stage.gear);
  if (!playerBodyReady) return;
  const moving = state === "playing" && !paused;
  const speed = !moving ? 0 : currentLevel === 1 ? run.speed : currentLevel === 2 ? foundryPace : 0;
  const lateralVel = dt > 0 ? (playerX - playerBodyX) / dt : 0;
  playerBodyX = playerX;
  const glow = currentLevel === 1 ? 0.32 : 0.06;
  for (const m of playerBodyMaterials) m.emissiveIntensity = glow;
  playerBody.update(dt, {
    speed,
    lateralVel,
    height: jumpHeight,
    sliding: sliding > 0,
    stumble: run.damage > 0.5 || foundrySlow > 0.3 ? 1 : 0,
  });
}

/** The sector the player is in, in story order (1 Foundry, 2 Labs, 3 Skyline and the Roof). */
function sectorNumber(level = currentLevel) {
  if (level === 2) return 1;
  if (level === 3) return onRoofStage ? 3 : 2;
  return 3;
}

/** "02 / 03", "01 → 02" while riding the lift between sectors, "03+ / 03" on the roof. */
function sectorLabel() {
  if (state === "lift" && currentLevel === 2) return "01 → 02";
  if (currentLevel === 3 && onRoofStage) return "03+ / 03";
  return `0${sectorNumber()} / 03`;
}

function updateUI() {
  ui.level.textContent = sectorLabel();
  ui.ammo.textContent = ammo; ui.health.textContent = Math.max(0, Math.round(health)); ui.score.textContent = String(Math.floor(score)).padStart(6, "0");
  ui.camera.textContent = currentLevel === 3 && meltdown ? meltdown.cameraModeName : cameraThird ? "CHASE VIEW" : "FIRST PERSON";
}

function showMessage(text) {
  ui.message.textContent = text;
  ui.message.classList.add("show");
  // A section title up there already: the line sits under it, not across it.
  ui.message.classList.toggle("under-title", !!document.querySelector(".cw-title.show, .mlt-banner.show"));
  messageTimer = 1.2;
}

/* ==================================================================== */
/* FOUNDRY INTEGRATION - Level 2                                         */
/* ==================================================================== */

/**
 * The foundry is 764m long and the old Level 2 slot was about 128m, so it is
 * built far out in unused world space and the player is teleported there when
 * Level 2 begins. Level 3's geometry keeps its original position, and the
 * existing per-level culling already hides everything that is not the current
 * sector.
 */
const FOUNDRY_ORIGIN_Z = -1200;

/** Matches the pacing tuned in the level design sheet. */
const FOUNDRY_SPEED_ZONES = [
  { until: 0.5, speed: 6.8 },
  { until: 0.75, speed: 9.0 },
  { until: 1.01, speed: 11.6 },
];

let foundry = null;
/**
 * Level 2 ends the way Level 1 does: past the extraction valve the corridor
 * opens onto a landing and the Calibration Lift (Level 1's glass elevator,
 * src/levels/common/calibration-lift.js) takes the player up to Level 3.
 */
let foundryLift = null;
let foundryExit = false;
const FOUNDRY_LANDING = 12;
const foundryHud = new FoundryHud({ dev: false, reducedMotion: settings.reducedMotion });
// Sits alongside the game's own HUD rather than owning the screen.
foundryHud.root.classList.add("embedded");
const foundryBox = new THREE.Box3();
const foundryCentre = new THREE.Vector3();
const foundrySize = new THREE.Vector3();
const foundryGrazed = new Map();
let foundryInvulnerable = 0;
let foundrySlow = 0;
/** The Foundry run's actual pace (m/s), easing toward foundrySpeed(). */
let foundryPace = 0;
let combo = 1;
let comboTimer = 0;

/** Distance along the foundry route, derived from the game's own runZ. */
function foundryDistance() {
  return FOUNDRY_ORIGIN_Z - runZ;
}

function foundrySpeed() {
  if (!foundry) return 9.2;
  const progress = foundryDistance() / foundry.route.totalLength;
  // The story's opening is gentler: slower, so the player can listen to Okoro.
  if (storyRun && progress < STORY_GENTLE_START) return 5.6;
  return (FOUNDRY_SPEED_ZONES.find((zone) => progress < zone.until) ?? FOUNDRY_SPEED_ZONES[2]).speed * foundrySpeedScale;
}

/** The first 15% of the Foundry, in a story run: no filler hazards, a slower pace. */
const STORY_GENTLE_START = 0.15;

/** @param {number} [variant]  0 = the authored layout; endless laps reshuffle it */
/** The Foundry's plant logs, while the Foundry is built (story and demo runs). */
let foundryFiles = null;

/** A collectible coming up: a nudge to go and get it. */
function collectibleNear({ label, level }) {
  // The roof is an arena (no "ahead"): say where, not which way.
  causewayHud.hint(level === "roof" ? `${label} up here - the gold beam. Walk into it.` : `${label} ahead - the gold beam. Run through it.`, 2.6);
}

/** A collectible found (any level): the recovered panel, a chime, some score. */
function collectibleFound({ lines, found, total, label }) {
  causewayHud.caseFile(lines, found, total, label);
  level1Audio.serumCollected();
  score += 500 * combo;
  updateUI();
}

function buildFoundry(variant = 0) {
  if (foundry) {
    foundryHud.unbind();
    foundry.dispose();
  }
  foundryLift?.dispose();

  foundry = new FoundryLevel({
    origin: new THREE.Vector3(0, 0, FOUNDRY_ORIGIN_Z),
    // The game's player moves along -Z and does not follow a curve yet, so the
    // junctions are off. Flip this to false once PlayerController follows
    // route.sample(distance) - see the level design sheet.
    straightRoute: true,
    shadows: false,
    brightness: 1.6,
    runSpeed: FOUNDRY_SPEED_ZONES[2].speed,
    variant,
    gentleStart: storyRun ? STORY_GENTLE_START : 0,
  });
  foundry.addTo(scene);
  foundry.root.visible = false;
  foundryExit = false;
  foundryLift = new CalibrationLift({ landing: FOUNDRY_LANDING, landingWidth: 11.2, core: { ceiling: 7.8 } });
  foundryLift.root.position.set(0, 0, FOUNDRY_ORIGIN_Z - foundry.route.totalLength - FOUNDRY_LANDING - LIFT_RADIUS);
  foundryLift.root.visible = false;
  scene.add(foundryLift.root);

  // The plant logs (src/systems/collectibles.js): four down the route, on the
  // outer lanes, in the story and the demo runs (not Endless).
  foundryFiles?.dispose();
  foundryFiles = null;
  if (runKind !== "endless") {
    const total = foundry.route.totalLength;
    const spots = [[0.16, -3.4], [0.4, 3.4], [0.63, -3.4], [0.86, 3.4]];
    foundryFiles = new CollectibleSet("foundry", { positions: spots.map(([k, x]) => foundry.route.sample(total * k, x).position.clone()) });
    foundry.root.add(foundryFiles.root);
  }

  foundryHud.bind(foundry);
  foundry.events.on("complete", () => {
    if (currentLevel !== 2 || state !== "playing") return;
    score += Math.max(0, foundry.state.systemsOnline * 500 + health * 10);
    // Keep running: out of the furnace, across the landing, into the lift.
    foundryExit = true;
    showMessage("EXTRACTION VALVE // TO THE LIFT");
    updateUI();
  });
  foundry.events.on("escape-end", ({ survived }) => {
    if (survived || currentLevel !== 2) return;
    health = 0; updateUI(); endRun(false);
  });

  foundryGrazed.clear();
  foundryInvulnerable = 0;
  foundrySlow = 0;
}

/** Called when the player enters or leaves Level 2. */
/**
 * What the Foundry's metal reflects: a dark plant room, the furnace glowing
 * orange down one side, cold work lights overhead. Without it the plating
 * (metalness ~0.9) has nothing to reflect and reads flat black.
 */
let foundryEnvironment = null;
function foundryEnvMap() {
  if (foundryEnvironment) return foundryEnvironment;
  const env = new THREE.Scene();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const made = [box];
  const add = (colour, strength, sx, sy, sz, x, y, z, side = THREE.FrontSide) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(colour).multiplyScalar(strength), side });
    made.push(material);
    const m = new THREE.Mesh(box, material);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    env.add(m);
  };
  add(0x1a1f23, 1, 30, 14, 40, 0, 4, 0, THREE.BackSide);   // the shell
  add(0xff6a1e, 2.4, 0.4, 3, 14, -9, 1, -4);                 // the furnace's glow
  add(0xffa040, 1.2, 0.4, 1, 10, 9, 0.5, 6);                 // a heat vent
  for (const z of [-12, -4, 4, 12]) add(0xd6ecff, 3.5, 6, 0.2, 0.5, 0, 9, z); // work lights
  add(0x38515c, 1.5, 30, 0.2, 40, 0, -2.5, 0);               // light coming back off the floor
  const pmrem = new THREE.PMREMGenerator(renderer);
  foundryEnvironment = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  for (const x of made) x.dispose();
  return foundryEnvironment;
}

function setFoundryActive(active) {
  if (!foundry) return;
  foundry.root.visible = active;
  if (foundryLift) foundryLift.root.visible = active;
  if (active) {
    preloadMeltdown();
    foundryHud.show();
    foundryHud.setIntegrity(health);
    // The global sun and hemisphere are tuned for the causeway and wash the
    // foundry flat; the level brings its own lighting.
    sun.intensity = 0.35;
    hemi.intensity = 0.35;
    scene.fog.density = 0.0115;
    scene.fog.color.set(0x141d23);
    scene.background.set(0x121a20);
    scene.environment = foundryEnvMap();
    foundryAmbience.start();
  } else {
    foundryHud.hide();
    scene.environment = null;
    foundryAmbience.stop();
    sun.intensity = 2.5;
    hemi.intensity = 1.8;
    scene.fog.density = 0.032;
    scene.fog.color.set(0x140b09);
    scene.background.set(0x140b09);
  }
}

/** Player bounds for the foundry's own collision test. */
function updateFoundryBox() {
  const height = sliding > 0 ? 1.0 : 1.9;
  foundryCentre.set(playerX, 0.18 + playerY + jumpHeight + height / 2, runZ);
  foundrySize.set(0.9, height, 0.9);
  foundryBox.setFromCenterAndSize(foundryCentre, foundrySize);
}

function updateFoundry(dt, time) {
  const distance = foundryDistance();

  foundryInvulnerable = Math.max(0, foundryInvulnerable - dt);
  foundrySlow = Math.max(0, foundrySlow - dt);
  for (const [mesh, left] of foundryGrazed) {
    if (left - dt <= 0) foundryGrazed.delete(mesh);
    else foundryGrazed.set(mesh, left - dt);
  }

  updateFoundryBox();
  foundry.update({ dt, time, distance, playerPosition: foundryCentre });
  // (Audio may only have been unlocked since the Foundry came up.)
  if (!foundryAmbience.running && foundry.root.visible) foundryAmbience.start();

  if (state !== "playing" || paused) {
    level1Audio.updateBreath(0);
    level1Audio.updateAlarm(0);
    return;
  }
  // Huffing on the run (harder as you tire), and the tower's fire alarm a
  // few floors up, through the concrete.
  level1Audio.updateBreath(0.32 + Math.min(1, foundrySpeed() / 14) * 0.3 + (1 - Math.max(0, health) / 100) * 0.35);
  level1Audio.updateAlarm(0.6, 0.78);

  const { hits, grazes } = foundry.probe(foundryBox, distance);

  foundryFiles?.update(dt, time, foundryCentre, collectibleFound, collectibleNear);
  // Running into a serum capsule injects it, as in the Skyline.
  for (const target of foundry.breakables) {
    if (target.userData.serum && target.userData.alive && target.getWorldPosition(_sv).distanceTo(foundryCentre) < 1.5) shatter(target, { body: true });
  }

  for (const mesh of grazes) {
    if (foundryGrazed.has(mesh)) continue;
    foundryGrazed.set(mesh, 1.4);
    score += 25 * combo;
    updateUI();
  }

  if (hits.length && foundryInvulnerable <= 0 && absorbWithShield(_forward)) {
    // A kinetic shield (serum) takes the hit.
    foundryInvulnerable = 1.1;
    level1Audio.impact(0.65);
  } else if (hits.length && foundryInvulnerable <= 0) {
    const hazard = hits[0];
    health -= 18;
    run.damage = 1;
    foundryInvulnerable = 1.1;
    foundrySlow = 0.55;
    combo = 1; comboTimer = 0;
    foundry.impact(1);
    level1Audio.impact(1);
    level1Audio.hurt();
    foundryHud.setIntegrity(Math.max(0, health));
    triggerShake(0.45);
    showMessage(hazard.userData.barrier === "high" ? "LOW CLEARANCE" : "INTEGRITY DAMAGED");
    updateUI();
    if (health <= 0) endRun(false);
  }

  level1Audio.updateBrokenGlass(foundryCentre, jumpHeight < 0.12);
  updateFoundryGuide(dt);
  foundryHud.update({ distance, level: foundry });
  foundryHud.setRun({ score, combo, spheres: ammo, comboRatio: comboTimer / 2.6 });
}


/* ==================================================================== */
/* CAUSEWAY INTEGRATION - Level 1                                        */
/* ==================================================================== */

/**
 * Level 1 is built in its own stretch of world space, like the Foundry, so
 * it never overlaps Level 3's geometry. The route runs from z = 4000 toward
 * -Z; endless mode keeps going from there.
 *
 * Everything Level-1 specific is in this block. The level itself lives in
 * src/levels/causeway/ and follows the same contract as the Foundry.
 */
const CAUSEWAY_ORIGIN_Z = 4000;
/**
 * The Skyline comes after the Labs, so it's the hardest of the three: a
 * quicker pace, hits that hurt more, fire and smoke that burn faster - and,
 * in the level itself, a quicker collapse behind you (layout.js) and less
 * time at the sealed gate (causeway/index.js).
 */
const SKYLINE_HARD = Object.freeze({ damage: 1.3, burn: 1.35, smoke: 1.4 });
const CAUSEWAY_SPEED = { base: 11.4, sprint: 15.8, brake: 5.2 };

/**
 * Level 1 pace. Subject 07 has just been woken from a sedated pod, so the run
 * starts at a groggy 6 m/s and builds as the sedative wears off and adrenaline
 * takes over (full pace by the end of the ward), peaks while the skybridge
 * collapses behind the player, and settles slightly in the atrium so the
 * lock finale stays about aiming. Sprint and brake work relative to it.
 *
 * Returns { pace, sedation, drowsy }:
 *   sedation  1 at the pod, 0 at the end of the ward - drives speed and pulse.
 *   drowsy    1 at the pod, 0 by 40 m (about six seconds) - drives the blurred,
 *             swaying vision. Kept short on purpose: the body takes a while to
 *             reach full speed, but the eyes clear quickly so the player gets
 *             sharp, realistic vision for the rest of the run.
 */
function causewayPace(distance, awake = false) {
  const smooth = THREE.MathUtils.smoothstep;
  // Arriving by lift (the story's Skyline), you are awake from the first step.
  const wake = awake ? 1 : smooth(distance, 20, 230);
  let pace = THREE.MathUtils.lerp(6.0, CAUSEWAY_SPEED.base, wake);
  pace += 0.8 * smooth(distance, 240, 300) * (1 - smooth(distance, 520, 560));
  return { pace, sedation: 1 - wake, drowsy: awake ? 0 : 1 - smooth(distance, 4, 40) };
}
const START_SPHERES = 20;

let causeway = null;
let causewayMode = "story";
let simTime = 0;
let photoActive = false;
let autoLow = false;
const keysDown = new Set();

const causewayHud = new CausewayHud();
const arsenal = new Arsenal();
// The sphere picked in the main menu (or the pause menu) is the one a run starts with.
arsenal.prefer(savedBall());
// Serums in front of the player: the first time each is picked up the
// game pauses on a card explaining it (PowerupBanner); after that the
// HUD's serum banner, chips and screen looks (serum-fx.js) carry it.
const powerups = new PowerupBanner();
let pendingBurst = null;
arsenal.onActivate = (type) => {
  // The first pickup pauses on its card; the burst plays as the game resumes.
  if (powerups.needsIntro(type) && state === "playing" && !paused) {
    pendingBurst = SERUMS[type]?.colour;
    // The card has explained it: no second banner for this one.
    causewayHud.serumFx.quiet(type);
    openPowerupIntro(type);
  } else if (SERUMS[type]) powerups.burst(SERUMS[type].colour);
};
const progress = loadProgress();
const missions = new MissionTracker(progress);
const postfx = new PostFX(renderer, { quality: resolvedQuality() });
const minimap = new Minimap(renderer, causewayHud.mapFrame);
minimap.attach(scene);
const photo = new PhotoMode({ renderer, root: causewayHud.photoEl });

/** Per-run state for Level 1. Reset by resetRun(). */
const run = {};
function resetRun() {
  Object.assign(run, {
    speed: CAUSEWAY_SPEED.base, slow: 0, invulnerable: 0, focus: 1, focusing: false,
    timeScale: 1, hitStop: 0, recharge: 0, damage: 0, heat: 0, flash: 0,
    shots: 0, hits: 0, nearMisses: 0, fireDamage: 0, time: 0, finished: false,
    grazed: new Map(), stepPhase: 0, lean: 0, fadeOut: 0, liftFrom: new THREE.Vector3(),
    missionTimer: 0, ripple: 0, chaseWarned: false,
    rumble: null, heartPhase: 0, lens: 0,
    surge: 0, sedation: 1, drowsy: 1, awakeHinted: false, clearHinted: false,
    lookX: 0, lookY: 0, skipWake: false,
  });
}
resetRun();

function resolvedQuality() {
  if (settings.quality === "auto") return autoLow ? "low" : "high";
  return settings.quality;
}

function applyQuality() {
  const q = resolvedQuality();
  // Level 3 is fill-rate bound (measured): it always renders at ratio 1.
  const cap = currentLevel === 3 ? 1 : q === "high" ? 1.5 : q === "medium" ? 1.25 : 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
  renderer.setSize(innerWidth, innerHeight);
  postfx.setQuality(q);
  postfx.setScale(q === "medium" ? 0.85 : 1);
  minimap.measure();
  if (meltdown) {
    meltdown.setBloom(q !== "low");
    meltdownQuality();
    if (meltdown.visible) meltdown.syncRenderer();
  }
}

/**
 * Level 3's real shadows and ambient occlusion: only when High is chosen
 * outright (Auto stays within its frame budget, Low and Medium go without).
 */
function meltdownQuality() {
  const high = settings.quality === "high";
  meltdown?.setQuality({ shadows: high, ao: high });
}

function causewayDistance() {
  return CAUSEWAY_ORIGIN_Z - runZ;
}

function buildCauseway(mode = "story") {
  if (causeway) causeway.dispose();
  buildSkylineLift();
  causewayMode = mode;
  causeway = new CausewayLevel({
    origin: new THREE.Vector3(0, 0, CAUSEWAY_ORIGIN_Z),
    mode,
    quality: resolvedQuality(),
  });
  causeway.addTo(scene);
  // The Skyline is reached by lift now, not woken into: no containment pod.
  // (Level 1 streams its props and resets their roots' visibility, so hide the parts.)
  causeway.pod?.root?.traverse((o) => { if (o !== causeway.pod.root) o.visible = false; });
  if (perf.level >= 1) causeway.probe.interval = Math.max(causeway.probe.interval, 2);
  wireCausewayEvents(causeway);
  return causeway;
}

function wireCausewayEvents(level) {
  const on = (name, fn) => level.events.on(name, (payload) => { if (level === causeway) fn(payload); });
  // HALCYON and Dr. Vale over the intercom: the panel shows it, and they say it.
  on("radio", (p) => { causewayHud.radio(p); story.voice.say({ who: p.speaker, text: p.text }); });
  on("title", (p) => causewayHud.title(`Sector 03 // Beat ${p.index + 1} of 3`, p.name));
  on("hint", (p) => causewayHud.hint(p.text));
  on("file", (p) => causewayHud.caseFile(p.lines, p.found, p.total));
  on("sprinkler", () => { causewayHud.hint("Sprinkler open: fires below are going out"); level1Audio.sprinklerBurst(); });
  on("serum", () => level1Audio.serumCollected());
  on("sphere-cache", () => level1Audio.sphereCollected());
  on("vent", () => causewayHud.hint("Vent clear: the smoke is thinning"));
  on("extinguish", (p) => { if (p.by === "cryo") showMessage(`CRYO // ${p.count} FIRE${p.count > 1 ? "S" : ""} OUT`); });
  on("collapse-warning", () => causewayHud.hint("Ceiling giving way: watch the red ring"));
  on("collapse-start", (p) => level1Audio.startFalling(p.id));
  on("collapse-landed", (p) => { level1Audio.stopFalling(p.id); level1Audio.impact(0.9); level1Audio.debrisFall(0.8); triggerShake(0.25); });
  on("glass-break", (p) => { level1Audio.glassBreak(); level1Audio.addGlassDebris(p.position, p.radius); });
  on("pod-break", () => level1Audio.podBreak());
  on("explosion", (p) => {
    level1Audio.explosion(p.strength ?? 1);
    triggerShake(0.55 * p.strength);
    run.flash = Math.max(run.flash, 0.35 * p.strength);
    // Fright: a blast behind you makes you run.
    if (state === "playing") run.surge = Math.min(1.5, run.surge + 0.9 * p.strength);
  });
  on("tower-collapse", () => {
    level1Audio.buildingCollapse(0.85);
    if (state === "playing") run.surge = Math.min(1.5, run.surge + 0.5);
  });
  on("pod-break", () => triggerShake(0.3));
  on("tremor", (p) => {
    level1Audio.distantCollapse(0.5 + (p.strength ?? 0.5) * 0.5);
    run.rumble = { t: 0, duration: p.duration, strength: p.strength * (settings.reducedMotion ? 0.25 : 1) };
  });
  on("chase-start", () => {
    causewayHud.title("Structural failure", "Keep moving", 2.4);
    // The bridge behind you: steel giving way, and the slabs going down.
    level1Audio.metalGroan(1.1);
    level1Audio.distantCollapse(1);
  });
  on("chase-end", () => { causewayHud.warning(null); causewayHud.hint("Bridge section secured behind you"); });
  on("gate-armed", () => causewayHud.hint("Lift gate ahead: locks I, II, III", 3.2));
  on("lock", (p) => showMessage(`LOCK ${["I", "II", "III"][p.index]} // NEXT: ${["II", "III", ""][p.index]}`));
  on("gate-open", () => { causewayHud.warning(null); showMessage("GATE OPEN // INTO THE LIFT"); });
  on("gate-sealed", () => causewayHud.warning("Gate sealed", "Break the locks before the atrium falls"));
  on("crushed", () => { if (state === "playing") endRun(false, "crushed"); });
  on("lift-enter", () => startCausewayLift());
}

/** Enter or leave Level 1's world, lighting, camera range, and HUD. */
function setCausewayActive(active) {
  if (!causeway) return;
  causeway.root.visible = active;
  if (skylineLift) skylineLift.root.visible = active;
  if (active) {
    sun.intensity = 0;
    hemi.intensity = 0;
    camera.far = 1700;
    scene.fog.density = 0.012;
  } else {
    camera.far = 150;
    causewayHud.hide();
    document.body.classList.remove("cw-active");
  }
  camera.updateProjectionMatrix();
}

function playerWorld(target = new THREE.Vector3()) {
  return target.set(playerX, playerY + jumpHeight + 1.1, runZ);
}

function missionStats() {
  const s = causeway ? causeway.summary() : { sprinklers: 0, extinguished: 0, panes: 0, files: [], serums: 0, midair: 0, tanks: 0, vents: 0 };
  return { ...s, shots: run.shots, hits: run.hits, nearMisses: run.nearMisses, fireDamage: run.fireDamage, time: run.time, integrity: health, finished: run.finished };
}

function damage(amount, label) {
  health -= amount * (currentLevel === 1 ? SKYLINE_HARD.damage : 1);
  combo = 1; comboTimer = 0;
  run.damage = 1;
  run.slow = 0.6;
  causeway?.impact(1);
  level1Audio.hurt(Math.min(1.2, 0.6 + amount / 40));
  triggerShake(0.45);
  showMessage(label);
  updateUI();
  if (health <= 0) endRun(false);
}

function absorbWithShield(direction) {
  if (!arsenal.absorb()) return false;
  run.ripple = 1;
  if (causeway) causeway.shield.material.uniforms.uRippleDir.value.copy(direction);
  showMessage(arsenal.shieldCharges > 0 ? "SHIELD ABSORBED // 1 LEFT" : "SHIELD BROKEN");
  triggerShake(0.2);
  return true;
}

function activateSerum(type) {
  const def = SERUMS[type];
  if (!def) return;
  arsenal.activate(type);
  // The banner across the top names it (src/ui/serum-fx.js).
  run.flash = Math.max(run.flash, 0.25);
}

const _forward = new THREE.Vector3(0, 0, -1);

function updateCauseway(dt, time) {
  const distance = causewayDistance();
  // The story: near the end of the skybridge, the tower behind blows.
  if (skylineStory && !skylineStory.done && causewayMode === "story" && distance >= SKYLINE_BLAST_AT && state === "playing") {
    beginSkylineBlast();
    return;
  }
  skylineStory?.tower.update(dt);
  skylineStory?.sky.update(dt, time);
  hideRampProps();
  run.time += dt;

  // ---- Speed: W sprints, S brakes, hits cost momentum ------------------
  let target;
  if (causewayMode === "endless") {
    target = CAUSEWAY_SPEED.base + Math.min(6, distance / 300);
    run.sedation = 0;
    run.drowsy = 0;
  } else {
    const { pace, sedation, drowsy } = causewayPace(distance, run.skipWake);
    target = pace;
    run.sedation = sedation;
    run.drowsy = drowsy;
    if (!run.clearHinted && drowsy < 0.02) { run.clearHinted = true; causewayHud.hint("Your vision clears", 1.8); }
    if (!run.awakeHinted && sedation < 0.1) { run.awakeHinted = true; causewayHud.hint("Adrenaline: you can run now", 2.4); }
  }
  // Sprint and brake are relative to the current pace: sprint adds 4.4 m/s,
  // brake drops toward 5 m/s but never below 4.
  if (keysDown.has("up")) target += CAUSEWAY_SPEED.sprint - CAUSEWAY_SPEED.base;
  if (keysDown.has("down")) target = Math.max(4, Math.min(target, CAUSEWAY_SPEED.brake));
  if (arsenal.isActive("overdrive")) target += 3;
  // Explosion surge: up to +3 m/s, fading over about three seconds.
  target += run.surge * 2;
  run.surge = Math.max(0, run.surge - dt * 0.45);
  if (run.slow > 0) target *= 0.45;
  run.slow = Math.max(0, run.slow - dt);
  run.speed += (target - run.speed) * Math.min(1, dt * (run.slow > 0 ? 8 : 2.4));
  runZ -= run.speed * dt;
  const stop = causeway.stopDistance;
  if (causewayDistance() > stop) { runZ = CAUSEWAY_ORIGIN_Z - stop; run.speed = Math.min(run.speed, 0.5); }
  score += run.speed * dt * 2;

  updateFoundryBox();
  playerWorld(_playerPos);
  causeway.update({ dt, time, distance: causewayDistance(), player: _playerPos, playing: true });
  if (state !== "playing") return;

  // ---- Collisions -------------------------------------------------------
  run.invulnerable = Math.max(0, run.invulnerable - dt);
  const { hits, panes, grazes, pickups } = causeway.collide(foundryBox, causewayDistance());
  for (const target of pickups) shatter(target, { body: true });
  for (const pane of panes) {
    const result = causeway.breakTarget(pane, { body: true, direction: _forward });
    if (!result) continue;
    if (!absorbWithShield(_forward)) damage(result.kind === "door" ? 24 : 15, result.kind === "door" ? "CRASHED THROUGH THE DOOR" : "GLASS IMPACT");
    if (state !== "playing") return;
  }
  if (hits.length && run.invulnerable <= 0) {
    run.invulnerable = 1.1;
    const shielded = absorbWithShield(_forward);
    if (!shielded) damage(22, "INTEGRITY DAMAGED");
    else run.slow = 0.3;
    level1Audio.impact(shielded ? 0.65 : 1);
    if (state !== "playing") return;
  }
  for (const [mesh, left] of run.grazed) {
    if (left - dt <= 0) run.grazed.delete(mesh); else run.grazed.set(mesh, left - dt);
  }
  if (!hits.length) {
    for (const mesh of grazes) {
      if (run.grazed.has(mesh)) continue;
      run.grazed.set(mesh, 2);
      run.nearMisses += 1;
      score += 25 * combo;
      causewayHud.hint("Near miss +" + 25 * combo, 0.9);
    }
  }

  // ---- Fire and smoke --------------------------------------------------
  const exposure = causeway.fireExposure(foundryBox);
  run.heat += ((exposure > 0 ? 1 : 0) - run.heat) * Math.min(1, dt * 5);
  if (exposure > 0 && !arsenal.isActive("shield")) {
    const burn = 18 * SKYLINE_HARD.burn * exposure * dt;
    health -= burn;
    run.fireDamage += burn;
    combo = 1;
  }
  const smoke = causeway.state.smoke;
  if (smoke > 0.55) health -= (smoke - 0.55) * 10 * SKYLINE_HARD.smoke * dt;
  if (health <= 0) { updateUI(); endRun(false, exposure > 0 ? "fire" : "smoke"); return; }
  level1Audio.updateEnvironment(causeway.audioEnvironment(_playerPos));
  level1Audio.updateBrokenGlass(_playerPos, run.speed > 1 && jumpHeight < 0.12);
  // Huffing (harder sprinting, and hurt), and the research wing's fire alarm.
  level1Audio.updateBreath(THREE.MathUtils.clamp(run.speed / CAUSEWAY_SPEED.sprint, 0, 1) * 0.7 + (1 - Math.max(0, health) / 100) * 0.3);
  level1Audio.updateAlarm(causewayMode === "story" ? 0.85 : 0.55, 0.1);

  // ---- Bridge collapse chase -------------------------------------------
  const chase = causeway.state.chase;
  if (chase.active) {
    if (chase.gap < 0) { endRun(false, "fell"); return; }
    if (chase.gap < 22) causewayHud.warning("Bridge collapsing", `${Math.max(0, chase.gap).toFixed(0)} m behind you: sprint (W)`);
    else causewayHud.warning(null);
    if (chase.gap < 12) triggerShake(0.05);
  }
  const finale = causeway.state.finale;
  if (finale.sealed && !finale.open) causewayHud.warning("Gate sealed", `${finale.sealedTime.toFixed(1)} s: break the locks in order`);

  // ---- Sphere safety net: never soft-lock at the gate -------------------
  if (ammo < 1) {
    run.recharge += dt;
    if (run.recharge > 2.5) { run.recharge = 0; ammo += 1; showMessage("+1 SPHERE // RESONANCE RECHARGE"); }
  } else run.recharge = 0;

  // ---- Tools ------------------------------------------------------------
  arsenal.update(dt);
  run.focus = Math.min(1, run.focus + dt * 0.09);
  run.damage = Math.max(0, run.damage - dt * 1.6);

  run.missionTimer -= dt;
  if (causewayMode === "story" && run.missionTimer <= 0) {
    run.missionTimer = 0.25;
    for (const m of missions.update(missionStats())) {
      causewayHud.title("Mission complete", m.def.text, 2.2);
      score += 750;
    }
    causewayHud.setMissions(missions.active);
  }
}
const _playerPos = new THREE.Vector3();

/** Apply what breaking a Level 1 target did to score, spheres and combo. */
function shatterCauseway(target, hit) {
  const result = causeway.breakTarget(target, hit);
  if (!result) return null;
  if (result.rejected) {
    combo = 1; comboTimer = 0;
    showMessage(result.label);
    return result;
  }
  const bodyHit = !!hit.body;
  // Running into a pickup (serum, case file) scores like shooting it.
  if (!bodyHit || result.kind === "serum" || result.kind === "file") {
    score += result.points * combo;
    if (!result.cracked) { combo = Math.min(9, combo + 1); comboTimer = 2.6; }
    run.focus = Math.min(1, run.focus + 0.08);
  }
  if (result.spheres) {
    ammo += result.spheres;
    causewayHud.bump(".cw-spheres");
  }
  if (result.serum) activateSerum(result.serum);
  if (result.label) showMessage(result.label);
  if (!settings.reducedMotion && ["door", "lock", "falling", "file"].includes(result.kind) && !bodyHit) run.hitStop = 0.09;
  causewayHud.bump(".cw-score");
  updateUI();
  return result;
}

function startCausewayLift() {
  if (state !== "playing" || currentLevel !== 1) return;
  music.enterElevator();
  state = "lift";
  liftTimer = 0;
  transitionTarget = 2;
  run.finished = true;
  run.liftFrom.copy(camera.position);
  causewayHud.warning(null);
  const files = causeway.stats.files.length;
  const bonus = ammo * 50 + Math.max(0, Math.round(health)) * 10 + files * 250;
  score += bonus;
  const stats = missionStats();
  missions.update(stats);
  const accuracy = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
  causewayHud.liftReport([
    ["Score", String(Math.floor(score)).padStart(6, "0")],
    ["Time", `${run.time.toFixed(1)} s`],
    ["Accuracy", `${accuracy}%`],
    ["Glass shattered", stats.panes],
    ["Fires put out", stats.extinguished],
    ["Case files", `${files} / 5`],
    ["Carry-over spheres", ammo + 4],
    ["End bonus", `+${bonus}`],
  ], missions.active);
  missions.commit({ mode: "story", score, files: causeway.stats.files, cleared: true });
  refreshMenuProgress();
  updateUI();
}

function updateCausewayLift(dt) {
  const result = causeway.updateLift(dt, camera, run.liftFrom, settings.reducedMotion);
  level1Audio.updateElevator(causeway.state.lift.velocity, !result.done);
  avatar.visible = true;
  avatar.position.set(0, result.cabinY, causeway.worldZ(CAUSEWAY_ROUTE.lift));
  const end = settings.reducedMotion ? 6.2 : 7.4;
  ui.fade.style.opacity = THREE.MathUtils.clamp((result.t - (end - 0.9)) / 0.9, 0, 1).toFixed(3);
  if (result.done) finishCausewayLift();
}

/** The Skyline's lift reaches the top: on to the Roof, the finale. */
function finishCausewayLift() {
  disposeSkylineStory();
  level1Audio.cleanupLevel();
  music.fadeOut();
  causewayHud.hideReport();
  setCausewayActive(false);
  // Free the Causeway's GPU resources - the guide's "level changes leak memory" risk.
  causeway.dispose();
  causeway = null;
  enterRoof();
}

/* ---- Level 1 camera --------------------------------------------------- */

const _look = new THREE.Vector3();
const _desired = new THREE.Vector3();

function causewayCamera(dt, time) {
  const reduced = settings.reducedMotion;
  run.stepPhase += dt * run.speed * 0.95;
  // Groggy steps: a heavier, uneven bob and a slow drift while the eyes are
  // still drowsy (the first ~40 m only).
  const sedation = run.drowsy ?? 0;
  const bob = reduced ? 0 : Math.sin(run.stepPhase * 2) * (0.035 + sedation * 0.05) * Math.min(1, run.speed / 8)
    + Math.sin(run.stepPhase * 0.9) * sedation * 0.03;
  const crouch = sliding > 0 ? 0.65 : 0;
  if (cameraThird) {
    _desired.set(playerX * 0.85, 4.0 + jumpHeight * 0.5, runZ + 8.2);
    _look.set(playerX * 0.6 + pointer.x * 1.5, 1.4 + pointer.y, runZ - 12);
    if (snapCamera) { camera.position.copy(_desired); snapCamera = false; }
    else camera.position.lerp(_desired, 1 - Math.exp(-dt * 7));
  } else {
    // First person: lateral motion eased, forward motion exact (no lag at speed).
    const x = snapCamera ? playerX : THREE.MathUtils.lerp(camera.position.x, playerX, 1 - Math.exp(-dt * 16));
    camera.position.set(x, 1.72 + jumpHeight + bob - crouch, runZ + 0.15);
    snapCamera = false;
    // The view drifts gently toward the aim, but little and smoothly: turning
    // the camera hard toward the pointer slides the world under the crosshair
    // and makes targets harder to hit.
    run.lookX += (pointer.x * 1.0 - run.lookX) * Math.min(1, dt * 4);
    run.lookY += (pointer.y * 0.55 - run.lookY) * Math.min(1, dt * 4);
    _look.set(playerX + run.lookX, 1.55 + run.lookY - crouch, runZ - 14);
    if (!reduced && sedation > 0.01) {
      camera.position.x += Math.sin(time * 0.8) * 0.08 * sedation;
      _look.x += Math.sin(time * 0.55) * 0.6 * sedation;
      _look.y += Math.sin(time * 0.43) * 0.25 * sedation;
    }
  }
  // Fear: shallow, fast breathing sways the view; faster when hurt or choking.
  const fear = THREE.MathUtils.clamp((100 - health) / 70 + causeway.state.smoke * 0.6 + run.heat * 0.5, 0, 1);
  if (!reduced && !cameraThird) {
    camera.position.y += Math.sin(time * (1.6 + fear * 1.4)) * (0.012 + fear * 0.018);
  }
  // Tremor: a low rumble rather than random jitter - two sines at different
  // frequencies, enveloped over the tremor's duration.
  let rumbleRoll = 0;
  if (run.rumble) {
    const r = run.rumble;
    r.t += dt;
    const env = Math.sin(Math.PI * Math.min(1, r.t / r.duration)) * r.strength;
    camera.position.x += (Math.sin(r.t * 23) + Math.sin(r.t * 37) * 0.5) * 0.035 * env;
    camera.position.y += (Math.sin(r.t * 29) + Math.sin(r.t * 17) * 0.6) * 0.03 * env;
    rumbleRoll = Math.sin(r.t * 11) * 0.012 * env;
    if (r.t >= r.duration) run.rumble = null;
  }

  // Lean into lane changes.
  const leanTarget = reduced ? 0 : THREE.MathUtils.clamp((lanes[lane] - playerX) * -0.03, -0.06, 0.06);
  run.lean += (leanTarget - run.lean) * Math.min(1, dt * 8);
  camera.up.set(Math.sin(run.lean + rumbleRoll), Math.cos(run.lean + rumbleRoll), 0);
  camera.lookAt(_look);

  const fov = 70 + Math.max(0, run.speed - 10) * 1.3 + arsenal.level("overdrive") * 8 - (run.timeScale < 0.9 ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
  }
  if (shake > .001) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 2.4); }
}

/** Post-processing and HUD inputs for Level 1, once per frame. */
function updateCausewayPresentation(dt) {
  const u = postfx.uniforms;
  const thermal = arsenal.level("thermal");
  const smoke = causeway.state.smoke;
  // Thermal vision sees through smoke: thin the fog and the ceiling smoke.
  for (let i = 0; i < 16; i += 1) causeway.smoke.profile[i] *= 1 - thermal * 0.8;
  scene.fog.color.copy(causeway.fogColor);
  scene.fog.density = causeway.fogDensity * (1 - thermal * 0.7);
  scene.background.copy(causeway.hazeColor);

  u.uSmoke.value = smoke * 0.85;
  u.uDamage.value = run.damage;
  u.uHeat.value = run.heat;
  u.uThermal.value = thermal;
  u.uOverdrive.value = arsenal.level("overdrive");
  u.uPrism.value = arsenal.level("prism") * 0.7;
  u.uFocus.value = 1 - run.timeScale;
  u.uSpeed.value = Math.max(0, (run.speed - 11.5) / 5);
  u.uSedation.value = run.drowsy * (settings.reducedMotion ? 0.5 : 1);
  run.flash = Math.max(0, run.flash - dt * 1.5);

  // Heartbeat in the vignette, at the ECG's rate, stronger the more afraid.
  const fear = THREE.MathUtils.clamp((100 - health) / 70 + smoke * 0.6 + run.heat * 0.5, 0, 1);
  const bpm = 70 + fear * 80 - run.sedation * 16;
  run.heartPhase = (run.heartPhase + dt * bpm / 60) % 1;
  const beat = Math.exp(-((run.heartPhase - 0.08) ** 2) / 0.002) + 0.6 * Math.exp(-((run.heartPhase - 0.26) ** 2) / 0.002);
  u.uPulse.value = beat * (0.15 + fear * 0.85);
  // Sprinkler water on the lens: a few drops while you are right under a
  // shower, gone within about a second of leaving it.
  const wet = causeway.wetExposure(playerWorld(_playerPos)) * 0.6;
  run.lens = wet > run.lens ? run.lens + (wet - run.lens) * Math.min(1, dt * 4) : Math.max(0, run.lens - dt * 1.1);
  u.uLens.value = run.lens;
  u.uFlash.value = Math.min(0.3, run.flash * 0.4 + causeway.state.flash * 0.25);

  // Heat haze just above the nearest gameplay fires (not the wall fires),
  // kept small so it shimmers the air over the flames rather than the screen.
  const fires = causeway.live.filter((r) => r.kind === "fire" && !r.decor && r.intensity > 0.1)
    .sort((a, b) => a.world.distanceToSquared(camera.position) - b.world.distanceToSquared(camera.position));
  u.uHaze.value.forEach((slot, i) => {
    const f = fires[i];
    if (!f) { slot.w = 0; return; }
    const p = _look.copy(f.world).setY(f.size.y * 1.05).project(camera);
    const dist = f.world.distanceTo(camera.position);
    const near = 1 - THREE.MathUtils.smoothstep(dist, 14, 26);
    slot.set((p.x + 1) / 2, (p.y + 1) / 2, THREE.MathUtils.clamp(3.2 / dist, 0.04, 0.2), p.z < 1 ? f.intensity * 0.6 * near : 0);
  });

  // Shield bubble.
  const shieldOn = arsenal.isActive("shield");
  causeway.shield.visible = shieldOn && (cameraThird || state === "lift");
  run.ripple = Math.max(0, run.ripple - dt * 1.5);
  causeway.shield.material.uniforms.uStrength.value = arsenal.level("shield");
  causeway.shield.material.uniforms.uRipple.value = run.ripple;

  const ball = arsenal.current;
  const cost = arsenal.cost();
  causewayHud.setCore({
    spheres: ammo, score, combo, comboRatio: comboTimer / 2.6,
    camera: cameraThird ? "Chase" : "First person", low: ammo < 4,
  });
  causewayHud.setTools({
    ball: ball.key, spheres: ammo, cost, speed: run.speed,
    speedRatio: THREE.MathUtils.clamp(run.speed / 18, 0, 1), focus: run.focus,
  });
  causewayHud.setVitals({ integrity: health, smoke, heat: run.heat, sedation: run.sedation });
  causewayHud.setSerums(arsenal.list());
  if (smoke > 0.55 && !causeway.state.chase.active && !causeway.state.finale.sealed) {
    causewayHud.warning("Toxic smoke", "Break a vent cover to clear the air", "amber");
  } else if (!causeway.state.chase.active && !causeway.state.finale.sealed) causewayHud.warning(null);
  ui.reticle.style.setProperty("--ball", `#${ball.colour.toString(16).padStart(6, "0")}`);
}

/**
 * The Skyline's HUD and screen looks in the Foundry, the Labs and on the
 * Roof - the same numbers, read the same way, in every level: spheres,
 * score and combo; integrity on the ECG; sphere type, speed and focus; the
 * serums running. (The Skyline drives its own in updateCausewayPresentation.)
 */
const unifiedTrack = { breaks: 0, hits: 0, downs: 0 };
function updateUnifiedHud(dt) {
  const inLabs = currentLevel === 3 && meltdown;
  if (inLabs) {
    // The Labs and the Roof keep their own counts: a break builds the combo,
    // a hit breaks it, as in the Skyline.
    const r = meltdown.runner;
    if (r.breaks + r.downs > unifiedTrack.breaks + unifiedTrack.downs) { combo = Math.min(9, combo + 1); comboTimer = 2.6; }
    if (r.hits > unifiedTrack.hits) { combo = 1; comboTimer = 0; run.damage = 1; }
    if (r.breaks < unifiedTrack.breaks || r.hits < unifiedTrack.hits) { combo = 1; comboTimer = 0; }
    Object.assign(unifiedTrack, { breaks: r.breaks, hits: r.hits, downs: r.downs });
    if (comboTimer > 0) { comboTimer = Math.max(0, comboTimer - dt); if (comboTimer === 0) combo = 1; }
  }
  run.damage = Math.max(0, run.damage - dt * 1.6);
  const ball = arsenal.current;
  const speed = currentLevel === 2 ? foundryPace : inLabs ? (meltdown.phase === "roof" ? meltdown.hero.velocity.length() : meltdown.runner.speed) : 0;
  const live = inLabs ? score + meltdownScore(meltdown.stats, false) : score;
  causewayHud.setCore({
    spheres: ammo, score: live, combo, comboRatio: comboTimer / 2.6,
    camera: inLabs ? meltdown.cameraModeName.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : cameraThird ? "Chase" : "First person",
    low: ammo < 4,
  });
  causewayHud.setTools({ ball: ball.key, spheres: ammo, cost: arsenal.cost(), speed, speedRatio: THREE.MathUtils.clamp(speed / 18, 0, 1), focus: run.focus });
  causewayHud.setVitals({ integrity: health, smoke: 0, heat: inLabs ? meltdown.heatLevel ?? 0 : 0, sedation: 0 });
  causewayHud.setSerums(arsenal.list());
  ui.reticle.style.setProperty("--ball", `#${ball.colour.toString(16).padStart(6, "0")}`);
  // The Foundry renders through the Skyline's post pipeline: give it the
  // same looks - the hit, the heartbeat, the serums (Level 3 has its own grade).
  if (currentLevel === 2) {
    const u = postfx.uniforms;
    const fear = THREE.MathUtils.clamp((100 - health) / 70, 0, 1);
    const bpm = 70 + fear * 80;
    run.heartPhase = (run.heartPhase + dt * bpm / 60) % 1;
    const beat = Math.exp(-((run.heartPhase - 0.08) ** 2) / 0.002) + 0.6 * Math.exp(-((run.heartPhase - 0.26) ** 2) / 0.002);
    u.uPulse.value = beat * (0.15 + fear * 0.85);
    u.uDamage.value = run.damage;
    u.uOverdrive.value = arsenal.level("overdrive");
    u.uPrism.value = arsenal.level("prism") * 0.7;
    u.uFocus.value = 1 - run.timeScale;
    u.uSpeed.value = Math.max(0, (foundryPace - 11.5) / 5);
  }
}


function refreshMenuProgress() {
  const p = missions.progress;
  const bits = [];
  if (runTimes.story) bits.push(`Best run ${hms(runTimes.story)}${p.best.story ? ` (${String(p.best.story).padStart(6, "0")})` : ""}`);
  else if (p.best.story) bits.push(`Best score ${String(p.best.story).padStart(6, "0")}`);
  for (const env of ["foundry", "labs", "skyline", "roof"]) {
    const best = endlessRecordText(env);
    if (best) bits.push(`${ENDLESS_NAMES[env]} ${best}`);
  }
  bits.push(`Case files ${p.files.length}/5`);
  bits.push(...foundSummary());
  bits.push(`Missions ${p.completed.length}/13`);
  ui.progressLine.textContent = bits.join("   ");
  if (ui.briefing) ui.briefing.innerHTML = missions.active.map((m) => `<li class="${p.completed.includes(m.def.id) ? "done" : ""}">${m.def.text}</li>`).join("");
}

/* ==================================================================== */
/* MELTDOWN INTEGRATION - Level 3                                        */
/* ==================================================================== */

/**
 * Level 3 is a self-contained module with its own scene, camera,
 * post-processing, HUD and input rules - src/levels/meltdown/game.js, the
 * same module preview/meltdown.html runs on its own. This block builds it
 * on the way into Level 3, forwards input to it, renders it instead of the
 * main scene while it is up, and turns its result into this game's score
 * and end screen. Level 3 opens and closes in lifts (placeholders a teammate
 * is replacing - see src/levels/meltdown/elevator.js).
 *
 * Level 3 synthesises its own sound. The team removed sound from Levels 1
 * and 2 (audio is its own workstream); set MELTDOWN_AUDIO to false to
 * silence Level 3 as well.
 */
const MELTDOWN_AUDIO = true;
/**
 * Level 3 being built early - during the lift ride up to it - so it is
 * ready when the ride ends instead of loading behind a black screen.
 */
let meltdownPrepared = null;
const MELTDOWN_ASSET_BASE = new URL("./assets/meltdown/", import.meta.url).href;
let meltdownEntering = false;

function getMeltdown() {
  if (meltdown) return meltdown;
  meltdown = new MeltdownGame({
    renderer,
    assetBase: MELTDOWN_ASSET_BASE,
    character: savedCharacter(),
    audio: MELTDOWN_AUDIO,
    sfx: level1Audio,
    reducedMotion: settings.reducedMotion,
    // One set of sphere types and serums for every level.
    arsenal,
  });
  meltdown.setBloom(resolvedQuality() !== "low");
  meltdownQuality();
  // Level 3's body: the chosen skin tone (its stage is set per stage, below).
  meltdown.avatar?.setSkinTone(savedSkinTone());
  meltdown.events.on("complete", (result) => finishMeltdown(true, result));
  meltdown.events.on("failed", (result) => finishMeltdown(false, result));
  // The story: through the lift at the end of the Labs, up to the Skyline.
  meltdown.events.on("corridor-complete", ({ stats }) => {
    if (currentLevel !== 3 || state !== "playing") return;
    // The grief scene left the frame black; the Skyline brings its own fade.
    story.stop();
    score += meltdownScore(stats, false) + 2000 + Math.round(stats.vitality) * 10;
    storyBalls = stats.balls;
    // Not from inside Level 3's own update: hand over once it has returned.
    pendingSkyline = true;
  });
  meltdown.events.on("lap", ({ laps }) => showMessage(`LAP ${laps + 1} // NEW LAYOUT`));
  meltdown.events.on("collectible", collectibleFound);
  meltdown.events.on("collectible-near", collectibleNear);
  // The ending (the helicopter, then the credits) plays over the main theme.
  meltdown.events.on("phase", ({ phase }) => { if (phase === "finale") music.playTheme(); });
  return meltdown;
}

/** Level 2's end: the player is in the Calibration Lift; the doors close and it rides up. */
function startFoundryLift() {
  if (state !== "playing" || currentLevel !== 2) return;
  music.enterElevator();
  state = "lift"; liftTimer = 0; transitionTarget = 3;
  run.liftFrom.copy(camera.position);
  foundryLift.start();
  showMessage("CALIBRATION LIFT // SECTOR 02");
  updateUI();
}

/** Start streaming Level 3's models early - called when Level 2 starts. */
function preloadMeltdown() {
  getMeltdown().preload();
}

/** Balls Level 3 starts with: spheres left over become a few extra. */
function meltdownBalls() {
  return MELTDOWN_START_BALLS + Math.min(8, Math.floor(ammo / 4));
}

/** Level 3's body as the figure is at a point in the story (storyPosition). */
function dressMeltdownAvatar(position) {
  const stage = figureStage(position);
  meltdown?.avatar?.setWear(stage.wear);
  meltdown?.avatar?.setGear(stage.gear);
}

/** Level 3's mode, and the story's Labs (it applies to the next load()). */
function setMeltdownRun(game) {
  game.setMode(runKind === "endless" ? "endless-labs" : "corridor");
  // The story's Labs: the breach, Okoro, the bend, the desk (labs-director.js).
  game.setStory(storyRun && runKind === "story" ? {
    layer: story,
    okoroTemplate,
    valeTemplate: () => valeTemplate,
    assetBase: MELTDOWN_ASSET_BASE,
  } : null);
}

/**
 * Build Level 3 now, off screen (the lift ride calls this as it starts,
 * while the screen is still black). enterMeltdown() then only has to show it.
 */
function prepareMeltdown() {
  if (!meltdownPrepared) {
    const game = getMeltdown();
    setMeltdownRun(game);
    dressMeltdownAvatar(2);
    meltdownPrepared = game.load({ balls: meltdownBalls() });
  }
  return meltdownPrepared;
}

/**
 * Into Level 3: black, build it (models are usually in already - they load
 * during Level 2 - and its shaders compile while the screen is black), then
 * fade up inside the arrival lift and open the doors.
 */
async function enterMeltdown() {
  if (meltdownEntering) return;
  meltdownEntering = true;
  if (storyRun && runKind === "story") storyCheckpoint = { stage: "labs", score, ammo, balls: null };
  const game = getMeltdown();
  // Built during the lift ride? Then the mode and story were set for that load.
  if (!meltdownPrepared) setMeltdownRun(game);
  onRoofStage = false;
  dressMeltdownAvatar(2);
  ui.fade.style.opacity = "1";
  run.fadeOut = 0;
  setFoundryActive(false);
  // Free Level 2's GPU resources, as Level 1's are freed on the way into
  // Level 2 (a demo jump back rebuilds it).
  if (foundry) { foundryHud.unbind(); foundry.dispose(); foundry = null; }
  foundryLift?.dispose();
  foundryLift = null;
  currentLevel = 3; state = "lift"; transitionTarget = 3; liftTimer = 0;
  health = 100; shake = 0;
  music.playStage("labs");
  level1Audio.preloadStage("labs");
  level1Audio.preloadStage("common");
  story.voice.preload(STORY_LINES.valeBlackout);
  // Spheres left over from the foundry become a few extra balls.
  const balls = meltdownBalls();
  // Built during the lift ride? Then it is ready (or nearly).
  const prepared = meltdownPrepared;
  meltdownPrepared = null;
  applyQuality();
  game.show();
  updateUI();
  try {
    await (prepared ?? game.load({ balls }));
  } finally {
    meltdownEntering = false;
  }
  if (currentLevel !== 3 || state !== "lift" || meltdown !== game) return; // quit while loading
  state = "playing";
  run.fadeOut = 1;
  game.begin();
}

/** Out of Level 3 (restart, quit, demo jump): free it and give the renderer back. */
function leaveMeltdown(nextLevel) {
  pendingSkyline = false;
  meltdownPrepared = null;
  meltdown?.unload();
  meltdownEntering = false;
  currentLevel = nextLevel;
  applyQuality();
}

let pendingSkyline = false;
function updateMeltdownFrame(dt, time) {
  if (!meltdown) return;
  meltdown.update(dt, time);
  const liftCut = meltdown.cut;
  const insideElevator = Boolean(liftCut?.elevatorInside);
  if (insideElevator) music.enterElevator();
  else music.exitElevator();
  level1Audio.updateElevator(liftCut?.elevatorVelocity ?? 0, insideElevator && !liftCut?.done);
  if (pendingSkyline) {
    pendingSkyline = false;
    // The scientist's sacrifice at the lift, then the quiet ride up.
    startQuietRide();
    return;
  }
  // Mirror Level 3's numbers into the game's own (pause screen, end screen).
  if ((meltdown.level || meltdown.roof) && state === "playing") {
    health = meltdown.runner.vitality;
    ammo = meltdown.runner.balls;
  }
}

function meltdownScore(s, escaped) {
  let points = s.breaks * 100 + s.downs * 150 + s.falls * 250;
  if (escaped) points += 5000 + Math.round(s.vitality) * 20 + s.balls * 25 + (s.ending === "victory" ? 2500 : 0);
  return points;
}

const MELTDOWN_ENDINGS = {
  EXTRACTED: "You cleared the roof and climbed out on the rescue ladder. Ascension Tower burns behind you.",
  "BARELY OUT": "You jumped for the ladder with them still on the roof, and it held. Ascension Tower burns behind you.",
  "CAUGHT BY THE FIRE": "The fire caught up. Shoot what blocks you, grab sphere sacks and serum vials, and do not stop.",
  "THE BUILDING WENT UP": "The building went up before you reached the lift. The evac signs count down - keep moving.",
  "THEY GOT YOU": "The roof was too much. Keep moving, dodge (SPACE) through their charges, get off a laser's line before it locks, and lure them off the open ledges.",
  "LEFT BEHIND": "The helicopter could not wait. When it hangs off the east ledge, get to the edge and jump (SPACE) for the ladder.",
  "YOU FELL": "Off the edge. The east side and the middle of the west are open, and so is the deck's - watch your footing when they knock you back.",
};

/** Level 3 finished: its numbers into the game's score, and the end screen. */
function finishMeltdown(escaped, result) {
  if (currentLevel !== 3 || state !== "playing") return;
  const s = result.stats;
  score += meltdownScore(s, escaped);
  health = s.vitality;
  ammo = s.balls;
  updateUI();
  if (runKind === "endless") { endRun(false, null, endlessResult()); return; }
  // The whole run, timed: from the Foundry to the helicopter.
  const timed = escaped && runKind === "story" && runFromStart;
  const record = timed ? recordStoryTime(runClock) : 0;
  const time = timed ? `Run time ${hms(runClock)}${record === runClock ? " // NEW RECORD" : `   Best ${hms(record)}`}   ` : "";
  endRun(escaped, null, {
    eyebrow: escaped ? "RUN COMPLETE // OUT OF ASCENSION TOWER" : `RUN TERMINATED // ${onRoofStage || meltdown?.roof ? "THE ROOF" : "SECTOR 02 // THE LABS"}`,
    title: result.title,
    text: MELTDOWN_ENDINGS[result.title],
    stats: `${time}${hms(s.time)} on the roof   ${s.breaks} broken   ${s.downs} downed   ${s.falls} over the edge   ${s.hits} hits taken`,
  });
  refreshMenuProgress();
}

/* ==================================================================== */
/* Projectiles (all levels)                                             */
/* ==================================================================== */

// One sphere for every level (src/systems/spheres.js): the Labs draws the same orbs.
const projectileGeometry = SPHERE_GEOMETRY;
const projectileMaterials = Object.fromEntries(Object.values(BALLS).map((b) => [b.key, sphereMaterial(b.key)]));
const legacyProjectileMaterial = sphereMaterial("glass");
const _aim = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _segment = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const BALL_CORRIDOR_RESTITUTION = 1.0;

function aliveTargets() {
  if (currentLevel === 1 && causeway) return causeway.breakables;
  if (currentLevel === 2 && foundry) return foundry.breakables.filter((x) => x.userData.alive);
  return breakables.filter((x) => x.userData.alive);
}

/* ---- Aiming: direct hit, aim assist, and leading moving targets --------- */

const _sphere = new THREE.Sphere();
const _sv = new THREE.Vector3();
const targetMotion = new WeakMap();

/** A mesh's bounding sphere in world space. */
function worldSphere(mesh, out = _sphere) {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  mesh.updateWorldMatrix(true, false);
  return out.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
}

/**
 * Remember where each target is and how fast it is moving (falling glass,
 * sculpture blades, bobbing caches), smoothed over a few frames, so a throw
 * can lead it.
 */
function trackTargetMotion(targets, dt) {
  if (dt <= 0) return;
  for (const t of targets) {
    const centre = worldSphere(t).center;
    const m = targetMotion.get(t);
    if (!m) { targetMotion.set(t, { last: centre.clone(), velocity: new THREE.Vector3() }); continue; }
    _sv.copy(centre).sub(m.last).divideScalar(dt);
    m.velocity.lerp(_sv, 0.35);
    m.last.copy(centre);
  }
}

/**
 * What the crosshair is aiming at.
 *   1. A ray from the crosshair: the first breakable it hits, if it hits one
 *      before any solid.
 *   2. Aim assist: the breakable nearest the crosshair on screen, if it is
 *      within its catch radius - its own projected size plus a margin, so
 *      small targets (sprinkler bulbs, locks, vent covers, caches) are fair
 *      to hit while running. Nearer targets win ties.
 *   3. Otherwise the solid the ray hits, or a point 60 m out.
 * @returns {{target: THREE.Mesh|null, point: THREE.Vector3, assisted: boolean}}
 */
function resolveAim(targets, solids = []) {
  raycaster.setFromCamera(pointer, camera);
  raycaster.far = 120;
  const direct = raycaster.intersectObjects(targets, false)[0];
  const solid = solids.length ? raycaster.intersectObjects(solids, false)[0] : null;
  const fallback = solid ? solid.point.clone() : raycaster.ray.at(60, new THREE.Vector3());
  raycaster.far = Infinity;
  if (direct && (!solid || direct.distance <= solid.distance)) return { target: direct.object, point: direct.point.clone(), assisted: false };
  if (!settings.aimAssist) return { target: null, point: fallback, assisted: false };

  const halfW = innerWidth / 2;
  const halfH = innerHeight / 2;
  const px = pointer.x * halfW;
  const py = pointer.y * halfH;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  let best = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const sphere = worldSphere(t);
    const depth = -_sv.copy(sphere.center).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth < 1.5 || depth > 70) continue;
    _sv.copy(sphere.center).project(camera);
    const radiusPx = Math.min((sphere.radius / (depth * tanHalf)) * halfH, 90);
    const reach = radiusPx + 30;
    const d = Math.hypot(_sv.x * halfW - px, _sv.y * halfH - py);
    if (d > reach) continue;
    const score = d / reach + depth * 0.004;
    if (score < bestScore) { bestScore = score; best = t; }
  }
  if (!best) return { target: null, point: fallback, assisted: false };
  return { target: best, point: worldSphere(best).center.clone(), assisted: true };
}

/**
 * Lead a moving target: aim where it will be when the sphere arrives. Two
 * passes are enough - the flight time barely changes with the correction.
 */
function leadTarget(target, point, origin, speed, out) {
  out.copy(point);
  const motion = targetMotion.get(target);
  if (!motion || motion.velocity.lengthSq() < 0.04) return out;
  for (let i = 0; i < 2; i += 1) {
    const t = out.distanceTo(origin) / speed;
    out.copy(point).addScaledVector(motion.velocity, t);
  }
  return out;
}

function fire() {
  if (state !== "playing" || paused || photoActive) return;
  const inCauseway = currentLevel === 1 && causeway;
  // Level 1's throw physics (a glass sphere on a gravity arc) in the Foundry too.
  const physical = inCauseway || (currentLevel === 2 && !!foundry);
  // The Skyline's sphere types and serums in the Foundry too.
  const ball = physical ? arsenal.current : null;
  const cost = physical ? arsenal.cost() : 1;
  if (ammo < cost || ammo <= 0 && cost > 0) {
    showMessage(ammo <= 0 ? "NO SPHERES" : `${ball.name.toUpperCase()} NEEDS ${cost}`);
    return;
  }
  ammo -= cost;

  const speed = ball?.speed ?? 34;
  _origin.copy(camera.position);
  if (inCauseway && skyLauncher.rig.visible) {
    // Fired from the launcher's muzzle.
    skyLauncher.muzzle.getWorldPosition(_origin);
    skyLauncher.recoil = 1;
  } else if (inCauseway && !cameraThird) {
    // (No launcher model yet: from the right hand rather than the eye.)
    const right = _segment.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _origin.addScaledVector(right, 0.28).y -= 0.22;
  }

  // Aim at the target under (or, with aim assist, near) the crosshair, else
  // at whatever solid is there, else 60 m out.
  const aim = resolveAim(aliveTargets(), inCauseway ? causeway.solids : []);
  const count = physical && arsenal.isActive("prism") ? 3 : 1;
  run.shots += count;
  updateUI();
  // The Foundry: Subject 07 throws by hand. The arm winds up and the sphere
  // leaves the hand at the release, aimed at what was under the crosshair.
  if (currentLevel === 2 && playerBodyReady && avatar.visible) {
    playerBody.throw();
    pendingThrows.push({ delay: THROW_RELEASE, target: aim.target, point: aim.point.clone(), ball, count });
    return;
  }
  launchSpheres(_origin, aim.target, aim.point, ball, count, physical);
}

/* ---- The launcher in the Skyline ------------------------------------------ */

/**
 * Subject 07 keeps the launcher from the lift up to the Labs (the Gravity
 * Fault ride), so in the Skyline the spheres are fired, not thrown: the same
 * spheres on the same arcs (Level 1's physics), out of its muzzle. In first
 * person it's held low on the right of the view; in the chase view it sits
 * on the shoulder, both hands on it. Only the Foundry throws by hand.
 */
const skyLauncher = { rig: new THREE.Group(), muzzle: new THREE.Object3D(), model: null, recoil: 0 };
skyLauncher.rig.name = "SkylineLauncher";
skyLauncher.muzzle.position.set(0, 0.02, -0.66);
skyLauncher.rig.add(skyLauncher.muzzle);
skyLauncher.rig.visible = false;
scene.add(camera); // so what it holds is drawn
loadMeltdownAssets(MELTDOWN_ASSET_BASE, { names: ["launcher"] }).then((assets) => {
  const asset = assets.get("launcher");
  if (!asset) return;
  const model = asset.template.clone(true);
  // As Level 3 mounts it: long axis down -Z, ~1.25 m.
  model.scale.setScalar(1.25 / Math.max(asset.size.x, asset.size.z));
  model.rotation.y = Math.PI / 2;
  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  // Drawn on the effects layer too, so the main camera always sees it.
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.layers.enable(LAYERS.FX); } });
  skyLauncher.model = model;
  skyLauncher.rig.add(model);
});

/** Where it is this frame: on the camera (first person) or the shoulder. */
function placeSkyLauncher(dt) {
  const on = currentLevel === 1 && !!causeway && (state === "playing" || state === "ended" || state === "lift") && !photoActive;
  // The lift ride's camera pulls out to show Subject 07 in the cabin, even
  // from first person: there the launcher is on the shoulder, in the shot -
  // never left behind on a camera that is now outside the lift.
  const onShoulder = cameraThird || state === "lift";
  skyLauncher.rig.visible = on && !!skyLauncher.model && (onShoulder ? avatar.visible : true);
  playerBody.hold = currentLevel === 1 ? 1 : 0;
  if (!skyLauncher.rig.visible) return;
  skyLauncher.recoil = Math.max(0, skyLauncher.recoil - dt * 7);
  const r = skyLauncher.recoil;
  if (!onShoulder) {
    if (skyLauncher.rig.parent !== camera) camera.add(skyLauncher.rig);
    const bob = settings.reducedMotion ? 0 : Math.sin(run.stepPhase * 2) * Math.min(1, run.speed / 8);
    skyLauncher.rig.position.set(0.34 + bob * 0.01, -0.34 + Math.abs(bob) * 0.012, -0.6 + r * 0.12);
    skyLauncher.rig.rotation.set(0.05 + r * 0.2, 0.05, bob * 0.02);
  } else {
    if (skyLauncher.rig.parent !== playerBody.shoulder) playerBody.shoulder.add(skyLauncher.rig);
    skyLauncher.rig.position.set(-0.04, -0.07, -0.18 + r * 0.1);
    skyLauncher.rig.rotation.set(r * 0.15, 0, 0);
  }
}

/** Thrown, waiting for the hand to let go (the Foundry's overhand throw). */
const pendingThrows = [];
function updatePendingThrows(dt) {
  for (let i = pendingThrows.length - 1; i >= 0; i -= 1) {
    const p = pendingThrows[i];
    p.delay -= dt;
    if (p.delay > 0) continue;
    pendingThrows.splice(i, 1);
    if (state !== "playing") continue;
    // A target that moved in the meantime is led from where it is now.
    const target = p.target?.userData.alive ? p.target : null;
    const point = target ? worldSphere(target).center.clone() : p.point;
    launchSpheres(playerBody.releasePoint(_origin), target, point, p.ball, p.count, true);
  }
}

/** Spheres away from `origin` toward an aim point (leading a moving target). */
function launchSpheres(origin, target, point, ball, count, physical) {
  const speed = ball?.speed ?? 34;
  const gravity = physical ? ball.gravity : 0;
  if (target) leadTarget(target, point, origin, speed, _aim);
  else _aim.copy(point);
  for (let i = 0; i < count; i += 1) {
    const dir = _aim.clone().sub(origin);
    const distance = dir.length();
    dir.normalize();
    if (count > 1) dir.applyAxisAngle(_up, (i - 1) * 0.07);
    // Ballistic compensation: aim high by exactly the drop over the flight
    // time, so the sphere arcs onto the reticle.
    const t = distance / speed;
    const velocity = dir.multiplyScalar(speed).addScaledVector(_up, 0.5 * gravity * t);
    const mesh = new THREE.Mesh(projectileGeometry, ball ? projectileMaterials[ball.key] : legacyProjectileMaterial);
    mesh.scale.setScalar(ball?.radius ?? 0.18);
    const halo = sphereHalo(ball?.key ?? "glass");
    halo.layers.set(LAYERS.FX);
    mesh.add(halo);
    mesh.position.copy(origin);
    mesh.layers.set(LAYERS.FX);
    scene.add(mesh);
    projectiles.push({ mesh, velocity, life: 3, gravity, ball: ball?.key ?? "glass", scored: false, bounces: 0, wallBounces: 0, ceilingBounces: 0 });
  }
  if (physical) level1Audio.throwBall();
}

/** A special sphere going off: cryo puts out fires, shock breaks everything nearby. */
function detonate(p, point) {
  if (p.ball === "glass") return;
  if (currentLevel === 2 && foundry) { detonateFoundry(p, point); return; }
  if (!causeway) return;
  const def = BALLS[p.ball];
  causeway.splash(point, def.splash, p.ball);
  if (p.ball === "shock") {
    for (const target of causeway.targetsNear(point, def.splash)) {
      const r = shatter(target, { point: target.getWorldPosition(new THREE.Vector3()), direction: p.velocity, ball: "shock" });
      if (r && !r.rejected) p.scored = true;
    }
    triggerShake(0.25);
  }
  if (p.ball === "cryo") p.scored = true;
}

/**
 * The special spheres in the Foundry: shock shatters every cell and switch
 * within reach; cryo freezes the machinery around it for a few seconds
 * (pistons stop where they are - still solid, but no longer moving).
 */
function detonateFoundry(p, point) {
  const def = BALLS[p.ball];
  sphereImpact.splash(point, p.ball, def.splash);
  shatterFX.chunks(point, 26, { tint: p.ball === "cryo" ? 0xbff4ff : 0xd9a6ff, speed: 5, radius: def.splash * 0.3, size: 0.08 });
  if (p.ball === "shock") {
    for (const target of foundry.breakables.slice()) {
      if (!target.userData.alive || target.getWorldPosition(_sv).distanceTo(point) > def.splash) continue;
      const r = shatter(target, { point: _sv.clone(), direction: p.velocity, ball: "shock" });
      if (r) p.scored = true;
    }
    triggerShake(0.25);
  } else if (p.ball === "cryo") {
    const frozen = foundry.freezeNear(point, def.splash, 4);
    if (frozen) { showMessage(`CRYO // ${frozen} MACHINE${frozen > 1 ? "S" : ""} FROZEN`); p.scored = true; }
  }
  level1Audio.glassBreak();
}

const _seg = new THREE.Line3();
const _closest = new THREE.Vector3();
/** Nearest small target the segment a->b passes within `tolerance` of. */
function grazeTarget(targets, a, b, tolerance) {
  _seg.set(a, b);
  let best = null;
  let bestDistance = Infinity;
  for (const t of targets) {
    const sphere = worldSphere(t);
    if (sphere.radius > 1.1) continue;                    // panes and doors are big enough already
    _seg.closestPointToPoint(sphere.center, true, _closest);
    const d = _closest.distanceTo(sphere.center) - sphere.radius;
    if (d < tolerance && d < bestDistance) {
      bestDistance = d;
      best = { object: t, point: _closest.clone(), distance: a.distanceTo(_closest) };
    }
  }
  return best;
}

function updateProjectiles(dt) {
  const targets = aliveTargets();
  const solids = currentLevel === 1 && causeway ? causeway.solids : currentLevel === 2 && foundry ? foundry.obstacles : [];
  const physical = currentLevel === 1 || currentLevel === 2;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const old = p.mesh.position.clone();
    p.velocity.y -= p.gravity * dt;
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.life -= dt;
    _segment.copy(p.mesh.position).sub(old);
    const length = _segment.length();
    if (length > 1e-5) {
      raycaster.set(old, _segment.divideScalar(length));
      raycaster.far = length + p.mesh.scale.x;
      let hit = raycaster.intersectObjects(targets, false)[0];
      const solid = solids.length ? raycaster.intersectObjects(solids, false)[0] : null;
      // The corridor's walls and ceiling: a clean ricochet (the Skyline's, in the Foundry too).
      const surface = currentLevel === 1 && causeway ? causeway.corridorSurfaceHit(old, p.mesh.position, p.mesh.scale.x)
        : currentLevel === 2 && foundry ? foundry.surfaceHit(old, p.mesh.position, p.mesh.scale.x) : null;
      raycaster.far = Infinity;
      // Near miss on a small target counts: a sphere passing within its own
      // radius plus 0.25 m of a small target's bounding sphere hits it.
      if (!hit && physical) hit = grazeTarget(targets, old, p.mesh.position, p.mesh.scale.x + 0.25);
      if (hit && (!solid || hit.distance <= solid.distance) && (!surface || hit.distance <= surface.distance)) {
        const result = shatter(hit.object, { point: hit.point, direction: p.velocity, ball: p.ball });
        if (result && !result.rejected) { p.scored = true; run.hits += 1; }
        if (p.ball !== "glass") { detonate(p, hit.point); p.life = 0; }
        else if (!result || result.cracked || result.rejected || !(currentLevel === 1 ? ["pane", "blade", "falling", "tank", "door"] : currentLevel === 2 ? ["cell"] : []).includes(result.kind)) p.life = 0;
        else p.velocity.multiplyScalar(0.82); // glass spheres punch through and keep going
      } else if (surface && (!solid || surface.distance <= solid.distance)) {
        const speed = p.velocity.length();
        p.velocity.reflect(surface.normal).normalize().multiplyScalar(speed * BALL_CORRIDOR_RESTITUTION);
        p.mesh.position.copy(surface.position);
        if (surface.surface === "ceiling") p.ceilingBounces += 1;
        else p.wallBounces += 1;
        level1Audio.surfaceRicochet();
        if (causeway && currentLevel === 1) causeway.ricochet(surface.point);
        else shatterFX.chunks(surface.point, 8, { tint: 0xffd9a0, speed: 3, radius: 0.05, size: 0.04, life: 0.9 });
      } else if (solid) {
        if (p.ball !== "glass") { detonate(p, solid.point); p.life = 0; }
        else {
          // Ricochet off solid hazards: reflect about the face normal.
          const n = solid.face ? solid.face.normal.clone().transformDirection(solid.object.matrixWorld) : _forward.clone().negate();
          p.velocity.reflect(n).multiplyScalar(0.45);
          p.mesh.position.copy(solid.point).addScaledVector(n, 0.2);
          if (causeway && currentLevel === 1) causeway.ricochet(solid.point);
          else { shatterFX.chunks(solid.point, 5, { tint: 0xffd9a0, speed: 2.5, radius: 0.05, size: 0.04, life: 0.9 }); level1Audio.surfaceRicochet(); }
          if (++p.bounces > 2) p.life = 0;
        }
      }
    }
    // Floor bounce in Level 1 and the Foundry.
    if (physical && p.life > 0 && p.mesh.position.y < p.mesh.scale.x && p.velocity.y < 0) {
      if (p.ball !== "glass") { detonate(p, p.mesh.position); p.life = 0; }
      else { p.velocity.y *= -0.42; p.velocity.x *= 0.75; p.velocity.z *= 0.75; p.mesh.position.y = p.mesh.scale.x; }
    }
    if (p.life <= 0) {
      if (!p.scored && (currentLevel === 2 || currentLevel === 1)) { combo = 1; comboTimer = 0; }
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

/* ==================================================================== */
/* GRAVITY LIFT - the Level 2 -> 3 elevator ride                         */
/* ==================================================================== */

/** Seconds into Level 2's Calibration Lift ride (doors shut, climbing) to fade into the Gravity Fault. */
const FOUNDRY_LIFT_HANDOFF = 2.2;

/**
 * The Gravity Fault lift (src/elevators/gravity-fault.js) is its own scene,
 * like Level 3: this block builds it once the Foundry has faded out, renders
 * it instead of the main scene while it runs, and hands over to Level 3 when
 * it is done. Level 3's models keep streaming in while it runs.
 */
/**
 * @param {object} [o]
 * @param {boolean} [o.boarded]  the player already boarded (Level 2's Calibration
 *   Lift): skip the doors-closing shot and start as the lift launches
 */
function startGravityLift({ boarded = false } = {}) {
  if (gravityLift) return;
  music.enterElevator();
  currentLevel = 2; state = "lift"; transitionTarget = 3; liftTimer = 0;
  // Okoro leaves the main scene with the Foundry (the ride has its own scene).
  foundryGuide = null;
  hideOkoro();
  // Free Level 2 (and its lift) now rather than on the way into Level 3.
  setFoundryActive(false);
  if (foundry) { foundryHud.unbind(); foundry.dispose(); foundry = null; }
  foundryLift?.dispose();
  foundryLift = null;
  preloadMeltdown();
  // Build Level 3 now, behind the black, so it is ready when the ride ends.
  prepareMeltdown();
  rideNext = "labs";
  music.playStage("tension");
  level1Audio.preloadStage("lift");
  story.voice.preload([...STORY_LINES.liftFault, ...STORY_LINES.liftBreaks, ...STORY_LINES.liftSaved]);
  gravityLift = new GravityFaultRide({
    renderer, spheres: ammo, reducedMotion: settings.reducedMotion, boarded,
    // The same character as in the Foundry (null while it is still loading),
    // as they left it: dusty.
    character: playerBodyTemplate,
    figure: { ...figureStage(sectorNumber()), skinTone: savedSkinTone() },
    // Level 3's launcher crashes into the lift (and stays with the player).
    assetBase: MELTDOWN_ASSET_BASE,
    // The story's version: Okoro drops the launcher, the clamps are reaction hits.
    story: storyRun && runKind === "story" ? { layer: story, okoroTemplate } : null,
  });
  gravityLift.onPointerMove(pointer.x, pointer.y);
  bindRideSounds(gravityLift);
  // The ride has its own alerts; clear the game's message line for them.
  ui.message.classList.remove("show"); messageTimer = 0;
  updateUI();
}

function updateGravityLiftFrame(dt, time) {
  gravityLift.update(dt, time);
  level1Audio.updateElevator(gravityLift.state?.velocity ?? gravityLift.speed ?? 0, !gravityLift.result.done);
  ui.fade.style.opacity = gravityLift.fade.toFixed(3);
  // A cutscene ride hides the game's HUD while it plays.
  document.body.classList.toggle("cutscene", !!gravityLift.cutscene);
  ui.reticle.classList.toggle("hot", !!gravityLift.aimTarget);
  ui.reticle.classList.toggle("assist", !!gravityLift.aimTarget);
  if (gravityLift.result.done) finishGravityLift();
}

/**
 * The quiet ride (src/elevators/quiet-ride.js) - cutscene 7 of the story: the
 * Labs' corridor is done and the scientist has given their life at the lift;
 * alone for the first time, the player rides up to the Skyline. It uses the
 * same slot as the Gravity Fault (`gravityLift`), and hands over to the
 * Skyline's lift arrival.
 */
function startQuietRide() {
  if (gravityLift) return;
  if (currentLevel === 3) leaveMeltdown(1);
  setFoundryActive(false);
  state = "lift"; transitionTarget = 0; liftTimer = 0;
  music.enterElevator();
  // Build the Skyline now, behind the fade-in, so it is ready when the ride ends.
  if (!causeway) buildCauseway("story");
  if (causeway) setCausewayActive(false);
  rideNext = "skyline";
  // Alone, after Okoro: the grief, and the pilot on his radio.
  music.playStage("grief");
  level1Audio.preloadStage("lift");
  level1Audio.preloadStage("skyline");
  story.voice.preload(Object.values(RADIO_LINES).map(([, text]) => ({ who: "pilot", text })));
  gravityLift = new QuietRide({
    renderer, spheres: ammo, reducedMotion: settings.reducedMotion,
    character: playerBodyTemplate,
    // Bloodied from the Labs, in the scientist's vest with his radio.
    figure: { ...figureStage(3), skinTone: savedSkinTone() },
    // The launcher leans on the lift wall until they pick it up.
    assetBase: MELTDOWN_ASSET_BASE,
  });
  bindRideSounds(gravityLift);
  ui.message.classList.remove("show"); messageTimer = 0;
  updateUI();
}

/**
 * The lifts' sounds: the rides emit what happens (src/elevators/), this
 * plays it. The story's Gravity Fault says some of it in stage directions
 * instead ([the launcher clatters...], [the last cable snaps]), so those
 * are left to the cues.
 */
function bindRideSounds(ride) {
  const on = (name, fn) => ride.events.on(name, (p) => { if (gravityLift === ride) fn(p ?? {}); });
  const told = !!ride.director;
  on("tremor", () => level1Audio.distantCollapse(0.8));
  on("cable-snap", (p) => { if (!p.story) level1Audio.play("cable-snap"); });
  on("brake", () => level1Audio.play("brake"));
  on("brake-slam", () => { level1Audio.impact(1); level1Audio.play("clank"); });
  on("flicker", () => level1Audio.play("spark", { cooldown: 0.8, volume: 0.5 }));
  on("launcher-land", () => { if (!told) level1Audio.play("clatter"); });
  on("launcher-thud", () => level1Audio.impact(0.6));
  on("clamp-shot", () => level1Audio.throwBall());
  on("clamp-lock", () => level1Audio.play("clank"));
  on("glass-crack", () => level1Audio.play("glassStep", { volume: 0.5, cooldown: 0.1 }));
  on("glass-break", () => level1Audio.glassBreak());
  on("depart", () => { level1Audio.play("lift-doors", { volume: 0.6 }); if (ride instanceof QuietRide) level1Audio.breath("pant"); });
  on("arrive", () => level1Audio.play("lift-chime"));
  on("chime", () => level1Audio.play("lift-chime"));
  on("doors", () => level1Audio.play("lift-doors"));
  // The quiet ride's radio: Kestrel One, calling for the doctor.
  on("radio", ({ line }) => {
    const entry = RADIO_LINES[`radio${line}`];
    if (entry) story.voice.say({ who: "pilot", text: entry[1] });
  });
}

/** Where the ride in `gravityLift` goes when it is done: "labs" or "skyline". */
let rideNext = "labs";

/** The ride is over: its bonus into the score, then into the next stage. */
function finishGravityLift() {
  const { bonus, spheres } = gravityLift.result;
  score += bonus;
  ammo = spheres;
  // Both destinations open in an arrival lift, so keep the interior mix
  // through the black handoff instead of briefly restoring the Level track.
  leaveGravityLift({ preserveInterior: true });
  updateUI();
  if (rideNext === "skyline") enterSkyline();
  else enterMeltdown();
}

/** Free the ride (finished, restart, quit or a demo jump). */
function leaveGravityLift({ preserveInterior = false } = {}) {
  level1Audio.updateElevator(0, false);
  if (!preserveInterior) music.exitElevator();
  if (gravityLift) gravityLift.dispose();
  gravityLift = null;
  document.body.classList.remove("cutscene");
}

/** Demo key 5: straight into the lift ride from anywhere in a run. */
function demoGravityLift() {
  if (state !== "playing") return;
  if (currentLevel === 3) leaveMeltdown(2);
  if (currentLevel === 1 && causeway) setCausewayActive(false);
  ammo = Math.max(ammo, 8);
  startGravityLift();
  markDemo();
}

/** Demo key 6: straight into the quiet ride (cutscene 7), then the Skyline. */
function demoQuietRide() {
  if (state !== "playing") return;
  music.fadeOut();
  leaveGravityLift();
  runKind = "story"; endlessEnv = null;
  if (currentLevel === 1 && causeway) { setCausewayActive(false); level1Audio.cleanupLevel(); }
  startQuietRide();
  markDemo();
}

/* ==================================================================== */
/* Game flow                                                            */
/* ==================================================================== */

function resetStats(mode = causewayMode) {
  endStoryStage();
  leaveGravityLift();
  meltdownPrepared = null;
  if (currentLevel === 3 || meltdown?.visible) leaveMeltdown(1);
  foundrySpeedScale = 1; endlessRun.laps = 0; endlessRun.distance = 0;
  ammo = START_SPHERES; health = 100; score = 0; lane = 1; playerX = 0; playerY = 0;
  cameraThird = false; liftTimer = 0; currentLevel = 1; transitionTarget = 0; shake = 0;
  jumpHeight = 0; jumpVelocity = 0; sliding = 0; combo = 1; comboTimer = 0; snapCamera = true;
  simTime = 0;
  keysDown.clear();
  resetRun();
  arsenal.reset();
  if (mode === "story") missions.start(); else missions.active = [];
  // Rebuild the foundry from scratch so a restart gets a fresh set of switches
  // and gates. dispose() frees the old one's GPU resources.
  buildFoundry();
  setFoundryActive(false);
  buildCauseway(mode);
  runZ = CAUSEWAY_ORIGIN_Z;
  setCausewayActive(true);
  camera.fov = 68; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
  causewayHud.reset();
  causewayHud.setMissions(missions.active);
  ui.fade.style.opacity = 0;
  for (const mesh of breakables) { mesh.visible = true; mesh.userData.alive = true; mesh.scale.setScalar(1); }
  for (const mesh of obstacles) mesh.userData.hit = false;
  for (const p of projectiles) scene.remove(p.mesh); projectiles.length = 0;
  pendingThrows.length = 0;
  shatterFX.clear();
  sphereImpact.clear();
  ui.end.classList.remove("active"); updateUI();
}

/**
 * Police helicopters over the Skyline (src/fx/police-helicopters.js): they
 * circle the city with their lights going and searchlights sweeping the
 * streets - and now and then the skybridge. Loaded the first time the
 * Skyline (or the menu behind it) shows.
 */
let police = null;
function updatePolice(dt, time, active) {
  if (!active) {
    if (police) police.root.visible = false;
    return;
  }
  if (!police) {
    police = new PoliceHelicopters({ count: 3 });
    scene.add(police.root);
    police.load(MELTDOWN_ASSET_BASE);
  }
  police.root.visible = true;
  const distance = CAUSEWAY_ORIGIN_Z - camera.position.z;
  police.update(dt, time, {
    worldZ: (d) => CAUSEWAY_ORIGIN_Z - d,
    distance,
    deckY: causeway?.shell?.deckHeight(distance + 8) ?? 0,
    overDeck: causewayThemeAt(distance, causewayMode) === "bridge",
  });
}

/**
 * Play the Causeway (the Skyline) straight away, in its own "story" or
 * "endless" mode - the test harness and dev tools use this; the menus go
 * through startCampaign() / startEndless().
 */
function resetGame(mode = causewayMode) {
  storyRun = false;
  runKind = mode === "endless" ? "endless" : "story";
  endlessEnv = mode === "endless" ? "skyline" : null;
  resetStats(mode); state = "playing";
  level1Audio.startLevel();
  music.playStage("skyline");
  causewayHud.show();
  if (mode === "endless") causewayHud.title("Endless lab", "Randomised. Faster every 250 m.", 2.2);
}

/* ---- The story and endless runs ----------------------------------------- */

/** The Calibration Lift the player arrives in at the start of the Skyline. */
let skylineLift = null;
function buildSkylineLift() {
  skylineLift?.dispose();
  skylineLift = new CalibrationLift();
  // Behind the start line, doors facing down the ward (local +Z -> world -Z).
  skylineLift.root.position.set(0, 0, CAUSEWAY_ORIGIN_Z + LIFT_RADIUS + 0.9);
  skylineLift.root.rotation.y = Math.PI;
  skylineLift.setDoorsOpen(0);
  skylineLift.root.visible = false;
  scene.add(skylineLift.root);
}

/** Common reset for arriving in a runner level. */
function resetRunner() {
  lane = 1; playerX = 0; playerY = 0; jumpHeight = 0; jumpVelocity = 0; sliding = 0;
  shake = 0; snapCamera = true; liftTimer = 0;
  camera.fov = 68; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
}

/** Start pressed: the story, from the basement up. */
function startCampaign() {
  storyRun = true;
  runClock = 0;
  runFromStart = true;
  runRecordable = true;
  resetStats("story");
  runKind = "story"; endlessEnv = null; storyBalls = null;
  enterFoundry();
  // Okoro brings the spheres: none until he hands over the bag.
  ammo = 0;
  wearSphereBag(false);
  storyCheckpoint = { stage: "foundry", score: 0, ammo: 0, balls: null };
  updateUI();
  if (!story.hasSeen("wake")) beginOpening();
  else startFoundryGuide();
}

/* ==================================================================== */
/* STORY - Phase 2: the opening                                          */
/* ==================================================================== */

/**
 * The wake-up: black, the monitor, HALCYON; the lids fail twice and open on
 * the ward ceiling; Okoro over the bed; up, and out behind him through the
 * service passage into the Foundry, where the camera rises into the run's
 * chase view and play begins (src/story/stages/ward.js, scenes.js).
 */
function beginOpening() {
  state = "cutscene";
  cameraThird = true;
  cutsceneShowsPlayer = false;
  ward?.dispose();
  ward = new WardStage({ startZ: FOUNDRY_ORIGIN_Z, foundry: foundry?.kit.materials ?? null });
  scene.add(ward.root);
  showOkoro(ward.okoroStart.position, ward.okoroStart.heading);
  setWardLight(1);
  ui.fade.style.opacity = "0";
  run.fadeOut = 0;
  // Waking up to the countdown (the monitor's beep is the scene's own cue).
  music.playStage("tension");
  story.play(wakeScene({ ...ward.anchors, okoro }), {
    camera,
    on: {
      done: ({ skipped }) => {
        // Holding Esc skips the whole opening, straight to the run.
        if (skipped || !ward) finishOpening();
        else playWalkOut();
      },
    },
  });
}

function playWalkOut() {
  story.play(walkOutScene({ ...ward.walkAnchors(), okoro, onProgress: (k) => setWardLight(1 - k) }), {
    camera,
    on: {
      event: (name) => {
        if (name === "show-player") cutsceneShowsPlayer = true;
      },
      done: () => finishOpening(),
    },
  });
}

/** The opening is over (or skipped): the run begins, Okoro ahead. */
function finishOpening() {
  ward?.dispose();
  ward = null;
  setWardLight(0);
  cutsceneShowsPlayer = false;
  if (state !== "cutscene") return;
  state = "playing";
  music.playStage("foundry");
  snapCamera = true;
  camera.fov = 68; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
  startFoundryGuide();
}

/** The ward is lit by the scene's own lights, brightened; 0 = the Foundry's values. */
function setWardLight(k) {
  const t = THREE.MathUtils.clamp(k, 0, 1);
  hemi.intensity = THREE.MathUtils.lerp(0.35, 1.3, t);
  hemi.color.setRGB(1, 0.816, 0.627).lerp(_wardSky.set(0xdfefff), t);
  sun.intensity = THREE.MathUtils.lerp(0.35, 0.7, t);
}
const _wardSky = new THREE.Color();

function showOkoro(position, heading) {
  if (okoro.root.parent !== scene) scene.add(okoro.root);
  okoro.root.visible = true;
  okoro.root.position.copy(position);
  okoro.root.rotation.y = heading;
  okoro.act("idle").lookAt(null);
  okoro.speed = 0;
  Object.assign(okoro.adjust, { lean: 0, headNod: 0, twist: 0, aimR: 0, aimL: 0 });
}

function hideOkoro() {
  okoro.root.visible = false;
  scene.remove(okoro.root);
}

/* ---- The sphere bag: Dr. Okoro's backpack of glass spheres -------------- */

/**
 * The bag of spheres (assets/meltdown/backpack.glb). Okoro carries it into
 * the Foundry and tosses it to you on the run; you wear it from then on.
 * Origin at the top of the bag (the grab handle), hanging down -Y.
 */
const sphereBag = new THREE.Group();
sphereBag.name = "SphereBag";
const BAG_HEIGHT = 0.5;
{
  // A stand-in until the model is in: a canvas pack.
  const standIn = new THREE.Mesh(new THREE.BoxGeometry(0.36, BAG_HEIGHT, 0.2), new THREE.MeshStandardMaterial({ color: 0x3e4535, roughness: 0.9 }));
  standIn.position.y = -BAG_HEIGHT / 2;
  sphereBag.add(standIn);
  loadMeltdownAssets(MELTDOWN_ASSET_BASE, { names: ["backpack"] }).then((assets) => {
    const asset = assets.get("backpack");
    if (!asset) return;
    const model = asset.template.clone(true);
    model.scale.setScalar(BAG_HEIGHT / asset.size.y);
    model.position.y = -BAG_HEIGHT;
    // Its straps face the wearer's back (the model's -Z).
    model.rotation.y = Math.PI;
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    sphereBag.add(model);
    standIn.visible = false;
  });
}
/** The toss from Okoro's hand to your back: { t, from }. */
let bagToss = null;
const BAG_TOSS_SECONDS = 0.62;
/** Seconds after the hand-off line before he lets go (he turns to you first). */
const BAG_TOSS_DELAY = 0.5;

/** Put the bag on the player's back (or take it off). */
function wearSphereBag(on) {
  okoro.drop(sphereBag);
  bagToss = null;
  if (!on) { playerBody.wear(null); sphereBag.removeFromParent(); return; }
  playerBody.wear(sphereBag);
  // On the back: top at the shoulder blades, straps against the body.
  sphereBag.position.set(0, BAG_HEIGHT * 0.55, 0.06);
  sphereBag.rotation.set(0, 0, 0);
  sphereBag.visible = true;
}

/** Okoro carries the bag in his left hand, by the grab handle. */
function giveOkoroTheBag() {
  playerBody.wear(null);
  okoro.drop(sphereBag);
  // The hand's frame points -Z down the forearm; the bag hangs that way.
  okoro.hold(sphereBag, { hand: "L", rotation: [Math.PI / 2, 0, 0] });
  sphereBag.visible = true;
}

function startBagToss() {
  okoro.drop(sphereBag, scene);
  bagToss = { t: 0, from: sphereBag.position.clone(), spin: sphereBag.rotation.x };
}

const _bagTo = new THREE.Vector3();
const _bagBack = new THREE.Vector3(0, 1.15, 0.25);
function updateBagToss(dt) {
  if (!bagToss) return;
  bagToss.t += dt;
  const k = Math.min(1, bagToss.t / BAG_TOSS_SECONDS);
  if (playerBodyReady) playerBody.back.getWorldPosition(_bagTo);
  else _bagTo.copy(avatar.position).add(_bagBack);
  _bagTo.y += BAG_HEIGHT * 0.55;
  sphereBag.position.lerpVectors(bagToss.from, _bagTo, k);
  sphereBag.position.y += Math.sin(Math.PI * k) * 0.9;
  // A tumble in the air that settles upright as you catch it.
  sphereBag.rotation.set(bagToss.spin * (1 - k) + Math.sin(k * Math.PI) * 1.4, avatar.rotation.y, 0);
  if (k < 1) return;
  wearSphereBag(true);
  ammo += 12;
  level1Audio.sphereCollected();
  showMessage("+12 GLASS SPHERES // DR. OKORO'S BAG");
  updateUI();
}

/** Okoro runs the Foundry with you (story runs only). */
function startFoundryGuide() {
  if (!storyRun || runKind !== "story" || !foundry) return;
  const talk = !story.hasSeen("foundryTalk");
  foundryGuide = new FoundryGuide({ okoro, level: foundry, lift: foundryLift, talk });
  showOkoro(okoro.root.position, 0);
  foundryGuide.start(foundryDistance(), { lateral: 0 });
  okoro.act("run");
  // No spheres until he hands over the bag.
  if (ammo <= 0) giveOkoroTheBag();
  else wearSphereBag(true);
}

function updateFoundryGuide(dt) {
  if (!foundryGuide) return;
  const out = foundryGuide.update(dt, {
    distance: foundryDistance(),
    speed: foundryPace,
    lane,
    exiting: foundryExit,
    riding: !!foundryLift?.state.riding,
  });
  for (const line of out.lines) {
    story.talk(line);
    story.markSeen("foundryTalk");
  }
  if (out.cues.includes("handoff")) {
    // He turns, arm out, and tosses you the bag of spheres the run needs.
    foundryGuide.tossIn = BAG_TOSS_DELAY;
  }
  if (foundryGuide.tossIn !== undefined) {
    foundryGuide.tossIn -= dt;
    if (foundryGuide.tossIn <= 0) {
      foundryGuide.tossIn = undefined;
      if (sphereBag.parent === okoro.root) startBagToss();
    }
  }
  okoro.update(dt, { speed: foundryGuide.gaitSpeed });
  updateBagToss(dt);
}

/* ==================================================================== */
/* STORY - Phase 5: the Skyline's blast, sprint, jump and latch          */
/* ==================================================================== */

/**
 * Where the tower behind blows, and where you land (route distances). The
 * bridge's slots are 8 m long: the ramp swings about the tip (a slot
 * boundary), the slot past it falls away, and the far building's edge is
 * the next boundary.
 */
const SKYLINE_BLAST_AT = 500;
const SKYLINE_RAMP_FROM = 472;
const SKYLINE_TIP = 536;
const SKYLINE_LEDGE = 544;
const SKYLINE_STAND = 550;
/** The tower that's demolished: beside the bridge, behind you, its base far below. */
const SKYLINE_TOWER = { d: 425, x: -42, base: -34 };
/** The story's Skyline extras while the Skyline runs in a story run: { ledge, tower, done }. */
let skylineStory = null;

/** The far building's edge to catch: a concrete lip at the start of the atrium. */
function buildSkylineStory() {
  disposeSkylineStory();
  const group = new THREE.Group();
  group.name = "SkylineStory";
  // Lit from below by the fires (an emissive warmth: no real light, which
  // would recompile the level's materials).
  const concrete = new THREE.MeshStandardMaterial({ color: 0x6d6a64, roughness: 0.92, metalness: 0.05, emissive: 0x3a1a0a, emissiveIntensity: 0.9 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.6, metalness: 0.7, emissive: 0x1a0c06 });
  const lip = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.9, 0.8), concrete);
  lip.position.set(0, -0.43, CAUSEWAY_ORIGIN_Z - (SKYLINE_LEDGE + 0.4));
  group.add(lip);
  // Torn rebar where the bridge used to meet it.
  for (let i = 0; i < 9; i += 1) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9 + (i % 3) * 0.3, 5), steel);
    bar.rotation.x = Math.PI / 2 + ((i % 4) - 1.5) * 0.25;
    bar.position.set(-5.2 + i * 1.3, -0.35 + (i % 2) * 0.2, CAUSEWAY_ORIGIN_Z - SKYLINE_LEDGE + 0.35);
    group.add(bar);
  }
  // Your hands on the lip, while you hang from it (in your skin tone).
  const tone = SKIN_TONES[savedSkinTone()] ?? SKIN_TONES.medium;
  const ledgeHands = new LedgeHands({ skin: tone.color ?? tone.swatch });
  const hands = ledgeHands.root;
  hands.position.set(0, 0.02, CAUSEWAY_ORIGIN_Z - SKYLINE_LEDGE - 0.12);
  hands.visible = false;
  group.add(hands);
  // The tower that's demolished floor by floor (stages/demolition-tower.js).
  const tower = new DemolitionTower({ floors: 24, width: 22 });
  tower.root.position.set(SKYLINE_TOWER.x, SKYLINE_TOWER.base, CAUSEWAY_ORIGIN_Z - SKYLINE_TOWER.d);
  group.add(tower.root);
  // The sky over it all once the tower goes: smoke lit from below, embers,
  // searchlights, stars (what you look up at, on your back).
  const sky = new SmokeSky({ fire: new THREE.Vector3(SKYLINE_TOWER.x, SKYLINE_TOWER.base + 12, CAUSEWAY_ORIGIN_Z - SKYLINE_TOWER.d) });
  sky.root.position.set(0, 0, CAUSEWAY_ORIGIN_Z - SKYLINE_LEDGE);
  group.add(sky.root);
  scene.add(group);
  skylineStory = { group, tower, hands, ledgeHands, sky, done: false, flash: 0, materials: [concrete, steel] };
}

function disposeSkylineStory() {
  if (!skylineStory) return;
  skylineStory.tower.dispose();
  skylineStory.ledgeHands.dispose();
  skylineStory.sky.dispose();
  skylineStory.group.traverse((o) => o.isMesh && o.geometry.dispose());
  for (const m of skylineStory.materials) m.dispose();
  skylineStory.group.removeFromParent();
  skylineStory = null;
}

function beginSkylineBlast() {
  const s = skylineStory;
  state = "cutscene";
  keysDown.clear();
  causewayHud.warning(null);
  const chase = causeway.state.chase;
  const at = (d, x = 0, y = 0) => new THREE.Vector3(x, y, CAUSEWAY_ORIGIN_Z - d);
  const start = causewayDistance();
  const reactions = story.reactions;
  const shell = causeway.shell;
  // Behind the ramp the bridge falls away as before; the ramp itself swings.
  chase.front = SKYLINE_RAMP_FROM;
  s.blasted = true;
  hideRampProps();
  const tower = s.tower;
  tower.onFloor = (i) => {
    if (i % 3 === 0) level1Audio.impact(0.35 + (i / tower.floors) * 0.3);
    triggerShake(0.08);
  };
  tower.onWhole = () => {
    s.flash = 1;
    s.sky.setVisible(true);
    // The whole tower going: the sound of it arrives with the dust.
    level1Audio.buildingCollapse(1);
    level1Audio.impact(1);
    level1Audio.glassBreak();
    level1Audio.podBreak?.();
  };
  // Where to look: the floor going now (up the building), then its middle.
  const towerFocus = new THREE.Vector3();
  const focusTower = () => {
    const going = tower.started ? Math.min(tower.floors, tower.time / tower.interval) : 0;
    const floors = tower.state.whole > 0 ? tower.floors * 0.55 : going + 0.5;
    return towerFocus.copy(at(SKYLINE_TOWER.d, SKYLINE_TOWER.x * 0.85, SKYLINE_TOWER.base + floors * 4.2 - tower.state.sink));
  };
  const scene = blastScene({
    at,
    deck: (d) => shell.deckHeight(d),
    startD: start,
    tipD: SKYLINE_TIP,
    ledgeD: SKYLINE_LEDGE,
    standD: SKYLINE_STAND,
    wholeAt: tower.wholeDelay,
    setTilt: (angle, drop) => {
      const t = shell.tilt;
      if (t && Math.abs(t.angle - angle) < 1e-4 && Math.abs(t.drop - drop) < 1e-4) return;
      shell.setTilt({ from: SKYLINE_RAMP_FROM, pivot: SKYLINE_TIP, angle, drop, gapTo: SKYLINE_LEDGE });
    },
    sprint: () => {
      const on = story.player.state === "reaction" && story.player._reaction?.id === "sprint" && reactions.running;
      return { active: on, bar: on ? reactions._s.bar : 1, elapsed: on ? reactions._s.total : 0 };
    },
    dying: () => story.deathTime,
    tower: focusTower,
  });
  story.play(scene, {
    camera,
    deathSeconds: 1.9,
    deathLine: STORY_LINES.fallen[0],
    on: {
      event: (name) => {
        if (name === "detonate") {
          if (!tower.started) tower.detonate();
          level1Audio.impact(0.6);
          level1Audio.demolitionCharges(1);
        } else if (name === "tilt") {
          level1Audio.impact(0.9);
          level1Audio.metalGroan(1.2);
          triggerShake(0.4);
        } else if (name === "jump") { level1Audio.throwBall?.(); level1Audio.grunt(); }
        else if (name === "caught") { level1Audio.impact(0.7); level1Audio.grunt(); s.caught = true; s.flash = 0.3; s.hands.visible = true; }
        else if (name === "up") s.hands.visible = false;
      },
      // A miss: no hands on anything.
      retry: () => { s.hands.visible = false; s.caught = false; },
      fail: () => { level1Audio.impact(0.5); level1Audio.fallScream(); },
      done: () => finishSkylineBlast(),
    },
  });
}

/**
 * What stood on the ramp's stretch of the bridge (and the door at the far
 * end) goes over the side with it - including anything streamed in since.
 */
function hideRampProps() {
  if (!skylineStory?.blasted || !causeway) return;
  for (const rec of causeway.live) {
    if (rec.rampHidden || rec.entry.d < SKYLINE_RAMP_FROM || rec.entry.d >= SKYLINE_LEDGE || !rec.root) continue;
    // (The level shows and hides its props' roots by distance: hide what's under them.)
    rec.root.traverse((o) => { if (o !== rec.root) o.visible = false; });
    rec.rampHidden = true;
  }
}

function finishSkylineBlast() {
  if (skylineStory) skylineStory.done = true;
  if (state !== "cutscene") return;
  state = "playing";
  runZ = CAUSEWAY_ORIGIN_Z - SKYLINE_STAND;
  lane = 1; playerX = 0; jumpHeight = 0; jumpVelocity = 0; sliding = 0;
  run.speed = CAUSEWAY_SPEED.base * 0.6;
  run.lookX = 0; run.lookY = 0;
  snapCamera = true;
  camera.fov = 70; camera.up.set(0, 1, 0); camera.updateProjectionMatrix();
}

/** Debug jumps to the later phases' scenes (`__dbg.story.jump(name)`). */
const storyJumps = {
  /** Phase 3: the Gravity Fault ride, story version. */
  lift() {
    story.markSeen("wake");
    startCampaign();
    ammo = 12;
    startGravityLift();
    return true;
  },
  /** Phase 4: into the Labs as the story arrives there (the breach, unless seen). */
  labs() {
    story.markSeen("wake");
    startCampaign();
    ammo = 12;
    endStoryStage();
    enterMeltdown();
    return true;
  },
  /** Phase 5: the Skyline, a few metres before the blast. */
  skyline() {
    story.markSeen("wake");
    startCampaign();
    endStoryStage();
    setFoundryActive(false);
    if (!causeway) buildCauseway("story");
    enterSkyline();
    skipLaunch();
    updateGame(0.1, clock.elapsedTime);
    runZ = CAUSEWAY_ORIGIN_Z - (SKYLINE_BLAST_AT - 6);
    snapCamera = true;
    return true;
  },
  /** Phase 5: the Roof, story version (the ladder needs the latch). */
  roof() {
    story.markSeen("wake");
    startCampaign();
    endStoryStage();
    setFoundryActive(false);
    enterRoof();
    return true;
  },
  /** Phase 6: the ending - the roof, then straight into the helicopter. */
  ending() {
    storyJumps.roof();
    const game = getMeltdown();
    const go = () => {
      if (game.phase === "roof" || game.phase === "roofArrive") game._startFinale("EXTRACTED");
      else if (game.phase === "fade" || game.phase === "idle") setTimeout(go, 100);
    };
    go();
    return true;
  },
};

/** Tear down the story's main-scene pieces (restart, quit, a level change). */
function endStoryStage() {
  story.stop();
  disposeSkylineStory();
  ward?.dispose();
  ward = null;
  foundryGuide = null;
  hideOkoro();
  cutsceneShowsPlayer = false;
}

/** A main-scene cutscene frame (the opening): the world idles, the scene drives the camera. */
function updateMainCutscene(dt, time, frame) {
  const sdt = dt * (frame?.timeScale ?? 1);
  ward?.update(dt, time);
  if (foundry && currentLevel === 2) {
    updateFoundryBox();
    foundry.update({ dt, time, distance: Math.max(0, foundryDistance()), playerPosition: foundryCentre });
  }
  // The Skyline's blast: the level runs on (the bridge coming down) under the scene's camera.
  if (currentLevel === 1 && causeway) {
    const d = Math.max(causewayDistance(), CAUSEWAY_ORIGIN_Z - camera.position.z);
    causeway.update({ dt: sdt, time, distance: d, player: playerWorld(_playerPos), playing: false });
    scene.fog.color.copy(causeway.fogColor);
    scene.fog.density = causeway.fogDensity;
    scene.background.copy(causeway.hazeColor);
    if (skylineStory) {
      level1Audio.updateBreath(skylineStory.caught ? 0 : 0.8);
      hideRampProps();
      skylineStory.tower.update(dt);
      skylineStory.sky.update(dt, time);
      skylineStory.flash = Math.max(0, skylineStory.flash - dt * 1.2);
      postfx.uniforms.uFlash.value = skylineStory.flash * 0.35;
    }
  }
  if (okoro.root.visible) okoro.update(sdt);
  avatar.position.set(playerX, playerY, runZ + .5);
  avatar.visible = cutsceneShowsPlayer;
  updatePlayerBody(sdt);
  document.body.classList.remove("aiming");
  shatterFX.update(sdt);
}

/** Sector 1 - the Shifting Foundry, in the basement. */
function enterFoundry() {
  if (currentLevel === 1 && causeway) setCausewayActive(false);
  currentLevel = 2; state = "playing"; health = 100;
  resetRunner();
  runZ = FOUNDRY_ORIGIN_Z; cameraThird = true;
  foundryPace = 0;
  if (!foundry) buildFoundry();
  foundryExit = false;
  setFoundryActive(true);
  // Outside the story's opening, you start with the bag already on.
  if (!storyRun || runKind !== "story") wearSphereBag(true);
  shatterFX.clear();
  sphereImpact.clear();
  level1Audio.startLevel();
  music.playStage("foundry");
  level1Audio.preloadStage("foundry");
  level1Audio.preloadStage("common");
  story.voice.preload(STORY_LINES.foundryTalk);
  ui.fade.style.opacity = "1";
  run.fadeOut = 1;
  // (The Foundry's own section title says where you are: no second line over it.)
  updateUI();
}

/** Endless Foundry: past the end, a new layout, a little faster each lap. */
function foundryLap() {
  endlessRun.laps += 1;
  endlessRun.distance += foundry.route.totalLength;
  foundrySpeedScale = 1 + 0.07 * endlessRun.laps;
  ui.fade.style.opacity = "1";
  run.fadeOut = 1;
  buildFoundry(endlessRun.laps);
  setFoundryActive(true);
  runZ = FOUNDRY_ORIGIN_Z; lane = 1; snapCamera = true;
  health = Math.min(100, health + 15);
  showMessage(`LAP ${endlessRun.laps + 1} // FASTER`);
  updateUI();
}

/**
 * Sector 3 - the Skyline (the Glass Causeway). The Labs' lift has carried
 * you up; you step out of the Calibration Lift at the start of the ward.
 */
function enterSkyline() {
  if (currentLevel === 3) leaveMeltdown(1);
  if (!causeway) buildCauseway("story");
  currentLevel = 1; causewayMode = "story";
  resetRun();
  // Awake and running from the first step: no sedation (that was the pod's).
  run.skipWake = true;
  run.sedation = 0; run.drowsy = 0; run.clearHinted = true; run.awakeHinted = true;
  health = 100; ammo = START_SPHERES;
  resetRunner();
  cameraThird = false;
  runZ = CAUSEWAY_ORIGIN_Z;
  setFoundryActive(false);
  setCausewayActive(true);
  causewayHud.reset();
  causewayHud.setMissions(missions.active);
  applyQuality();
  skylineLift?.setDoorsOpen(0);
  // The story's blast, sprint and latch near the end of the bridge.
  if (storyRun && runKind === "story") {
    buildSkylineStory();
    storyCheckpoint = { stage: "skyline", score, ammo, balls: storyBalls };
  } else disposeSkylineStory();
  state = "launch"; launchTimer = 0;
  music.enterElevator();
  level1Audio.startLevel();
  music.playStage("skyline");
  level1Audio.preloadStage("skyline");
  level1Audio.preloadStage("common");
  story.voice.preloadSpeakers(["halcyon", "vale"]);
  ui.fade.style.opacity = "1";
  run.fadeOut = 1;
  updateUI();
}

/** The Roof - the finale (and endless Roof). */
async function enterRoof() {
  if (meltdownEntering) return;
  meltdownEntering = true;
  if (storyRun && runKind === "story") storyCheckpoint = { stage: "roof", score, ammo, balls: storyBalls };
  const game = getMeltdown();
  game.setMode(runKind === "endless" ? "endless-roof" : "full");
  // The story's roof: the ladder jump needs the latch; the ending follows.
  game.setStory(storyRun && runKind === "story" ? {
    layer: story,
    okoroTemplate,
    valeTemplate: () => valeTemplate,
    assetBase: MELTDOWN_ASSET_BASE,
  } : null);
  onRoofStage = true;
  dressMeltdownAvatar(3);
  ui.fade.style.opacity = "1";
  run.fadeOut = 0;
  if (currentLevel === 1 && causeway) setCausewayActive(false);
  setFoundryActive(false);
  currentLevel = 3; state = "lift"; transitionTarget = 3; liftTimer = 0;
  health = 100; shake = 0;
  music.playStage("roof");
  level1Audio.preloadStage("roof");
  level1Audio.preloadStage("common");
  story.voice.preload(STORY_LINES.valeRoof);
  applyQuality();
  game.show();
  updateUI();
  try {
    await game.enterRoof({ balls: storyBalls ?? MELTDOWN_START_BALLS, vitality: 100 });
  } finally {
    meltdownEntering = false;
  }
  if (currentLevel !== 3 || state !== "lift" || meltdown !== game) return; // quit while loading
  state = "playing";
  run.fadeOut = 1;
  updateUI();
}

/** Endless: one environment, until you go down. */
function startEndless(env) {
  storyRun = false;
  runClock = 0;
  runFromStart = false;
  runRecordable = true;
  resetStats(env === "skyline" ? "endless" : "story");
  missions.active = [];
  runKind = "endless"; endlessEnv = env; storyBalls = null;
  endlessRun.laps = 0; endlessRun.distance = 0; foundrySpeedScale = 1;
  ui.start.classList.remove("active");
  ui.endless.classList.remove("active");
  if (env === "skyline") {
    state = "playing";
    level1Audio.startLevel();
    music.playStage("skyline");
    level1Audio.preloadStage("skyline");
    level1Audio.preloadStage("common");
    causewayHud.show();
    causewayHud.title("Endless // The Skyline", "Randomised. Faster every 250 m.", 2.2);
    return;
  }
  setCausewayActive(false);
  if (env === "foundry") enterFoundry();
  else if (env === "labs") enterMeltdown();
  else if (env === "roof") enterRoof();
}

/**
 * "Run again" / R: after a death in the story, the sector you died in, from
 * its beginning and with its cutscenes; otherwise the same kind of run from
 * the top ("Restart run" on the pause menu always starts the run over).
 */
function restartRun({ fromTop = false } = {}) {
  leaveGravityLift();
  if (runKind === "endless" && endlessEnv) startEndless(endlessEnv);
  else if (!fromTop && storyDeath && storyCheckpoint) restartStage(storyCheckpoint);
  else startCampaign();
}

/** The end screen's main button: the sector again after a story death, else the run. */
function restartButtonLabel() {
  const names = { foundry: "SECTOR 01", labs: "SECTOR 02", skyline: "SECTOR 03", roof: "THE ROOF" };
  $("#restartButton").textContent = storyDeath ? `RETRY ${names[storyCheckpoint.stage]}` : "RUN AGAIN";
}

/** The scenes each sector plays, which a restart of that sector plays again. */
const STAGE_SCENES = {
  foundry: ["wake", "walkOut", "foundryTalk"],
  labs: ["breach", "bendAttack", "hide", "grief"],
  skyline: ["blast"],
  roof: ["ladderLatch", "ending"],
};

/** Back to the start of a story sector, as it was when you first reached it. */
function restartStage(cp) {
  const checkpoint = { ...cp };
  for (const id of STAGE_SCENES[checkpoint.stage] ?? []) story.seen.delete(id);
  storyDeath = false;
  ui.end.classList.remove("active");
  if (checkpoint.stage === "foundry") { startCampaign(); return; }
  storyRun = true;
  resetStats("story");
  runKind = "story"; endlessEnv = null;
  score = checkpoint.score;
  ammo = checkpoint.ammo;
  storyBalls = checkpoint.balls;
  if (checkpoint.stage === "labs") {
    setCausewayActive(false);
    enterMeltdown();
  } else if (checkpoint.stage === "skyline") {
    setFoundryActive(false);
    enterSkyline();
  } else if (checkpoint.stage === "roof") {
    setFoundryActive(false);
    enterRoof();
  }
  updateUI();
}

/* ---- Endless records ------------------------------------------------------ */

const ENDLESS_NAMES = { foundry: "The Foundry", labs: "The Labs", skyline: "The Skyline", roof: "The Roof" };
function loadEndlessBest() {
  try {
    return JSON.parse(localStorage.getItem("fractureRunEndlessBest")) ?? {};
  } catch (error) {
    return {};
  }
}
const endlessBest = loadEndlessBest();
function recordEndless(env, value) {
  endlessBest[env] = Math.max(endlessBest[env] ?? 0, value);
  try { localStorage.setItem("fractureRunEndlessBest", JSON.stringify(endlessBest)); } catch (error) {}
  return endlessBest[env];
}
function endlessUnit(env) { return env === "roof" ? "s" : "m"; }

/* ---- Run times (records in hours, minutes and seconds) ------------------- */

/** 3725 -> "1:02:05". */
function hms(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function loadRunTimes() {
  try {
    const saved = JSON.parse(localStorage.getItem("fractureRunTimes"));
    return { story: saved?.story ?? 0, endless: saved?.endless ?? {} };
  } catch (error) {
    return { story: 0, endless: {} };
  }
}
/** The fastest whole story run, and the longest run in each Endless level (seconds). */
const runTimes = loadRunTimes();
function saveRunTimes() {
  try { localStorage.setItem("fractureRunTimes", JSON.stringify(runTimes)); } catch (error) {}
}
/** A finished story run: is it the fastest? Returns the record. */
function recordStoryTime(seconds) {
  if (!runRecordable || !runFromStart) return runTimes.story;
  if (!runTimes.story || seconds < runTimes.story) { runTimes.story = seconds; saveRunTimes(); }
  return runTimes.story;
}
/**
 * An Endless run's record: distance and the time it took, as one pair - the
 * best run's own time, never a time from some other run. (The Roof's record
 * is its time.) Returns { distance, time } of the record.
 */
function recordEndlessRun(env, distance, seconds) {
  if (runRecordable) {
    const before = endlessBest[env] ?? 0;
    const value = env === "roof" ? seconds : distance;
    if (value > before || (value === before && !runTimes.endless[env])) {
      recordEndless(env, value);
      runTimes.endless[env] = seconds;
      saveRunTimes();
    }
  }
  return { distance: endlessBest[env] ?? 0, time: runTimes.endless[env] ?? (env === "roof" ? endlessBest.roof ?? 0 : 0) };
}

/** How far this endless run got, for the end screen and the records. */
function endlessResult() {
  const env = endlessEnv;
  let value = 0;
  if (env === "foundry") value = Math.floor(endlessRun.distance + (foundry ? foundryDistance() : 0));
  else if (env === "labs") value = Math.floor(meltdown?.stats.endlessDistance ?? 0);
  else if (env === "roof") value = Math.floor(meltdown?.stats.roofTime ?? 0);
  else if (env === "skyline") value = Math.floor(causeway ? causewayDistance() : 0);
  const seconds = env === "roof" ? value : runClock;
  const best = recordEndlessRun(env, value, seconds);
  return {
    eyebrow: `ENDLESS // ${ENDLESS_NAMES[env].toUpperCase()}`,
    title: env === "roof" ? `SURVIVED ${hms(value)}` : `${value} M IN ${hms(seconds)}`,
    text: (env === "roof"
      ? `Best in ${ENDLESS_NAMES[env]}: ${hms(best.time)}.`
      : `Best in ${ENDLESS_NAMES[env]}: ${best.distance} m in ${hms(best.time)}.`) +
      (env === "foundry" || env === "labs" ? " Every lap is a new layout, and faster." : env === "roof" ? " The waves never stop coming." : ""),
  };
}

/** The Endless record for a level: "1240 m · 0:04:12", or the Roof's "0:04:12". */
function endlessRecordText(env) {
  const time = runTimes.endless[env] ?? (env === "roof" ? endlessBest.roof ?? 0 : 0);
  const distance = endlessBest[env] ?? 0;
  if (env === "roof") return time ? hms(time) : "";
  if (!distance) return "";
  // The best run's distance and its own time ("in"), not two separate bests.
  return time ? `${distance} m in ${hms(time)}` : `${distance} m`;
}

function refreshEndlessMenu() {
  for (const button of document.querySelectorAll("[data-endless]")) {
    const env = button.dataset.endless;
    const best = endlessRecordText(env);
    button.querySelector("small").textContent = best ? `Best ${best}` : "No record yet";
  }
}


function triggerShake(amount) { shake = Math.max(shake, amount * (settings.reducedMotion ? 0.25 : 1)); }

const shatterAt = new THREE.Vector3();

function shatter(target, hit = {}) {
  if (!target.userData.alive) return null;
  if (target.userData.causeway) return causeway ? shatterCauseway(target, hit) : null;

  // Foundry targets must go through the level, because breaking a switch is
  // what opens a gate or restores a system - hiding the mesh here would break
  // the glass and leave the route shut.
  const isFoundry = target.userData.kind === "switch" || target.userData.kind === "cell";
  let gainedSpheres = 0;
  let result = { kind: target.userData.kind };

  if (isFoundry) {
    const foundryResult = foundry?.breakTarget(target);
    if (!foundryResult) return null;
    result = foundryResult;
    score += foundryResult.points * combo;
    gainedSpheres = foundryResult.spheres ?? 0;
    shatterAt.copy(foundryResult.position);
    combo = Math.min(9, combo + 1);
    comboTimer = 2.6;
    if (foundryResult.kind === "switch") showMessage(`${foundryResult.label} // ONLINE`);
    else if (foundryResult.serum) { activateSerum(foundryResult.serum); level1Audio.serumCollected(); }
    else if (gainedSpheres) showMessage(`+${gainedSpheres} SPHERES`);
  } else {
    target.userData.alive = false; target.visible = false;
    score += target.userData.points;
    shatterAt.copy(target.position);
    if (target.userData.kind === "crystal") gainedSpheres = 3;
    showMessage(gainedSpheres ? "+3 SPHERES" : "GLASS FRACTURED");
  }

  if (gainedSpheres) ammo += gainedSpheres;

  // Level 1's glass: GPU shards that tumble, bounce once on the floor and
  // settle, with its break and pickup sounds.
  const crystal = target.userData.kind === "crystal";
  const cell = target.userData.kind === "cell";
  const push = hit.direction ? hit.direction.clone().normalize().multiplyScalar(cell ? 3 : 2) : null;
  shatterFX.chunks(shatterAt, cell ? 34 : 22, {
    tint: result.serum ? SERUMS[result.serum].colour : isFoundry ? 0x9ff4f0 : crystal ? 0xffb04a : 0xffb26b,
    speed: cell ? 4.6 : 3.6, radius: cell ? 0.7 : 0.4, size: cell ? 0.14 : 0.1, push,
  });
  level1Audio.glassBreak();
  level1Audio.addGlassDebris(shatterAt, cell ? 2.2 : 1.6);
  if (gainedSpheres) level1Audio.sphereCollected();
  updateUI();
  return result;
}

/** The death screen's name for each level (`currentLevel`), as the story calls it. */
const sectorNames = { 1: "SKYLINE", 2: "SHIFTING FOUNDRY", 3: "LABS" };
const failReasons = {
  fell: "The skybridge gave way beneath you. Sprint with W when the collapse closes in.",
  crushed: "The atrium came down before the gate opened. Break locks I, II, III in order.",
  fire: "The fire took the last of your integrity. Open sprinklers or throw cryo spheres.",
  smoke: "The smoke was too thick. Break vent covers to clear the air.",
};

/**
 * @param {boolean} won
 * @param {string} [reason]  key into failReasons
 * @param {object} [detail]  overrides from the level: { eyebrow, title, text, stats }
 */
function endRun(won, reason = null, detail = null) {
  if (state === "ended") return;
  state = "ended"; ui.final.textContent = String(Math.floor(score)).padStart(6, "0");
  // A failed run stops the lift itself; its interior music follows the
  // existing game-over duck without leaving machinery grinding forever.
  level1Audio.updateElevator(0, false);
  // A death in the story: the end screen offers that sector again.
  storyDeath = !won && storyRun && runKind === "story" && !!storyCheckpoint;
  restartButtonLabel();
  if (currentLevel === 1) music.gameOverDuck();
  level1Audio.updateBreath(0);
  // Level 3 plays it itself (the MeltdownGame shares level1Audio).
  if (!won && currentLevel !== 3) level1Audio.gameOver();
  causewayHud.warning(null);
  if (runKind === "endless" && endlessEnv && !detail && endlessEnv !== "skyline") detail = endlessResult();
  ui.endEyebrow.textContent = won ? "RUN COMPLETE" : `RUN TERMINATED // SECTOR 0${sectorNumber()}`;
  ui.endTitle.textContent = won ? "YOU GOT OUT" : `THE ${sectorNames[currentLevel]} CLAIMED YOU`;
  ui.endText.textContent = won
    ? "The Foundry, the Labs, the Skyline, the roof. Ascension Tower came down behind you."
    : failReasons[reason] ?? `Integrity failed in the ${sectorNames[currentLevel].toLowerCase()}. Shift lanes earlier and preserve your spheres.`;
  ui.endStats.textContent = "";
  if (detail) {
    if (detail.eyebrow) ui.endEyebrow.textContent = detail.eyebrow;
    if (detail.title) ui.endTitle.textContent = detail.title;
    if (detail.text) ui.endText.textContent = detail.text;
    if (detail.stats) ui.endStats.textContent = detail.stats;
  }
  if (currentLevel === 1 && causeway) {
    const distance = Math.max(0, Math.floor(causewayDistance()));
    const s = missionStats();
    const accuracy = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
    if (causewayMode === "endless") {
      if (runKind === "endless") recordEndlessRun("skyline", distance, runClock);
      ui.endTitle.textContent = `SIGNAL LOST AT ${distance} M`;
      ui.endText.textContent = `Best endless distance: ${Math.max(distance, missions.progress.bestDistance ?? 0)} m. The lab rebuilds itself differently every run.`;
    }
    ui.endStats.textContent = `${distance} m run   ${accuracy}% accuracy   ${s.panes} glass   ${s.extinguished} fires out   ${s.files.length} case files`;
    missions.commit({ mode: causewayMode, score: Math.floor(score), distance, files: s.files });
    refreshMenuProgress();
  }
  ui.end.classList.add("active");
}

/**
 * Demo keys 1-4 jump to a stage of the story, with its cutscenes:
 * 1 Foundry, 2 Labs, 3 Skyline (from its start; the blast is at 500 m),
 * 4 Roof (and the ending after it). (Endless is on the menu.)
 */
function demoStoryJump(stage) {
  if (state !== "playing") return;
  music.fadeOut();
  showMessage(`DEMO JUMP // ${["", "SECTOR 01", "SECTOR 02", "SECTOR 03", "THE ROOF"][stage]}`);
  if (stage === 1) { story.markSeen("wake"); startCampaign(); }
  else if (stage === 2) storyJumps.labs();
  else if (stage === 3) {
    story.markSeen("wake");
    startCampaign();
    endStoryStage();
    setFoundryActive(false);
    if (!causeway) buildCauseway("story");
    enterSkyline();
  } else if (stage === 4) storyJumps.roof();
  markDemo();
}

/**
 * The checks' jump to a stage without the story (no cutscenes, no Okoro):
 * 1 Foundry, 2 Labs, 3 Skyline, 4 Roof.
 */
function demoJump(stage) {
  if (state !== "playing") return;
  music.fadeOut();
  leaveGravityLift();
  // Demo jumps are dev shortcuts: no cutscenes, no Okoro (__dbg.story.jump for those).
  endStoryStage();
  storyRun = false;
  // Level 3 built ahead for the Labs is only for the Labs.
  if (stage !== 2) meltdownPrepared = null;
  runKind = "story"; endlessEnv = null;
  if (currentLevel === 1 && causeway) { setCausewayActive(false); level1Audio.cleanupLevel(); }
  if (currentLevel === 3) leaveMeltdown(stage === 2 ? 3 : 2);
  showMessage(`DEMO JUMP // ${["", "SECTOR 01", "SECTOR 02", "SECTOR 03", "THE ROOF"][stage]}`);
  if (stage === 1) { setFoundryActive(false); if (foundry) buildFoundry(); enterFoundry(); }
  else if (stage === 2) { setFoundryActive(false); enterMeltdown(); }
  else if (stage === 3) { setFoundryActive(false); if (!causeway) buildCauseway("story"); enterSkyline(); }
  else if (stage === 4) { setFoundryActive(false); enterRoof(); }
  markDemo();
}


/**
 * The Skyline begins in the Calibration Lift the Labs' lift carried you up
 * in: the doors open onto the ward and you step out (first person), then the
 * run begins. Any key or click skips to the end.
 */
function updateLaunch(dt, time) {
  launchTimer += dt;
  causeway.update({ dt, time, distance: 0, player: playerWorld(_playerPos), playing: false });
  scene.fog.color.copy(causeway.fogColor);
  scene.fog.density = causeway.fogDensity;
  const t = launchTimer;
  skylineLift?.update(dt, time);
  skylineLift?.setDoorsOpen((t - 0.5) / 0.8);
  // From the middle of the cabin to the start line, speeding up.
  const u = THREE.MathUtils.clamp((t - 1.3) / 0.9, 0, 1);
  const cabinZ = skylineLift ? skylineLift.root.position.z : CAUSEWAY_ORIGIN_Z + 6;
  const z = THREE.MathUtils.lerp(cabinZ, CAUSEWAY_ORIGIN_Z + 0.15, u * u);
  camera.position.set(0, 1.72 + Math.sin(t * 9) * 0.015 * u, z);
  if (skylineLift?.containsPoint(camera.position)) music.enterElevator();
  else music.exitElevator();
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 1.6, z - 12);
  avatar.visible = false;
  if (t >= 2.2) {
    state = "playing"; snapCamera = true;
    skylineLift?.setDoorsOpen(1);
    causewayHud.show();
    causewayHud.title("Sector 03 of 03", "The Glass Causeway", 2.4);
  }
}

function skipLaunch() {
  launchTimer = Math.max(launchTimer, 2.15);
}

function clearPostLooks() {
  const u = postfx.uniforms;
  for (const key of ["uSmoke", "uDamage", "uHeat", "uThermal", "uOverdrive", "uPrism", "uFocus", "uSpeed", "uFlash", "uLens", "uPulse", "uSedation"]) u[key].value = 0;
  for (const slot of u.uHaze.value) slot.w = 0;
}

function updateGame(dt, time) {
  if ((state === "playing" || state === "lift") && !paused) runClock += dt;
  // Someone is talking: the music and the beds step back so the words carry.
  const speaking = story.voice.speaking;
  music.voiceDuck(speaking);
  level1Audio.duckForVoice(speaking);
  const inCauseway = currentLevel === 1 && causeway && causeway.root.visible;
  document.body.classList.toggle("pregame", state === "intro" || state === "launch");
  document.body.classList.toggle("paused", paused);
  document.body.classList.toggle("riding-lift", state === "lift");
  document.body.classList.toggle("cw-active", !!inCauseway && (state === "playing" || state === "lift" || state === "ended"));
  // The foundry HUD is its own overlay, so it has to follow the game's menu
  // states too - otherwise it shows through the briefing and pause screens.
  if (foundry) {
    foundryHud.root.hidden = !(
      currentLevel === 2 && (state === "playing" || state === "lift") && !paused && !storyPlaying
    );
  }
  // One HUD for every level (the Skyline's): in the Foundry and the Labs and
  // on the Roof too, with their own level-specific widgets alongside.
  const unified = (currentLevel === 2 || (currentLevel === 3 && !!meltdown?.visible)) && (state === "playing" || state === "lift") && !gravityLift;
  document.body.classList.toggle("hud-unified", unified);
  const hudWanted = (inCauseway || unified) && state === "playing" && !paused && !photoActive;
  if (hudWanted) causewayHud.show(); else causewayHud.hide();
  causewayHud.update(dt);

  avatar.position.set(playerX, playerY + jumpHeight, runZ + .5);
  avatar.visible = cameraThird || state === "lift" || state === "launch" || photoActive;
  // Blink through the mercy window after an impact.
  if ((foundryInvulnerable > 0 || run.invulnerable > 0) && Math.floor(time * 14) % 2 === 0 && !photoActive) avatar.visible = false;
  body.scale.y = sliding > 0 ? 0.55 : 1;
  body.rotation.z = Math.sin(time * 9) * .035;
  updatePlayerBody(paused ? 0 : dt);
  for (const crystal of breakables) if (crystal.userData.kind === "crystal" && crystal.userData.alive) crystal.rotation.y += dt * 1.8;
  if (run.fadeOut > 0) { run.fadeOut = Math.max(0, run.fadeOut - dt * 1.4); ui.fade.style.opacity = run.fadeOut.toFixed(3); }
  if (!inCauseway) clearPostLooks();
  updatePolice(inCauseway ? dt : 0, time, inCauseway);
  placeSkyLauncher(paused ? 0 : dt);
  // Level 1 is a night scene lit by fire; Levels 2 and 3 keep their tuning.
  renderer.toneMappingExposure = inCauseway ? 1.0 : 1.08;

  if (photoActive) { photo.update(camera); return; }
  // The briefing film has the screen while it plays.
  if (prologue?.active) { prologue.update(dt, time); return; }
  if (state === "intro") {
    if (causeway) {
      const d = causeway.menuCamera(time, camera, settings.reducedMotion);
      causeway.update({ dt, time, distance: d, playing: false });
      scene.fog.color.copy(causeway.fogColor);
      scene.fog.density = causeway.fogDensity;
    }
    return;
  }

  if (state === "launch") { updateLaunch(dt, time); return; }
  if (paused) return;
  // The story layer: cutscenes, reactions, and Okoro's talk during play.
  const storyFrame = story.update(dt);
  if (state === "cutscene") { updateMainCutscene(dt, time, storyFrame); return; }

  // Time dilation - the Skyline's, in every level: focus (bullet time, RMB)
  // and hit-stop on big breaks. The tools (serums) tick on the same clock.
  let simDt = dt;
  const dilating = state === "playing" && !gravityLift && (inCauseway || currentLevel === 2 || (currentLevel === 3 && meltdown?.acceptsFocus));
  if (dilating) {
    const focusing = run.focusing && run.focus > 0.02;
    if (focusing) run.focus = Math.max(0, run.focus - dt * 0.38);
    else run.focus = Math.min(1, run.focus + dt * (inCauseway ? 0 : 0.09));
    let targetScale = focusing ? 0.38 : 1;
    if (run.hitStop > 0) { run.hitStop -= dt; targetScale = 0.2; }
    run.timeScale += (targetScale - run.timeScale) * Math.min(1, dt * 12);
    simDt = dt * run.timeScale;
    if (!inCauseway) arsenal.update(simDt);
  } else run.timeScale = 1;
  simTime += simDt;

  // Level 3 runs its own world, camera and HUD (src/levels/meltdown/game.js).
  // Messages clear on their own in every level (the Labs returns early below).
  if (messageTimer > 0) { messageTimer -= dt; if (messageTimer <= 0) ui.message.classList.remove("show"); }
  if (currentLevel === 3) { updateMeltdownFrame(simDt, time); updateUnifiedHud(dt); return; }
  // So does the lift ride between Levels 2 and 3 (src/elevators/).
  if (gravityLift) { updateGravityLiftFrame(dt, time); return; }

  updateSmoke(dt, time);

  if (state === "playing") {
    // Lane changes are sluggish while Subject 07 is still sedated.
    const laneRate = currentLevel === 1 ? 9 - run.drowsy * 4 : 9;
    playerX += (lanes[lane] - playerX) * Math.min(1, simDt * laneRate);

    // Jump arc and slide timer.
    jumpVelocity -= 19 * simDt;
    jumpHeight = Math.max(0, jumpHeight + jumpVelocity * simDt);
    if (jumpHeight <= 0) jumpVelocity = 0;
    jumpBuffer = Math.max(0, jumpBuffer - simDt);
    if (jumpBuffer > 0 && jumpHeight <= 0.01) { jumpVelocity = 7.4; jumpBuffer = 0; }
    // A slide pressed in the air starts when you land.
    if (jumpHeight <= 0.05 || jumpVelocity > -1) sliding = Math.max(0, sliding - simDt);

    // Combo decays on its own; a miss or an impact resets it elsewhere.
    if (comboTimer > 0) { comboTimer = Math.max(0, comboTimer - simDt); if (comboTimer === 0) combo = 1; }

    if (currentLevel === 1 && causeway) {
      updateCauseway(simDt, simTime);
    } else if (currentLevel === 2) {
      // Speed eases between zones and after a hit (a runner can't change
      // pace instantly): quick to slow on impact, slower to build back up.
      const targetPace = foundrySpeed() * (foundrySlow > 0 ? 0.45 : 1);
      foundryPace += (targetPace - foundryPace) * Math.min(1, simDt * (targetPace < foundryPace ? 9 : 2.6));
      // Overdrive (a serum) runs you faster, as in the Skyline.
      runZ -= simDt * foundryPace * (arsenal.isActive("overdrive") ? 1.25 : 1);
      // Level 2 runs its own collision - the foundry's hazards are nested
      // inside groups.
      updateFoundry(simDt, simTime);
      updateUnifiedHud(dt);

      // Level 2 exits on the foundry's own `complete` event - breaking the
      // extraction valve - rather than on a hard-coded z. If the player somehow
      // runs past the end, fall through to the lift anyway. Either way they
      // run on, centre lane, into the Calibration Lift.
      if (runKind === "endless") {
        // Endless: no lift - at the end of the foundry, a new layout, faster.
        if (foundry && foundryDistance() > foundry.route.totalLength - 4) foundryLap();
      } else if (foundry && (foundryExit || foundryDistance() > foundry.route.totalLength - 4)) {
        foundryExit = true;
        lane = 1;
        if (foundryLift && foundryLift.containsPoint(foundryCentre)) {
          runZ = foundryLift.root.position.z;
          startFoundryLift();
        } else if (!foundryLift) {
          state = "lift"; liftTimer = 0; transitionTarget = 3;
        }
      }
    }
  } else if (state === "lift" && transitionTarget === 2 && causeway) {
    causeway.update({ dt, time: simTime, distance: causewayDistance(), player: playerWorld(_playerPos), playing: false });
    updateCausewayLift(dt);
  } else if (state === "lift" && transitionTarget === 3 && foundryLift?.state.riding) {
    // Level 2 -> 3: board the Calibration Lift in the Foundry; once it is
    // climbing, fade into the Gravity Fault ride (GRAVITY LIFT below), which
    // carries on up the tower and hands over to Level 3.
    const ride = foundryLift.update(dt, time, settings.reducedMotion);
    level1Audio.updateElevator(ride.velocity, !ride.done);
    foundryLift.cameraPose(ride.t, run.liftFrom, camera.position, _look, settings.reducedMotion);
    camera.up.set(0, 1, 0);
    camera.lookAt(_look);
    foundryLift.floorPoint(avatar.position);
    avatar.visible = true;
    if (currentLevel === 2 && foundry) updateFoundry(dt, simTime);
    // Okoro rides up with you.
    updateFoundryGuide(dt);
    const handoff = THREE.MathUtils.clamp((ride.t - FOUNDRY_LIFT_HANDOFF) / 0.5, 0, 1);
    ui.fade.style.opacity = Math.max(ride.fade, handoff).toFixed(3);
    if (handoff >= 1 || ride.done) { level1Audio.updateElevator(0, false); startGravityLift({ boarded: true }); }
  } else if (state === "lift" && transitionTarget === 3) {
    // No Calibration Lift to board (e.g. it failed to build): fade straight
    // into the Gravity Fault ride.
    liftTimer += dt;
    ui.fade.style.opacity = Math.min(1, liftTimer / 0.6).toFixed(3);
    if (liftTimer > 0.7) startGravityLift();
  } else if (state === "ended" && inCauseway) {
    // Keep the world alive behind the end screen.
    causeway.update({ dt, time: simTime, distance: causewayDistance(), player: playerWorld(_playerPos), playing: false });
  }

  // The lift can hand over to Level 2 (and dispose Level 1) during this frame.
  const causewayLive = currentLevel === 1 && !!causeway && causeway.root.visible;

  // ---- Cameras ---------------------------------------------------------
  if (causewayLive && state !== "lift") {
    causewayCamera(dt, time);
  } else if (!(state === "lift" && transitionTarget === 2 && causewayLive) && !(state === "lift" && transitionTarget === 3 && foundryLift?.state.riding)) {
    const forward = new THREE.Vector3(0, 1.25, runZ - 12);
    const desired = cameraThird ? new THREE.Vector3(playerX, 4.2, runZ + 8.5) : new THREE.Vector3(playerX, 1.8, runZ + .7);
    camera.up.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 4));
    if (snapCamera) { camera.position.copy(desired); snapCamera = false; }
    else camera.position.lerp(desired, 1 - Math.exp(-dt * 7));
    camera.lookAt(forward);
    if (shake > .001) { camera.position.x += (Math.random() - .5) * shake; camera.position.y += (Math.random() - .5) * shake; shake = Math.max(0, shake - dt * 2.4); }
    // Overdrive widens the view, as in the Skyline: you see yourself go faster.
    if (currentLevel === 2) {
      const fov = 68 + arsenal.level("overdrive") * (settings.reducedMotion ? 3 : 9);
      if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
    }
  }

  // ---- Aim feedback, projectiles, debris -------------------------------
  const aliveBreakables = aliveTargets();
  trackTargetMotion(aliveBreakables, simDt);
  const aim = resolveAim(aliveBreakables);
  ui.reticle.classList.toggle("hot", !!aim.target);
  ui.reticle.classList.toggle("assist", !!aim.target && aim.assisted);
  if (causewayLive) causeway.setHighlight(aim.target);

  updatePendingThrows(simDt);
  updateProjectiles(simDt);

  shatterFX.update(simDt);
  sphereImpact.update(simDt);

  if (causewayLive && (state === "playing" || state === "lift")) updateCausewayPresentation(dt);
}

/* ---- Rendering and performance ---------------------------------------- */

const perf = { ema: 16, slowFor: 0, fastFor: 0, frames: 0, acc: 0, fps: 60, level: 0, settle: 0, seen: "" };

function updatePerformance(rawDt) {
  const ms = rawDt * 1000;
  perf.ema = perf.ema * 0.94 + ms * 0.06;
  perf.frames += 1;
  perf.acc += rawDt;
  if (perf.acc >= 0.5) { perf.fps = Math.round(perf.frames / perf.acc); perf.frames = 0; perf.acc = 0; }

  // Dynamic resolution, then an automatic drop to low quality if needed.
  // A level's first seconds are always slow (shaders compiling, textures
  // uploading): judge the machine only once it has settled.
  const where = `${state}:${currentLevel}`;
  if (where !== perf.seen) { perf.seen = where; perf.settle = 0; perf.slowFor = 0; }
  perf.settle += rawDt;
  if (settings.quality === "auto" && state === "playing" && currentLevel !== 3 && !paused && document.visibilityState === "visible" && perf.settle > 6) {
    perf.slowFor = perf.ema > 21 ? perf.slowFor + rawDt : 0;
    perf.fastFor = perf.ema < 14 ? perf.fastFor + rawDt : 0;
    // Degrade in order of how little it shows: first work nobody sees (the
    // reflection probe updates less often, the refraction snapshot and bloom
    // buffer shrink), then resolution - but never below 85%, and a sharpening
    // pass keeps that crisp. Only a machine far below 30 fps drops to Low.
    if (perf.slowFor > 1.2 && postfx.enabled) {
      perf.slowFor = 0;
      if (perf.level === 0) { perf.level = 1; if (causeway) causeway.probe.interval = 2; }
      else if (perf.level === 1) { perf.level = 2; postfx.setLite(true); }
      else if (postfx.scale > 0.86) postfx.setScale(postfx.scale - 0.075);
      // Said in the settings, not across the middle of a run.
      else if (!autoLow && perf.ema > 34) { autoLow = true; applyQuality(); ui.qualityNote.textContent = "Auto lowered detail to keep the frame rate up."; }
    }
    if (perf.fastFor > 4 && postfx.enabled) {
      perf.fastFor = 0;
      if (postfx.scale < 1) postfx.setScale(postfx.scale + 0.05);
      else if (perf.level === 2) { perf.level = 1; postfx.setLite(false); }
      else if (perf.level === 1) { perf.level = 0; if (causeway) causeway.probe.interval = causeway.quality === "low" ? 3 : 1; }
    }
  }
}

function renderFrame() {
  if (prologue?.active) { prologue.render(); return; }
  if (gravityLift?.visible) { gravityLift.render(); return; }
  if (currentLevel === 3 && meltdown?.visible) { meltdown.render(); return; }
  const glass = causeway && causeway.root.visible ? causeway.glassShared : null;
  postfx.render(scene, camera, glass);
  if (glass && settings.hud.minimap && causewayHud.visible && !photoActive && state === "playing") {
    const chase = causeway.state.chase;
    minimap.render(scene, playerWorld(_playerPos), chase.active ? causeway.worldZ(chase.front) : null);
  }
  if (glass) causeway.renderProbe(renderer, scene);
}

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = Math.min(.033, rawDt);
  renderer.info.reset();
  // Checks that step the game themselves (__dbg.manual) stop the real clock.
  if (!manualStep) updateGame(dt, clock.elapsedTime);
  updateCursor();
  renderFrame();
  updatePerformance(rawDt);
}

/**
 * The mouse pointer becomes the crosshair only while you are actually aiming:
 * playing (or the first lift's clamps), with nothing over the game. Anywhere
 * else - menus, the briefing, cutscenes, the serum card, pause, photo mode -
 * the ordinary pointer stays visible. One rule, decided once per frame, so
 * leaving a level by any path can never leave it hidden.
 */
function updateCursor() {
  const overlay = !!document.querySelector(".screen.active") || powerups.open || !!prologue?.active ||
    story.player.active || paused || photoActive || storyPlaying;
  const aimingNow = !overlay && (state === "playing" || (state === "lift" && !!gravityLift?.wantsAim));
  document.body.classList.toggle("aiming", aimingNow);
}

/* ---- Menus -------------------------------------------------------------- */

function openSettings(from) {
  settingsFrom = from;
  ui.settingsBackButton.textContent = from === "pause" ? "BACK TO PAUSE" : "BACK";
  if (from === "intro") ui.start.classList.remove("active");
  if (from === "pause") ui.pause.classList.remove("active");
  ui.settings.classList.add("active");
}

function closeSettings() {
  ui.settings.classList.remove("active");
  if (settingsFrom === "intro") ui.start.classList.add("active");
  if (settingsFrom === "pause") ui.pause.classList.add("active");
  settingsFrom = null;
}

/**
 * Chapters (the main menu): start the story from any part of it, as the
 * story reaches it - its cutscenes play again.
 */
function startChapter(name) {
  ui.chapters.classList.remove("active");
  if (name === "briefing") { startStory(); return; }
  story.forgetSeen();
  if (name === "foundry") { startCampaign(); return; }
  if (name === "skyline") {
    // From the start of the Skyline (the Calibration Lift's doors), not the blast.
    story.markSeen("wake");
    startCampaign();
    runFromStart = false;
    endStoryStage();
    setFoundryActive(false);
    if (!causeway) buildCauseway("story");
    enterSkyline();
    return;
  }
  storyJumps[name]?.();
  // Begun part-way through: a good run, but not a whole one to time.
  runFromStart = false;
}

/** Where the pause menu's moves are for. */
function movesHere() {
  if (currentLevel === 2) return "foundry";
  if (currentLevel === 3) return meltdown?.phase?.startsWith("roof") ? "roof" : "labs";
  if (currentLevel === 1 && causeway) return "skyline";
  return null;
}

function openPause() {
  if (state !== "playing" && state !== "lift" && state !== "cutscene") return;
  showMoves(movesHere());
  ballPickers.show(arsenal.ball);
  paused = true;  run.focusing = false;
  story.setPaused(true);
  music.pauseDuck();
  level1Audio.setPaused(true);
  foundryAmbience.setPaused(true);
  if (currentLevel === 3) meltdown?.setPaused(true);
  ui.pauseLevel.textContent = sectorLabel();
  ui.pauseScore.textContent = String(Math.floor(score)).padStart(6, "0");
  ui.pauseAmmo.textContent = ammo;
  ui.pauseHealth.textContent = Math.max(0, Math.round(health));
  ui.pauseMissions.innerHTML = currentLevel === 1 && missions.active.length
    ? missions.active.map((m) => `<li class="${m.done ? "done" : ""}">${m.def.text}${m.def.goal > 1 ? ` <b>${m.value}/${m.def.goal}</b>` : ""}</li>`).join("")
    : "";
  ui.pause.classList.add("active");
}

/** The first pickup of a serum: pause, and explain it. */
function openPowerupIntro(type) {
  if (state !== "playing" || paused || !SERUMS[type]) return;
  paused = true; run.focusing = false;
  story.setPaused(true);
  music.pauseDuck();
  level1Audio.setPaused(true);
  if (currentLevel === 3) meltdown?.setPaused(true);
  powerups.intro(SERUMS[type]);
}

function closePowerupIntro() {
  if (!powerups.open) return;
  closePause();
  if (pendingBurst) powerups.burst(pendingBurst);
  pendingBurst = null;
}

function closePause() {
  powerups.closeIntro();
  const wasPaused = paused;
  ui.pause.classList.remove("active");
  paused = false;
  story.setPaused(false);
  if (wasPaused) music.restore();
  if (wasPaused) level1Audio.setPaused(false);
  if (wasPaused) foundryAmbience.setPaused(false);
  if (currentLevel === 3) meltdown?.setPaused(false);
}

function togglePhoto() {
  if (photoActive) {
    photoActive = false;
    photo.exit(camera);
    document.body.classList.remove("photo-hide-hud");
    return;
  }
  if (state !== "playing" && state !== "lift") return;
  if (paused || currentLevel === 3) return;
  photoActive = true;
  run.focusing = false;
  photo.enter(camera, avatar.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
  document.body.classList.add("photo-hide-hud");
}

function quitToMenu() {
  // Leaving an Endless run part-way still sets the records it earned.
  if (runKind === "endless" && endlessEnv && (state === "playing" || state === "lift")) {
    if (endlessEnv === "skyline") recordEndlessRun("skyline", causeway ? Math.max(0, Math.floor(causewayDistance())) : 0, runClock);
    else endlessResult();
  }
  closePause(); cancelStory();
  leaveGravityLift();
  document.body.classList.remove("finale-film");
  storyRun = false;
  // Nobody keeps talking over the menu (the intercom, a line mid-sentence).
  story.voice.stop();
  level1Audio.cleanupLevel();
  if (photoActive) togglePhoto();
  ui.caption.classList.remove("show"); ui.launchControls.classList.remove("show");
  ui.settings.classList.remove("active"); ui.end.classList.remove("active"); ui.manual.classList.remove("active");
  resetStats("story"); state = "intro"; settingsFrom = null;
  refreshMenuProgress();
  ui.story.classList.remove("active");
  ui.start.classList.add("active");
  music.showMenu();
}

/*
 * The briefing: the prologue film (src/story/prologue.js) - what Project
 * Ascension was, why the patients were taken, who ran it, how it was found
 * out, and why the tower is coming down tonight. Staged in the engine, told
 * in captions (no voice), over the story track. Esc, Space or SKIP ends it.
 */
let storyPlaying = false;
let prologue = null;

function cancelStory() {
  storyPlaying = false;
  // Whatever the story layer last showed (the end credits, a held black
  // fade, a title) goes with it: the menu and the briefing start clean.
  story.stop();
  document.body.classList.remove("finale-film", "story-cutscene");
}

async function startStory() {
  cancelStory();
  music.showStory();
  storyPlaying = true;
  ui.story.classList.add("active");
  ui.start.classList.remove("active");
  ui.storyPrompt.hidden = true;
  ui.storyPlayer.hidden = false;
  ui.storySkipButton.hidden = false;
  ui.storyLine.textContent = "Loading the briefing...";
  ui.storyLine.classList.add("show");
  // The sleeping Subject 07 in it is whoever you play as.
  if (prologue && prologue.character !== savedCharacter()) { prologue.dispose(); prologue = null; }
  prologue ??= new Prologue({ renderer, assetBase: MELTDOWN_ASSET_BASE, character: savedCharacter(), voice: story.voice });
  try {
    await prologue.load();
  } catch (error) {
    console.warn("[briefing] could not load", error);
    finishStory();
    return;
  }
  if (!storyPlaying) return;
  ui.story.classList.remove("active");
  prologue.start(() => finishStory());
}

function finishStory() {
  const wasPlaying = storyPlaying || prologue?.active;
  cancelStory();
  prologue?.skip();
  ui.storyLine.classList.remove("show");
  ui.story.classList.remove("active");
  if (wasPlaying || !ui.start.classList.contains("active")) ui.start.classList.add("active");
  music.showMenu();
}

ui.storySkipButton.addEventListener("click", finishStory);
$("#storyBeginButton").addEventListener("click", startStory);
$("#storySkipToMenuButton").addEventListener("click", finishStory);
$("#replayStoryButton").addEventListener("click", startStory);

// Character choice: who you play as (Level 3 shows them; saved for next time).
const characterButtons = [...document.querySelectorAll("[data-character]")];
function showCharacterChoice() {
  const chosen = savedCharacter();
  for (const button of characterButtons) {
    const on = button.dataset.character === chosen;
    button.classList.toggle("picked", on);
    button.setAttribute("aria-pressed", String(on));
  }
}
for (const button of characterButtons) {
  button.addEventListener("click", () => {
    if (!CHARACTERS[button.dataset.character]) return;
    saveCharacter(button.dataset.character);
    level1Audio.setCharacter(button.dataset.character);
    loadPlayerBody(button.dataset.character);
    meltdown?.setCharacter(button.dataset.character);
    showCharacterChoice();
  });
}
showCharacterChoice();
loadPlayerBody();
// Dr. Okoro's model (cached: every scene's companion clones the same template).
let okoroTemplate = null;
const okoroReady = loadStoryCharacter(MELTDOWN_ASSET_BASE, "scientistGood")
  .then((template) => {
    okoroTemplate = template;
    okoro.setModel(template);
    return template;
  })
  .catch((error) => console.warn("[story] Okoro's model failed to load; stand-in kept", error));
// Dr. Vale (the monitor in the Labs, the pilot at the end): loaded in the background.
let valeTemplate = null;
const valeReady = loadStoryCharacter(MELTDOWN_ASSET_BASE, "scientistEvil")
  .then((template) => (valeTemplate = template))
  .catch((error) => console.warn("[story] Vale's model failed to load", error));

// Skin tone: one swatch per tone (src/figure/look.js), remembered.
const skinPick = $("#skinPick");
function showSkinChoice() {
  const chosen = savedSkinTone();
  for (const button of skinPick.querySelectorAll("[data-skin]")) {
    const on = button.dataset.skin === chosen;
    button.classList.toggle("picked", on);
    button.setAttribute("aria-pressed", String(on));
  }
}
for (const [key, tone] of Object.entries(SKIN_TONES)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "skin-button";
  button.dataset.skin = key;
  button.title = tone.label;
  button.setAttribute("aria-label", `${tone.label} skin`);
  button.style.setProperty("--swatch", tone.swatch);
  button.addEventListener("click", () => {
    saveSkinTone(key);
    playerBody.setSkinTone(key);
    meltdown?.avatar?.setSkinTone(key);
    showSkinChoice();
  });
  skinPick.appendChild(button);
}
showSkinChoice();

// The sphere you start with (the loadout card; the pause menu changes it mid-run).
const ballPickers = buildBallPickers((key) => {
  arsenal.prefer(key);
  if (state === "playing") showMessage(`${BALLS[key].name.toUpperCase()} SPHERE`);
});
buildTabs();

// A new story from the menu plays every scene again ("Run again" after a death does not).
$("#startButton").addEventListener("click", () => { ui.start.classList.remove("active"); story.forgetSeen(); startCampaign(); });
ui.endlessButton.addEventListener("click", () => { ui.start.classList.remove("active"); refreshEndlessMenu(); ui.endless.classList.add("active"); });
for (const button of document.querySelectorAll("[data-endless]")) {
  button.addEventListener("click", () => startEndless(button.dataset.endless));
}
$("#endlessBackButton").addEventListener("click", () => { ui.endless.classList.remove("active"); ui.start.classList.add("active"); });
$("#manualButton").addEventListener("click", () => { ui.start.classList.remove("active"); ui.manual.classList.add("active"); });
$("#manualBackButton").addEventListener("click", () => { ui.manual.classList.remove("active"); ui.start.classList.add("active"); });
$("#chaptersButton").addEventListener("click", () => { ui.start.classList.remove("active"); ui.chapters.classList.add("active"); });
$("#chaptersBackButton").addEventListener("click", () => { ui.chapters.classList.remove("active"); ui.start.classList.add("active"); });
for (const button of document.querySelectorAll("[data-chapter]")) {
  button.addEventListener("click", () => startChapter(button.dataset.chapter));
}
$("#manualTopBackButton").addEventListener("click", () => { ui.manual.classList.remove("active"); ui.start.classList.add("active"); });
$("#settingsButton").addEventListener("click", () => openSettings("intro"));
$("#settingsBackButton").addEventListener("click", closeSettings);
$("#pauseButton").addEventListener("click", () => { paused ? closePause() : openPause(); });
$("#resumeButton").addEventListener("click", closePause);
$("#pauseSettingsButton").addEventListener("click", () => openSettings("pause"));
$("#restartRunButton").addEventListener("click", () => { closePause(); restartRun({ fromTop: true }); });
$("#quitButton").addEventListener("click", quitToMenu);
$("#restartButton").addEventListener("click", () => { restartRun(); });
$("#endMenuButton").addEventListener("click", quitToMenu);
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button && !button.disabled) level1Audio.uiClick();
});
ui.viewButton.addEventListener("click", (event) => {
  event.stopPropagation();
  ui.viewMenu.hidden = !ui.viewMenu.hidden;
});
addEventListener("click", (event) => {
  if (!ui.viewMenu.hidden && !event.target.closest("#viewMenu, #viewButton")) ui.viewMenu.hidden = true;
});
ui.sensitivitySlider.addEventListener("input", (event) => { settings.sensitivity = Number(event.target.value); saveSettings(); });
ui.aimAssistToggle.addEventListener("change", (event) => { settings.aimAssist = event.target.checked; saveSettings(); });
$("#resetPowerupTipsButton").addEventListener("click", (event) => {
  powerups.resetSeen();
  event.currentTarget.textContent = "Done - you will see them again";
});
// The serum card: its button, or a click anywhere on it, carries on.
powerups.card.addEventListener("click", closePowerupIntro);
ui.reducedMotionToggle.addEventListener("change", (event) => { settings.reducedMotion = event.target.checked; saveSettings(); document.body.classList.toggle("reduced-motion", settings.reducedMotion); meltdown?.setReducedMotion(settings.reducedMotion); story.setOptions({ reducedMotion: settings.reducedMotion }); });
ui.subtitleSizeSelect.addEventListener("change", (event) => { settings.subtitleSize = event.target.value; saveSettings(); applySubtitleSize(); });
ui.longReactionsToggle.addEventListener("change", (event) => { settings.longReactions = event.target.checked; saveSettings(); story.setOptions({ longWindows: settings.longReactions }); });
ui.holdInsteadOfMashToggle.addEventListener("change", (event) => { settings.holdInsteadOfMash = event.target.checked; saveSettings(); story.setOptions({ holdInsteadOfMash: settings.holdInsteadOfMash }); });
ui.qualitySelect.addEventListener("change", (event) => {
  settings.quality = event.target.value;
  autoLow = false;
  saveSettings();
  applyQuality();
  ui.qualityNote.textContent = state === "playing" || paused ? "Updated. Level detail (shadows, props) applies from the next run." : "";
});
$("#resetSettingsButton").addEventListener("click", () => {
  settings = { ...settingsDefaults, hud: { ...settingsDefaults.hud } };
  applySettingsToControls(); saveSettings(); applyQuality();
  story.setOptions({ longWindows: settings.longReactions, holdInsteadOfMash: settings.holdInsteadOfMash, reducedMotion: settings.reducedMotion });
});

// Photo mode controls.
causewayHud.photoEl.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.filter !== undefined) {
    postfx.uniforms.uFilter.value = Number(button.dataset.filter);
    for (const b of causewayHud.photoEl.querySelectorAll("[data-filter]")) b.classList.toggle("on", b === button);
  }
  if (button.dataset.action === "exit") togglePhoto();
  if (button.dataset.action === "photo") {
    renderFrame();
    photo.capturePhoto(canvas);
    showMessage("PHOTO SAVED");
  }
  if (button.dataset.action === "360") {
    photo.capture360(scene, camera.position, causeway?.glassShared ?? null);
    showMessage("360 PANORAMA SAVED");
  }
});
causewayHud.photoEl.querySelector("[data-fov]").addEventListener("input", (event) => { photo.fov = Number(event.target.value); });

/* ---- Input ---------------------------------------------------------------- */

addEventListener("pointermove", (event) => {
  const factor = settings.sensitivity / 100;
  pointer.x = THREE.MathUtils.clamp(((event.clientX / innerWidth) * 2 - 1) * factor, -1, 1);
  pointer.y = THREE.MathUtils.clamp((-(event.clientY / innerHeight) * 2 + 1) * factor, -1, 1);
  placeReticle();
  meltdown?.onPointerMove(event.clientX, event.clientY);
  gravityLift?.onPointerMove(pointer.x, pointer.y);
});

/**
 * The crosshair is drawn exactly where throws go: at the pointer's aim point
 * (which includes the sensitivity setting), not fixed in the middle of the
 * screen. The system cursor is hidden while aiming so only one marker shows.
 */
function placeReticle() {
  ui.reticle.style.left = `${((pointer.x + 1) / 2) * innerWidth}px`;
  ui.reticle.style.top = `${((1 - pointer.y) / 2) * innerHeight}px`;
}
addEventListener("pointerdown", (event) => {
  if (powerups.open) return; // the serum card takes the click
  if (state === "launch" && causeway) { skipLaunch(); return; }
  if (state === "cutscene" || story.player.active) return;
  if (event.target.closest("button, input, select, label, .screen.active, .cw-photo, .view-menu, .mlt-credits")) return;
  if (currentLevel === 3) {
    if (meltdown && state === "playing" && !paused) meltdown.onPointerDown(event);
    // Focus (bullet time) is every level's, as in the Skyline.
    if (event.button === 2 && state === "playing") run.focusing = true;
    return;
  }
  // The lift ride: shoot the brake clamps.
  if (gravityLift) {
    if (event.button === 0 && !paused) gravityLift.fire();
    return;
  }
  if (event.button === 0) fire();
  if (event.button === 2 && state === "playing") run.focusing = true;
});

/** The sphere types are every level's now (the Skyline's rules everywhere). */
function cycleSphere(step) {
  if (photoActive || state !== "playing" || paused) return;
  const ball = arsenal.cycle(step);
  ballPickers.show(ball.key);
  const verb = currentLevel === 2 ? "THROW" : "SHOT";
  showMessage(`${ball.name.toUpperCase()} SPHERE // ${ball.cost} PER ${verb}`);
  meltdown?.hud?.toast?.(`${ball.name.toUpperCase()} SPHERE`, `${ball.cost} PER SHOT`, "", 1200);
}
addEventListener("pointerup", (event) => {
  if (event.button === 2) run.focusing = false;
  meltdown?.onPointerUp(event);
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
addEventListener("wheel", (event) => {
  if (gravityLift) return;
  cycleSphere(event.deltaY > 0 ? 1 : -1);
}, { passive: true });

addEventListener("keydown", (event) => {
  // The serum card: Space or Enter carries on (Esc too, below); nothing else.
  if (powerups.open && event.code !== "Escape") {
    if (event.code === "Space" || event.code === "Enter" || event.code === "NumpadEnter") { event.preventDefault(); closePowerupIntro(); }
    return;
  }
  if (event.code === "Escape") {
    if (event.repeat) return;
    level1Audio.uiClick();
    if (photoActive) togglePhoto();
    else if (ui.manual.classList.contains("active")) { ui.manual.classList.remove("active"); ui.start.classList.add("active"); }
    else if (ui.chapters.classList.contains("active")) { ui.chapters.classList.remove("active"); ui.start.classList.add("active"); }
    else if (ui.endless.classList.contains("active")) { ui.endless.classList.remove("active"); ui.start.classList.add("active"); }
    else if (ui.settings.classList.contains("active")) closeSettings();
    else if (storyPlaying) finishStory();
    else if (paused) closePause();
    else openPause();
    return;
  }
  if (state === "launch" && causeway) { skipLaunch(); return; }
  // A cutscene has the controls (its reaction keys are caught before this).
  if (state === "cutscene" || story.player.active) {
    if (event.code === "Space") event.preventDefault();
    return;
  }
  // Level 3 has its own controls; the keys it uses are not also acted on
  // here (Esc, the demo jumps, H and V still are).
  if (currentLevel === 3 && meltdown && state === "playing" && !paused && meltdown.onKeyDown(event)) return;
  if (event.code === "KeyP") { togglePhoto(); return; }
  if (photoActive) return;
  if (event.code === "Space" && storyPlaying) { event.preventDefault(); finishStory(); return; }
  if (event.code === "KeyR" && state === "ended") { level1Audio.uiClick(); restartRun(); return; }
  // A reaction prompt on screen owns the letter keys (Q E R F Z X C V):
  // no shortcut fires underneath it.
  const reacting = story.reactions?.state === "running";
  if (event.code === "KeyM" && !event.repeat && !reacting) { settings.hud.minimap = !settings.hud.minimap; saveSettings(); applySettingsToControls(); }
  if (event.code === "KeyH" && !event.repeat && !reacting) document.body.classList.toggle("hud-hidden");
  if (event.code === "KeyV" && !event.repeat && !reacting) ui.viewMenu.hidden = !ui.viewMenu.hidden;
  if (event.code === "Space" && state === "playing" && !paused) {
    event.preventDefault();
    pressJump();
  }
  if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && state === "playing" && !paused) pressSlide();
  if (event.code === "Digit1") demoStoryJump(1);
  if (event.code === "Digit2") demoStoryJump(2);
  if (event.code === "Digit3") demoStoryJump(3);
  if (event.code === "Digit4") demoStoryJump(4);
  if (event.code === "Digit5") demoGravityLift();
  if (event.code === "Digit6") demoQuietRide();
  if (event.code === "KeyA" || event.code === "ArrowLeft") lane = Math.max(0, lane - 1);
  if (event.code === "KeyD" || event.code === "ArrowRight") lane = Math.min(2, lane + 1);
  if (event.code === "KeyW" || event.code === "ArrowUp") {
    if (currentLevel === 1) { keysDown.add("up"); event.preventDefault(); }
    else if (currentLevel === 2 && state === "playing" && !paused && !event.repeat) { event.preventDefault(); pressJump(); }
  }
  if (event.code === "KeyS" || event.code === "ArrowDown") {
    if (currentLevel === 1) { keysDown.add("down"); event.preventDefault(); }
    else if (currentLevel === 2 && state === "playing" && !paused && !event.repeat) { event.preventDefault(); pressSlide(); }
  }
  if ((event.code === "KeyQ" || event.code === "KeyE") && !event.repeat && !gravityLift && !reacting) cycleSphere(event.code === "KeyE" ? 1 : -1);
  if (event.code === "KeyC" && !reacting && (state === "playing" || state === "lift")) { cameraThird = !cameraThird; updateUI(); showMessage(cameraThird ? "CHASE CAMERA" : "FIRST-PERSON CAMERA"); }
});
addEventListener("keyup", (event) => {
  meltdown?.onKeyUp(event);
  if (event.code === "KeyW" || event.code === "ArrowUp") keysDown.delete("up");
  if (event.code === "KeyS" || event.code === "ArrowDown") keysDown.delete("down");
});
addEventListener("blur", () => { keysDown.clear(); run.focusing = false; meltdown?.onBlur(); });
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  prologue?._resize();
  postfx.resize();
  minimap.measure();
  placeReticle();
  meltdown?.resize(innerWidth, innerHeight);
});

applyQuality();
resetStats("story");
refreshMenuProgress();
updateUI();
camera.position.set(0, 1.8, CAUSEWAY_ORIGIN_Z + 8);
requestAnimationFrame(() => minimap.measure());
animate();

/**
 * Read-only handle on game state, for the check harness and for poking at a
 * run from the console during a demo. Not used by the game itself.
 */
let stepTime = 0;
globalThis.__dbg = {
  /** true: only __dbg.step advances the game (the page still renders). */
  get manual() { return manualStep; },
  set manual(v) { manualStep = !!v; },
  get paused() { return paused; },
  startEndless,
  restartRun,
  endRun,
  openPause,
  closePause,
  get state() { return state; },
  get currentLevel() { return currentLevel; },
  get runZ() { return runZ; },
  get health() { return health; },
  get ammo() { return ammo; },
  get score() { return score; },
  get combo() { return combo; },
  get foundry() { return foundry; },
  get causeway() { return causeway; },
  get meltdown() { return meltdown; },
  enterMeltdown,
  get gravityLift() { return gravityLift; },
  get playerBodyTemplate() { return playerBodyTemplate; },
  get playerBody() { return playerBody; },
  demoGravityLift,
  demoQuietRide,
  get run() { return run; },
  causewayPace,
  resolveAim: () => resolveAim(aliveTargets(), currentLevel === 1 && causeway ? causeway.solids : []),
  aliveTargets: () => aliveTargets(),
  get projectiles() { return projectiles; },
  get arsenal() { return arsenal; },
  get powerups() { return powerups; },
  get skyLauncher() { return { rig: skyLauncher.rig, loaded: !!skyLauncher.model, cameraThird, avatarVisible: avatar.visible, level: currentLevel, photoActive }; },
  get missions() { return missions; },
  get postfx() { return postfx; },
  get music() { return music.snapshot(); },
  get level1Audio() { return level1Audio.snapshot(); },
  /** The briefing film (src/story/prologue.js), once started; startBriefing() starts it. */
  get prologue() { return prologue; },
  startBriefing: () => startStory(),
  finishBriefing: () => finishStory(),
  get shardBursts() { return shatterFX.bursts.length; },
  foundryDistance,
  causewayDistance,
  demoJump,
  shatter,
  fire,
  resetGame,
  setRunZ(z) { runZ = z; },
  setCausewayDistance(d) { runZ = CAUSEWAY_ORIGIN_Z - d; },
  setLane(index) { lane = index; playerX = lanes[index]; },
  setHealth(v) { health = v; },
  /**
   * Advance the simulation without rendering - for the check harness, which
   * runs in software GL where real frames are far too slow to play through.
   */
  step(frames = 1, dt = 1 / 30) {
    for (let i = 0; i < frames; i += 1) { stepTime += dt; updateGame(dt, clock.elapsedTime + stepTime); updateCursor(); }
  },
  render: () => renderFrame(),
  keyDown(name) { keysDown.add(name); },
  keyUp(name) { keysDown.delete(name); },
  setPointer(x, y) { pointer.set(x, y); },
  setAmmo(v) { ammo = v; },
  get playerX() { return playerX; },
  renderer, scene, camera, THREE,
  /** The story: the layer, Okoro, and a jump to any scene (story runs only). */
  story: {
    layer: story,
    okoro,
    ready: Promise.all([okoroReady, valeReady]),
    get guide() { return foundryGuide; },
    get ward() { return ward; },
    get skyline() { return skylineStory; },
    get checkpoint() { return storyCheckpoint; },
    get death() { return storyDeath; },
    getMeltdown,
    get storyRun() { return storyRun; },
    get log() { return story.log; },
    /** Start a scene as a story run would reach it. */
    jump(name) {
      closePause();
      finishStory();
      for (const screen of document.querySelectorAll(".screen.active")) screen.classList.remove("active");
      if (name === "wake") { story.forgetSeen(); startCampaign(); return true; }
      if (name === "foundry") { story.markSeen("wake"); startCampaign(); return true; }
      return storyJumps[name]?.() ?? false;
    },
  },
};
