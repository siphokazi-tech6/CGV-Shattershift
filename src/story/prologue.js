/**
 * The prologue: everything before the game, as a short in-engine film - the
 * start screen's "briefing". Chapter cards and typed captions over staged
 * shots, each caption read by the narrator (HALCYON's voice - recorded by
 * tools/audio/voices.py), with the story track under it. It explains what Project
 * Ascension was for, why the patients were taken, who ran it, what went wrong,
 * how it was found out, and why the tower is coming down tonight.
 *
 *   const prologue = new Prologue({ renderer, assetBase, character, voice });
 *   await prologue.load();                 // the models it stages
 *   prologue.start(() => backToTheMenu());
 *   // each frame while it runs:
 *   prologue.update(dt, time);
 *   prologue.render();                     // instead of the game's scene
 *   prologue.skip();                       // the SKIP button / Esc
 *
 * Every chapter is its own small set in its own THREE.Scene (its own lights
 * and fog), so a cut is just a change of which scene is drawn. The sets use
 * the supplied models where they exist: the city at night, the operating
 * theatre, the police helicopters,
 * the scientists, the patients - with plain stand-ins if one fails to load.
 * The words are all in CHAPTERS below.
 */

import * as THREE from "../three.js";
import { RoomEnvironment } from "../three-addons.js";
import { loadMeltdownAssets } from "../levels/meltdown/assets.js";
import { cloneCharacter, HumanoidRig } from "../levels/meltdown/characters.js";
import { PlayerAvatar } from "../levels/meltdown/player.js";
import { Companion, loadStoryCharacter } from "./companion.js";
import { WardStage } from "./stages/ward.js";
import { PoliceHelicopters } from "../fx/police-helicopters.js";
import { createPropKit } from "./stages/props.js";
import { CityAtNight } from "../levels/meltdown/city.js";
import { VOICE_LINES } from "../audio/voice-lines.js";

/**
 * The film, chapter by chapter: which set, how long, the card and the
 * caption, and the camera's move (from -> to, each { pos, look }, in the set's
 * own coordinates). Edit the words here.
 */
const FILM = [
  {
    set: "city", seconds: 10, tag: "01", title: "Ascension Tower",
    text: "The Meridian Institute owned the top forty floors of Ascension Tower. The city thought it was a hospital.",
    from: { pos: [150, 22, 210], look: [0, 60, 0] }, to: { pos: [70, 120, 120], look: [0, 175, 0] },
  },
  {
    set: "office", seconds: 11, tag: "02", title: "Project Ascension",
    text: "Its director, Dr. Adrian Vale, sold the board a resonance field that could rebuild a body cell by cell. \"Fixed\" people, he called them. No more illness. No more age.",
    from: { pos: [4.5, 1.7, 5.5], look: [-1, 1.5, -1.5] }, to: { pos: [1.6, 1.6, 2.6], look: [-1.4, 1.55, -1] },
  },
  {
    set: "theatre", seconds: 11, tag: "03", title: "The subjects",
    text: "Trials need subjects. Meridian found them at the city's free clinics - the homeless, the uninsured, the ones nobody would come looking for. They signed up for a sleep study.",
    from: { pos: [2.6, 2.1, 2.6], look: [0, 1.0, 0] }, to: { pos: [1.2, 2.6, 1.0], look: [0, 0.95, -0.2] },
  },
  {
    set: "labs", seconds: 11, tag: "04", title: "Trials one to six",
    text: "Six trials failed. The subjects lived - and kept changing. Meridian sedated them, catalogued them, and kept them in the labs below the observation decks.",
    from: { pos: [0, 1.7, 9], look: [0, 1.6, -6] }, to: { pos: [0.6, 1.5, 1.5], look: [-2.6, 1.7, -2.5] },
  },
  {
    set: "ward", seconds: 11, tag: "05", title: "Subject 07",
    text: "Trial seven was different. Subject 07 came through the field changed in a way none of their instruments could measure. Vale wanted to know how - before anyone else did.",
    from: { pos: [1.8, 2.4, -1.4], look: [-1.4, 0.8, 1.6] }, to: { pos: [-0.4, 1.7, 0.0], look: [-1.4, 0.75, 1.9] },
  },
  {
    set: "leak", seconds: 11, tag: "06", title: "The leak",
    text: "Dr. Elias Okoro had run the trials' anaesthesia for two years. He kept a copy of everything. Tonight he sent it to the city police.",
    from: { pos: [-2.4, 1.9, 2.8], look: [0.3, 1.1, -0.6] }, to: { pos: [-0.9, 1.55, 1.2], look: [0.4, 1.15, -0.8] },
  },
  {
    set: "city", seconds: 9, tag: "07", title: "Found out",
    text: "They're on their way. Every helicopter the city has.",
    police: true,
    // Low, from the street: the city's lights under the frame, the tower
    // going up into the haze and the helicopters' beams finding it.
    from: { pos: [-170, 26, 260], look: [0, 105, 30] }, to: { pos: [-135, 48, 215], look: [0, 140, 20] },
  },
  {
    set: "control", seconds: 11, tag: "08", title: "The order",
    text: "Vale's answer was to bury it. Charges on every floor. The subjects still in their beds. Thirty minutes - and Ascension Tower comes down.",
    from: { pos: [-1.6, 1.8, 3.8], look: [0.45, 1.5, -1] }, to: { pos: [-0.7, 1.65, 2.5], look: [0.5, 1.5, -1] },
  },
  {
    set: "ward", seconds: 8, tag: "09", title: "Tonight",
    text: "Okoro went back for one of them.",
    okoroArrives: true,
    from: { pos: [0.8, 1.7, -3.8], look: [-0.6, 1.1, 2] }, to: { pos: [0.2, 1.6, -2.4], look: [-1.2, 1.0, 1.8] },
  },
];

/** Seconds into a chapter when the narrator starts (after the fade from black). */
const NARRATION_AT = 0.7;

/**
 * The film as it plays: each chapter at least as long as its narration takes
 * (the recordings are listed in src/audio/voice-lines.js), so no line is cut
 * off by the next chapter.
 */
export const CHAPTERS = FILM.map((c) => {
  const spoken = VOICE_LINES[`narrator|${c.text}`]?.[1] ?? 0;
  return { ...c, seconds: Math.max(c.seconds, spoken ? NARRATION_AT + spoken + 1.1 : 0) };
});

const STYLE = `
.prologue { position: fixed; inset: 0; z-index: 40; pointer-events: none; font-family: Inter, "Segoe UI", Arial, sans-serif; color: #eef4f6; }
.prologue[hidden] { display: none; }
.prologue .pl-bar { position: absolute; left: 0; right: 0; height: 11vh; background: #000; }
.prologue .pl-bar.top { top: 0; } .prologue .pl-bar.bottom { bottom: 0; }
.prologue .pl-fade { position: absolute; inset: 0; background: #000; opacity: 1; }
.prologue .pl-card { position: absolute; left: 4vw; bottom: calc(11vh + 2.5vh); max-width: min(560px, 70vw); padding: 12px 20px 14px; background: linear-gradient(90deg, rgba(3,5,8,.82), rgba(3,5,8,.55) 70%, rgba(3,5,8,0)); border-left: 3px solid #ff9a52; opacity: 0; transform: translateY(8px); transition: opacity .7s ease, transform .7s ease; }
.prologue .pl-card.show { opacity: 1; transform: none; }
.prologue .pl-tag { font-size: 11px; font-weight: 800; letter-spacing: .32em; color: #ff9a52; }
.prologue .pl-title { margin: 4px 0 6px; font-size: clamp(20px, 2.4vw, 32px); font-weight: 800; letter-spacing: .02em; text-shadow: 0 2px 18px rgba(0,0,0,.7); }
.prologue .pl-text { font-size: clamp(13px, 1.05vw, 16px); line-height: 1.55; color: #d6e2e6; text-shadow: 0 1px 10px rgba(0,0,0,.85); min-height: 3.2em; }
.prologue .pl-dots { position: absolute; right: 5vw; bottom: calc(11vh + 3vh); display: flex; gap: 6px; }
.prologue .pl-dots i { width: 18px; height: 3px; background: rgba(255,255,255,.18); }
.prologue .pl-dots i.on { background: #ff9a52; }
.prologue .pl-endtitle { position: absolute; inset: 0; display: grid; place-items: center; font-size: clamp(40px, 7vw, 92px); font-weight: 900; letter-spacing: .12em; opacity: 0; transition: opacity 1.2s ease; }
.prologue .pl-endtitle.show { opacity: 1; }
.prologue .pl-skip { position: absolute; right: 4vw; top: calc(11vh + 18px); z-index: 2; pointer-events: auto; padding: 8px 14px; border: 1px solid rgba(255,255,255,.35); background: rgba(0,0,0,.45); color: #eef4f6; font: 700 11px/1 Inter, "Segoe UI", Arial, sans-serif; letter-spacing: .2em; cursor: pointer; }
.prologue .pl-skip:hover { border-color: #ff9a52; color: #ff9a52; }
`;

function ensureStyle() {
  if (document.querySelector("style[data-prologue]")) return;
  const style = document.createElement("style");
  style.dataset.prologue = "";
  style.textContent = STYLE;
  document.head.appendChild(style);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A screen's worth of text on a dark panel (the presentation, the upload, the charges). */
function screenTexture(lines, { bg = "#04121a", fg = "#7fe9ff", accent = null, w = 512, h = 288 } = {}) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(127,233,255,0.15)";
    for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    lines.forEach(([text, size, colour], i) => {
      g.fillStyle = colour ?? fg;
      g.font = `bold ${size}px monospace`;
      g.fillText(text, 24, 50 + i * (h - 70) / Math.max(1, lines.length - 1 || 1));
    });
    if (accent) accent(g, w, h);
  });
}

/** Lit office windows for the tower. */
function windowsTexture(seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const t = canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = "#0b0d12";
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const lit = rnd() < 0.55;
        g.fillStyle = lit ? `rgba(${200 + rnd() * 55},${200 + rnd() * 40},${150 + rnd() * 80},${0.6 + rnd() * 0.4})` : "rgba(24,30,40,1)";
        g.fillRect(x * 32 + 4, y * 16 + 3, 24, 10);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The city at night through a glass wall: towers, lit windows, a low glow. */
function cityGlassTexture() {
  let s = 41;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return canvasTexture(1024, 320, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#03060d");
    sky.addColorStop(0.75, "#101a30");
    sky.addColorStop(1, "#33263a");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 2; layer += 1) {
      for (let x = 0; x < w;) {
        const bw = 20 + rnd() * 60;
        const bh = (layer ? 80 : 40) + rnd() * (layer ? 200 : 120);
        g.fillStyle = layer ? "#05070c" : "#0b1020";
        g.fillRect(x, h - bh, bw, bh);
        for (let y = h - bh + 6; y < h - 4; y += 8) {
          for (let xx = x + 3; xx < x + bw - 3; xx += 6) {
            if (rnd() < (layer ? 0.35 : 0.2)) {
              g.fillStyle = `rgba(255,${190 + rnd() * 60},${110 + rnd() * 90},${0.4 + rnd() * 0.6})`;
              g.fillRect(xx, y, 3, 4);
            }
          }
        }
        x += bw + rnd() * 10;
      }
    }
  });
}

/** Steel floor grating. */
function gratingTexture() {
  const t = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = "#8a9294";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#2a2f31";
    for (let y = 4; y < h; y += 16) for (let x = 4; x < w; x += 16) g.fillRect(x, y, 10, 10);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const smooth = THREE.MathUtils.smoothstep;

export class Prologue {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {string} o.assetBase     URL of assets/meltdown/
   * @param {string} [o.character]   the player character's asset key
   * @param {{say(line:object):void, stop():void, preload(lines:object[]):void}} [o.voice]  the narrator (story/voice.js)
   */
  constructor({ renderer, assetBase, character = "playerFemale", voice = null }) {
    this.renderer = renderer;
    this.assetBase = assetBase;
    this.character = character;
    this.voice = voice;
    this.narrated = new Set();
    this.active = false;
    this.loaded = false;
    this.owned = [];
    this.sets = {};
    this.updaters = [];
    const size = renderer.getSize(new THREE.Vector2());
    this.camera = new THREE.PerspectiveCamera(50, size.x / size.y, 0.05, 2000);
    ensureStyle();
    this._buildOverlay();
  }

  _own(x) {
    this.owned.push(x);
    return x;
  }

  _buildOverlay() {
    const el = (tag, cls, html = "") => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      n.innerHTML = html;
      return n;
    };
    // A plain object (on an element, our `title` would be its tooltip).
    this.ui = { root: el("div", "prologue") };
    this.ui.root.hidden = true;
    this.ui.fade = el("div", "pl-fade");
    this.ui.card = el("div", "pl-card", `<div class="pl-tag"></div><div class="pl-title"></div><div class="pl-text"></div>`);
    this.ui.dots = el("div", "pl-dots", CHAPTERS.map(() => "<i></i>").join(""));
    this.ui.end = el("div", "pl-endtitle", "FRACTURE RUN");
    this.ui.tag = this.ui.card.querySelector(".pl-tag");
    this.ui.title = this.ui.card.querySelector(".pl-title");
    this.ui.text = this.ui.card.querySelector(".pl-text");
    this.ui.skipButton = el("button", "pl-skip", "SKIP (ESC)");
    this.ui.skipButton.type = "button";
    this.ui.skipButton.addEventListener("click", () => this.skip());
    this.ui.root.append(el("div", "pl-bar top"), el("div", "pl-bar bottom"), this.ui.card, this.ui.dots, this.ui.end, this.ui.fade, this.ui.skipButton);
    document.body.appendChild(this.ui.root);
  }

  /** Fetch the models and build every set. Safe to call twice. */
  async load(onProgress) {
    if (this.loaded) return;
    this._loading ??= (async () => {
      const base = this.assetBase;
      const [assets, okoro, vale] = await Promise.all([
        loadMeltdownAssets(base, { names: ["cityNight", "operatingRoom", "patient", "officeDesk", this.character, "scientistRust"], onProgress }),
        loadStoryCharacter(base, "scientistGood"),
        loadStoryCharacter(base, "scientistEvil"),
      ]);
      this.assets = assets;
      this.templates = { okoro, vale };
      // The sets' furniture (src/story/stages/props.js).
      this.kit = createPropKit((x) => this._own(x));
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.env = this._own(pmrem.fromScene(new RoomEnvironment(this.renderer), 0.04).texture);
      pmrem.dispose();
      this._buildCity();
      this._buildOffice();
      this._buildTheatre();
      this._buildLabs();
      this._buildWard();
      this._buildLeak();
      this._buildControl();
      this.police = new PoliceHelicopters({ count: 5, seed: 9, craftScale: 2.6 });
      this.police.root.position.y = 115;
      this.sets.city.scene.add(this.police.root);
      await this.police.load(base);
      // Compile every set now, so a cut never stalls.
      for (const set of Object.values(this.sets)) this.renderer.compile(set.scene, this.camera);
      this.loaded = true;
    })();
    await this._loading;
  }

  _set(name, { background = 0x05070a, fog = null } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    if (fog) scene.fog = new THREE.FogExp2(fog[0], fog[1]);
    scene.environment = this.env;
    const set = { scene, name };
    this.sets[name] = set;
    return set;
  }

  _person(template, { position, heading = 0, action = "idle" } = {}) {
    const c = new Companion();
    if (template) c.setModel(template);
    c.root.position.copy(position);
    c.root.rotation.y = heading;
    c.act(action);
    return c;
  }

  /** A patient (the supplied model), posed - floating in a tank, or laid out. */
  _patient(pose = {}) {
    const asset = this.assets.get("patient");
    if (!asset) {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.2, 4, 8), this._own(new THREE.MeshStandardMaterial({ color: 0x8a7b70 })));
      m.position.y = 0.85;
      const g = new THREE.Group();
      g.add(m);
      return g;
    }
    const model = cloneCharacter(asset.template);
    const rig = new HumanoidRig(model);
    if (rig.valid) rig.pose(pose);
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
    });
    return model;
  }

  /* ---------------- The sets ---------------- */

  /** The city at night, and Ascension Tower standing over it. */
  _buildCity() {
    const set = this._set("city", { background: 0x070a14, fog: [0x0b1020, 0.0028] });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0x5a6c9a, 0x120c08, 0.9));
    const moon = new THREE.DirectionalLight(0x9fb2e0, 1.1);
    moon.position.set(-200, 300, 100);
    s.add(moon);
    const city = this.assets.get("cityNight");
    if (city) {
      const model = city.template.clone(true);
      // Its own little sky dome goes: the set has a sky. And the one facade
      // with a shop shutter's foreign lettering on it takes the plain lit
      // windows the other towers have (it's an American city).
      let windowsMap = null;
      model.traverse((o) => { if (o.isMesh && o.material?.name === "Material.001") windowsMap = o.material.map; });
      model.traverse((o) => {
        if (o.isMesh && o.material?.name === "Material.005" && windowsMap) {
          o.material = this._own(o.material.clone());
          o.material.map = windowsMap;
        }
        if (o.isMesh && o.geometry.boundingSphere === null) o.geometry.computeBoundingSphere();
        if (o.isMesh && /Sphere/.test(o.name)) o.visible = false;
        if (o.isMesh && o.material && "emissive" in o.material) {
          o.material = this._own(o.material.clone());
          o.material.emissiveMap = o.material.map;
          o.material.emissive = new THREE.Color(0xffffff);
          o.material.emissiveIntensity = 0.55;
        }
      });
      model.scale.setScalar(26);
      model.position.set(0, -6, 0);
      s.add(model);
    }
    // The streets the city stands on, glowing into the distance (so the
    // wide shots have ground under them, not a void).
    const streets = new CityAtNight({ seed: 3, streetY: -6.5, towers: false });
    s.add(streets.root);
    this.owned.push(streets);
    this.updaters.push((dt, time) => streets.update(dt, time, { haze: s.fog?.color }));
    // Ascension Tower: the tallest thing in the city by a long way.
    const windows = this._own(windowsTexture(7));
    windows.repeat.set(3, 9);
    const towerMat = this._own(new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.4, metalness: 0.6, map: windows, emissiveMap: windows, emissive: 0xffffff, emissiveIntensity: 0.75 }));
    const tower = new THREE.Mesh(this._own(new THREE.BoxGeometry(34, 220, 34)), towerMat);
    tower.position.y = 110;
    s.add(tower);
    const crown = new THREE.Mesh(this._own(new THREE.BoxGeometry(26, 14, 26)), this._own(new THREE.MeshStandardMaterial({ color: 0x1d2128, metalness: 0.7, roughness: 0.4 })));
    crown.position.y = 227;
    s.add(crown);
    const spire = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.4, 1.4, 40, 8)), crown.material);
    spire.position.y = 254;
    s.add(spire);
    // Aircraft warning lights, blinking.
    const red = this._own(new THREE.MeshBasicMaterial({ color: 0xff2a20 }));
    const blink = [];
    for (const [x, y, z] of [[0, 274, 0], [13, 234, 13], [-13, 234, -13], [13, 234, -13], [-13, 234, 13]]) {
      const b = new THREE.Mesh(this._own(new THREE.SphereGeometry(0.9, 8, 6)), red);
      b.position.set(x, y, z);
      s.add(b);
      blink.push(b);
    }
    // The institute's floors: a band of hot white near the top.
    const band = new THREE.Mesh(this._own(new THREE.BoxGeometry(34.4, 30, 34.4)), this._own(new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })));
    band.position.y = 195;
    s.add(band);
    this.updaters.push((dt, time) => {
      const on = Math.sin(time * 3) > 0.6;
      for (const b of blink) b.visible = on;
    });
  }

  /** Vale's conference room: the presentation, the board's table, the city through the glass. */
  _buildOffice() {
    const set = this._set("office", { background: 0x08090c });
    const s = set.scene;
    const kit = this.kit;
    s.add(new THREE.HemisphereLight(0x8b97b0, 0x1b130d, 0.6));
    const key = new THREE.SpotLight(0xffe2c0, 60, 18, 0.7, 0.6, 1.4);
    key.position.set(2, 3.1, 3);
    key.target.position.set(-1, 1, -1);
    s.add(key, key.target);
    const tableLight = new THREE.SpotLight(0xfff0dc, 30, 8, 0.8, 0.7, 1.4);
    tableLight.position.set(3.0, 3.1, 1.8);
    tableLight.target.position.set(3.0, 0.7, 1.8);
    s.add(tableLight, tableLight.target);
    const screenGlow = new THREE.PointLight(0x7fd8ff, 8, 8, 1.6);
    screenGlow.position.set(-1, 2, -2.2);
    s.add(screenGlow);
    const wall = this._own(new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.75 }));
    const panelWall = this._own(new THREE.MeshStandardMaterial({ color: 0x3a3127, roughness: 0.6, map: kit.M.wood.map }));
    const box = this._own(new THREE.BoxGeometry(1, 1, 1));
    const part = (m, sx, sy, sz, x, y, z) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      s.add(mesh);
      return mesh;
    };
    const place = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; s.add(o); return o; };
    // The room: carpet, wood-panelled walls, a ceiling of downlights.
    part(kit.M.carpet, 14, 0.1, 12, 0, -0.05, 0);
    part(panelWall, 14, 3.2, 0.2, 0, 1.6, -3);
    part(wall, 0.2, 3.2, 12, -6, 1.6, 0);
    part(wall, 14, 0.1, 12, 0, 3.25, 0);
    for (let x = -4; x <= 5; x += 2) for (let z = -2; z <= 4; z += 2) {
      const d = new THREE.Mesh(this._own(new THREE.CircleGeometry(0.09, 16)), kit.M.lampGlow);
      d.rotation.x = Math.PI / 2;
      d.position.set(x, 3.19, z);
      s.add(d);
    }
    // The glass wall and the city at night beyond it.
    const city = new THREE.Mesh(this._own(new THREE.PlaneGeometry(12, 3.2)), this._own(new THREE.MeshBasicMaterial({ map: this._own(cityGlassTexture()) })));
    city.position.set(6.05, 1.6, 0);
    city.rotation.y = -Math.PI / 2;
    s.add(city);
    for (let z = -2.6; z <= 5.5; z += 1.6) part(kit.M.darkSteel, 0.08, 3.2, 0.08, 5.95, 1.6, z);
    part(kit.M.darkSteel, 0.12, 0.1, 12, 5.95, 0.05, 0);
    // The presentation screen, in its bezel.
    const slide = this._own(screenTexture([
      ["MERIDIAN INSTITUTE", 22, "#9fd6e6"],
      ["PROJECT ASCENSION", 40, "#ffffff"],
      ["RESONANCE-FIELD CELLULAR RECONSTRUCTION", 16],
      ["PHASE III // HUMAN TRIALS", 20, "#ff9a52"],
    ], { accent: (g, w, h) => {
      g.strokeStyle = "#7fe9ff";
      g.lineWidth = 3;
      for (let i = 0; i < 4; i += 1) { g.beginPath(); g.arc(w - 90, h / 2, 20 + i * 16, 0, Math.PI * 2); g.stroke(); }
    } }));
    part(kit.M.black, 3.8, 2.2, 0.06, -1, 2.1, -2.9);
    const screen = new THREE.Mesh(this._own(new THREE.PlaneGeometry(3.6, 2.0)), this._own(new THREE.MeshBasicMaterial({ map: slide })));
    screen.position.set(-1, 2.1, -2.86);
    s.add(screen);
    // The institute's name on the panelling, and a lectern for Vale.
    const logo = kit.sign([["MERIDIAN", 70], ["INSTITUTE", 34]], { width: 1.5, height: 0.6, bg: "#1b1611", fg: "#c9a46a" });
    place(logo, 2.6, 2.3, -2.89);
    const lectern = new THREE.Group();
    kit.part(lectern, kit.M.darkWood, 0.55, 1.05, 0.4, 0, 0.53, 0, { r: 0.02 });
    kit.part(lectern, kit.M.darkWood, 0.6, 0.04, 0.45, 0, 1.08, 0.03, { r: 0.01, rx: 0.25 });
    const notes = kit.laptop(this._own(new THREE.MeshBasicMaterial({ map: slide })));
    notes.position.set(0, 1.11, 0.03);
    notes.rotation.x = 0.25;
    lectern.add(notes);
    place(lectern, -2.0, 0, -0.9, 0.9);
    // A model of the tower under glass by the window: the institute's pride.
    part(this._own(new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.4, metalness: 0.3 })), 1.2, 0.9, 1.2, 4.6, 0.45, -1.8);
    part(this._own(new THREE.MeshStandardMaterial({ color: 0x8fa6b8, roughness: 0.25, metalness: 0.7, emissive: 0x223344 })), 0.35, 1.6, 0.35, 4.6, 1.7, -1.8);
    part(kit.M.glass, 1.0, 1.9, 1.0, 4.6, 1.85, -1.8);
    // The board's table, its chairs pushed back, laptops still open.
    const table = new THREE.Group();
    kit.part(table, kit.M.darkWood, 1.3, 0.06, 3.6, 0, 0.75, 0, { r: 0.025 });
    for (const z of [-1.1, 1.1]) kit.part(table, kit.M.darkSteel, 0.5, 0.72, 0.12, 0, 0.36, z);
    place(table, 3.0, 0, 1.8);
    const laptopScreen = this._own(new THREE.MeshBasicMaterial({ map: slide }));
    [[2.05, 0.8, 0.15], [3.95, 1.8, -0.1], [2.05, 2.8, 0.4], [3.95, 0.8, 0.2], [3.95, 2.8, -0.3], [2.05, 1.8, 0]].forEach(([x, z, turn], i) => {
      const side = x < 3 ? 1 : -1;
      place(kit.officeChair({ material: kit.M.leather }), x - side * 0.25, 0, z, side * Math.PI / 2 + turn);
      if (i < 4) place(kit.laptop(laptopScreen), 3.0 - side * 0.38, 0.78, z, side * Math.PI / 2);
      place(kit.papers(3, i + 1), 3.0 - side * 0.2, 0.78, z + 0.3, side * 0.3);
      const glass = kit.rod(s, kit.M.glass, 0.035, 0.11, 3.0 - side * 0.15, 0.835, z - 0.3, { seg: 14 });
      glass.castShadow = false;
    });
    place(kit.plant({ height: 1.3, seed: 2 }), -5.4, 0, -2.4);
    place(kit.plant({ height: 1.1, seed: 5 }), 5.4, 0, 5.2);
    place(kit.bookshelf({ width: 1.6, height: 2.2, seed: 4 }), -5.88, 0, 1.8, Math.PI / 2);
    // Vale, presenting.
    const vale = this._person(this.templates.vale, { position: new THREE.Vector3(-2.6, 0, -1.8), heading: -0.9, action: "talk" });
    s.add(vale.root);
    this.updaters.push((dt) => vale.update(dt));
    set.people = { vale };
  }

  /** The operating theatre (the supplied scan): a patient on the table, a surgeon. */
  _buildTheatre() {
    const set = this._set("theatre", { background: 0x0a0c0e });
    const s = set.scene;
    const kit = this.kit;
    s.add(new THREE.HemisphereLight(0xdfeaf0, 0x2a2a2a, 0.9));
    const surgical = new THREE.SpotLight(0xffffff, 70, 9, 0.55, 0.5, 1.2);
    surgical.position.set(0, 3.2, 0);
    surgical.target.position.set(0, 0.8, 0);
    s.add(surgical, surgical.target);
    const room = this.assets.get("operatingRoom");
    if (room) {
      const model = room.template.clone(true);
      // The scan's lighting is baked into its textures: let it show.
      model.traverse((o) => {
        // (Unlit materials show their texture as it is already.)
        if (o.isMesh && o.material?.map && "emissive" in o.material) {
          o.material = this._own(o.material.clone());
          o.material.emissiveMap = o.material.map;
          o.material.emissive = new THREE.Color(0xffffff);
          o.material.emissiveIntensity = 0.55;
        }
      });
      model.position.y = 0;
      s.add(model);
    }
    // The operating table: a padded top on a column and a foot, the patient
    // on it under a sheet from the waist.
    const table = new THREE.Group();
    kit.part(table, kit.M.leather, 0.62, 0.08, 2.0, 0, 0.92, 0, { r: 0.03 });
    kit.part(table, kit.M.steel, 0.66, 0.06, 2.04, 0, 0.86, 0, { r: 0.01 });
    kit.rod(table, kit.M.steel, 0.12, 0.6, 0, 0.5, 0, { seg: 16 });
    kit.part(table, kit.M.steel, 0.5, 0.12, 0.9, 0, 0.06, 0, { r: 0.03 });
    for (const sx of [-1, 1]) kit.part(table, kit.M.chrome, 0.02, 0.02, 1.6, sx * 0.33, 0.9, 0);
    // Arm boards out to the sides.
    kit.part(table, kit.M.leather, 0.5, 0.05, 0.14, -0.55, 0.92, 0.35, { r: 0.02 });
    s.add(table);
    const patient = this._patient({ headNod: -0.2, elbow: 0.1 });
    patient.rotation.x = -Math.PI / 2;
    patient.position.set(0, 0.99, 0.9);
    s.add(patient);
    // (The patient's feet are at +Z: the sheet's hanging end goes there.)
    // Shaped over the legs, the hips and the raised feet (t: 0 feet .. 1 waist).
    const gauss = (d, w) => Math.exp(-(d * d) / (2 * w * w));
    const sheet = kit.drape({ width: 0.62, length: 1.0, top: 0.965, drop: 0.32, edge: 0.31, material: kit.M.gown, seed: 12, segW: 30, segL: 44,
      bump: (x, z) => {
        const t = THREE.MathUtils.clamp((z + 0.5) / 1.0, 0, 1);
        const legs = Math.max(gauss(x - 0.1, 0.075), gauss(x + 0.1, 0.075)) * (0.1 + 0.05 * t);
        const hips = gauss(x, 0.17) * 0.16 * THREE.MathUtils.smoothstep(t, 0.6, 1);
        const feet = Math.max(gauss(x - 0.11, 0.05), gauss(x + 0.11, 0.05)) * 0.16 * (1 - THREE.MathUtils.smoothstep(t, 0.03, 0.12));
        return Math.max(legs, hips, feet);
      } });
    sheet.position.z = 0.45;
    sheet.rotation.y = Math.PI;
    s.add(sheet);
    // A surgeon at the table.
    const surgeonT = this.assets.get("scientistRust")?.template ?? null;
    const surgeon = this._person(surgeonT, { position: new THREE.Vector3(-0.85, 0, -0.2), heading: -Math.PI / 2, action: "hold" });
    s.add(surgeon.root);
    this.updaters.push((dt) => surgeon.update(dt));
  }

  /** The labs below the decks: tanks, and what's in them. */
  _buildLabs() {
    const set = this._set("labs", { background: 0x020604, fog: [0x03100a, 0.06] });
    const s = set.scene;
    const kit = this.kit;
    s.add(new THREE.HemisphereLight(0x2a6a50, 0x050505, 0.5));
    const grate = this._own(gratingTexture());
    grate.repeat.set(7, 15);
    const floor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(14, 30)), this._own(new THREE.MeshStandardMaterial({ color: 0x3a4244, roughness: 0.45, metalness: 0.6, map: grate })));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    // Walls, ceiling, a back wall: the labs are a vault, not a void.
    const wallMat = this._own(new THREE.MeshStandardMaterial({ color: 0x1c2624, roughness: 0.7, metalness: 0.3, map: kit.M.concrete.map }));
    const box = this._own(new THREE.BoxGeometry(1, 1, 1));
    const part = (m, sx, sy, sz, x, y, z) => {
      const mesh = new THREE.Mesh(box, m);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      s.add(mesh);
      return mesh;
    };
    for (const sx of [-1, 1]) {
      part(wallMat, 0.3, 4.4, 30, sx * 5.2, 2.2, 0);
      for (let z = -12; z <= 12; z += 3) part(kit.M.darkSteel, 0.2, 4.4, 0.3, sx * 5.0, 2.2, z);
      part(kit.M.ledGreen, 0.04, 0.04, 30, sx * 4.9, 0.25, 0);
    }
    part(wallMat, 10.4, 4.4, 0.3, 0, 2.2, -10);
    part(wallMat, 10.4, 0.3, 30, 0, 4.4, 0);
    for (const x of [-3.6, -1.4, 1.4, 3.6]) s.add(kit.pipe([[x, 4.05, 12], [x, 4.05, -9.8]], { radius: x > 0 ? 0.09 : 0.06, material: Math.abs(x) > 2 ? kit.M.pipeGrey : kit.M.pipeYellow }));
    for (let z = -9; z <= 9; z += 3) part(kit.M.darkSteel, 10, 0.2, 0.15, 0, 4.15, z);
    const glass = this._own(new THREE.MeshStandardMaterial({ color: 0x9fffd8, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.2, emissive: 0x1a8a5a, emissiveIntensity: 0.6 }));
    const fluid = this._own(new THREE.MeshBasicMaterial({ color: 0x2bd38c, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    const cap = this._own(new THREE.MeshStandardMaterial({ color: 0x2a3034, metalness: 0.8, roughness: 0.35 }));
    const bubbleMat = this._own(new THREE.MeshBasicMaterial({ color: 0xbfffe6, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    const tankGeo = this._own(new THREE.CylinderGeometry(0.85, 0.85, 2.6, 24, 1, true));
    const capGeo = this._own(new THREE.CylinderGeometry(0.95, 0.95, 0.3, 24));
    const bubbleGeo = this._own(new THREE.SphereGeometry(0.025, 6, 4));
    const panelTex = this._own(screenTexture([["VITALS", 30, "#5dff9a"], ["HR 41  BP 82/50", 26], ["SEDATION 92%", 26, "#ffd36a"], ["CELL DRIFT +3.1", 26, "#ff6b4a"]], { bg: "#031208", fg: "#7fffc0" }));
    const panelMat = this._own(new THREE.MeshBasicMaterial({ map: panelTex }));
    const bodies = [];
    const bubbles = [];
    for (let i = 0; i < 6; i += 1) {
      const side = i % 2 ? 1 : -1;
      const z = 2 - Math.floor(i / 2) * 4;
      const x = side * 2.6;
      const tank = new THREE.Mesh(tankGeo, glass);
      tank.position.set(x, 1.6, z);
      const inside = new THREE.Mesh(this._own(new THREE.CylinderGeometry(0.8, 0.8, 2.5, 20)), fluid);
      inside.position.copy(tank.position);
      for (const y of [0.15, 3.05]) {
        const c = new THREE.Mesh(capGeo, cap);
        c.position.set(x, y, z);
        s.add(c);
      }
      // Feeds from the ceiling into the cap; cables from the base to the floor.
      s.add(kit.pipe([[x - 0.35, 3.2, z], [x - 0.35, 4.05, z]], { radius: 0.06, material: kit.M.pipeGrey, brackets: false }));
      s.add(kit.pipe([[x + 0.35, 3.2, z + 0.2], [x + 0.35, 3.8, z + 0.2], [x + 0.35 + side * 1.2, 3.8, z + 0.2], [x + 0.35 + side * 1.2, 4.05, z + 0.2]], { radius: 0.035, material: kit.M.pipeYellow, brackets: false }));
      kit.tube(s, kit.M.black, [new THREE.Vector3(x + side * 0.7, 0.1, z - 0.4), new THREE.Vector3(x + side * 1.3, 0.02, z - 0.5), new THREE.Vector3(x + side * 2.2, 0.02, z - 0.3), new THREE.Vector3(x + side * 2.5, 0.4, z - 0.3)], 0.03);
      // A control pedestal by each tank, its screen facing the aisle.
      const pedestal = new THREE.Group();
      kit.part(pedestal, kit.M.darkSteel, 0.4, 1.1, 0.35, 0, 0.55, 0, { r: 0.02 });
      kit.part(pedestal, kit.M.plasticDark, 0.5, 0.35, 0.06, 0, 1.3, 0.05, { r: 0.015, rx: -0.4 });
      const p = kit.part(pedestal, panelMat, 0.44, 0.29, 0.005, 0, 1.31, 0.085, { rx: -0.4, cast: false });
      p.material = panelMat;
      pedestal.position.set(x - side * 1.2, 0, z + 0.9);
      pedestal.rotation.y = -side * 0.9;
      s.add(pedestal);
      const light = new THREE.PointLight(0x2bd38c, 4, 4.5, 1.8);
      light.position.set(x - side * 0.6, 1.8, z);
      s.add(tank, inside, light);
      // Arms hanging: what they were holding hangs with them.
      const body = this._patient({ reach: 0.05, headNod: 0.5, spread: 0.08, elbow: 0.15 });
      body.position.set(x, 0.35, z);
      body.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      s.add(body);
      bodies.push({ body, phase: i * 1.3 });
      for (let b = 0; b < 10; b += 1) {
        const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
        const a = (b / 10) * Math.PI * 2;
        bubble.position.set(x + Math.cos(a) * 0.55, 0.4 + Math.random() * 2.4, z + Math.sin(a) * 0.55);
        bubble.userData.speed = 0.3 + Math.random() * 0.5;
        s.add(bubble);
        bubbles.push(bubble);
      }
      // A label on each: TRIAL 01..06.
      const label = new THREE.Mesh(this._own(new THREE.PlaneGeometry(0.7, 0.18)), this._own(new THREE.MeshBasicMaterial({ map: this._own(screenTexture([[`TRIAL 0${i + 1}`, 64, "#ff6b4a"]], { bg: "#0b0f0e", w: 256, h: 64 })) })));
      label.position.set(x - side * 0.9, 1.0, z);
      label.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      s.add(label);
    }
    // At the far end: a gurney with a covered body, waiting for a tank.
    const gurney = new THREE.Group();
    kit.part(gurney, kit.M.steel, 0.7, 0.05, 2.0, 0, 0.85, 0, { r: 0.01 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { kit.rod(gurney, kit.M.chrome, 0.02, 0.8, sx * 0.3, 0.43, sz * 0.9); }
    const cover = kit.drape({ width: 0.66, length: 1.9, top: 0.88, drop: 0.25, edge: 0.33, material: kit.M.linen, seed: 21,
      bump: (xx, zz) => Math.max(0, 1 - (xx / 0.22) ** 2) * (zz > 0.6 ? 0.13 : zz > -0.1 ? 0.16 : 0.09) });
    gurney.add(cover);
    gurney.position.set(0.4, 0, -7.6);
    gurney.rotation.y = 0.3;
    s.add(gurney);
    // They float, barely moving; the bubbles rise.
    this.updaters.push((dt, time) => {
      for (const b of bodies) {
        b.body.position.y = 0.35 + Math.sin(time * 0.6 + b.phase) * 0.06;
        b.body.rotation.z = Math.sin(time * 0.4 + b.phase) * 0.04;
      }
      for (const b of bubbles) {
        b.position.y += dt * b.userData.speed;
        if (b.position.y > 2.75) b.position.y = 0.4;
      }
    });
  }

  /** The recovery ward (the same set the game opens in): Subject 07 asleep. */
  _buildWard() {
    const set = this._set("ward", { background: 0x0b0f12 });
    const s = set.scene;
    s.add(new THREE.HemisphereLight(0xdfefff, 0x2a2420, 0.8));
    const sun = new THREE.DirectionalLight(0xfff4e8, 0.45);
    sun.position.set(-3, 8, -4);
    s.add(sun);
    // The ward is built round a run start; put that at -20 so the ward sits near the origin.
    const ward = new WardStage({ startZ: -20 });
    s.add(ward.root);
    ward.root.position.z = -ward.centreZ;
    ward.root.updateMatrixWorld(true);
    this.wardStage = ward;
    this.updaters.push((dt, time) => ward.update(dt, time));
    // Subject 07, asleep: the player's own character, laid in the bed.
    const asset = this.assets.get(this.character);
    const body = new PlayerAvatar();
    if (asset) body.setModel(asset.template);
    body.hold = 0;
    body.update(0.016, { speed: 0 });
    // Arms at rest down the sides.
    if (body.uniforms?.uRest) body.uniforms.uRest.value = 1;
    body.shadow.visible = false;
    const bed = ward.bed;
    const bedX = bed.x;
    const bedZ = bed.z - ward.centreZ;
    // On their back, head toward the headboard (+Z), face to the ceiling -
    // tipped head-up a little, so the head rests on the pillow, not in it.
    const tilt = 0.08;
    body.root.rotation.x = Math.PI / 2 - tilt;
    body.root.position.set(bedX, 0, bedZ - 0.8);
    s.add(body.root);
    this._layInBed(body, bed, bedX, bedZ, s, ward);
    this.updaters.push((dt) => {
      body.update(dt, { speed: 0 });
      // Breathing: the chest rises and falls under the blanket.
      if (body.uniforms) body.uniforms.uLean.value = Math.sin(this.t * 1.4) * 0.008;
    });
    // Okoro, coming in through the door (the last chapter).
    const okoro = this._person(this.templates.okoro, { position: new THREE.Vector3(0.8, 0, -4.6), heading: 0, action: "run" });
    okoro.root.visible = false;
    s.add(okoro.root);
    set.people = { okoro };
    this.updaters.push((dt) => okoro.update(dt, { speed: okoro.speed }));
  }

  /**
   * Settle the sleeper into the bed: measure the body (its vertices, in the
   * bed's frame) so the back rests on the mattress, then cover it with a
   * blanket that follows its real shape - legs, hips, chest, and the arms
   * at its sides.
   */
  _layInBed(body, bed, bedX, bedZ, scene, ward) {
    const mesh = body.model?.getObjectByName("CharacterMerged");
    const top = bed.mattressTop;
    // Bed-local frame: x across, z along (head +Z), y up; the bed is at (bedX, 0, bedZ).
    const grid = { nx: 26, nz: 64, x0: -0.5, x1: 0.5, z0: -1.05, z1: 0.62 };
    const heights = new Float32Array(grid.nx * grid.nz).fill(-1);
    let back = Infinity;
    let midTorso = top + 0.12;
    if (mesh) {
      body.root.updateMatrixWorld(true);
      const pos = mesh.geometry.attributes.position;
      const v = new THREE.Vector3();
      const torsoBand = [];
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const lx = v.x - bedX;
        const lz = v.z - bedZ;
        // The arms are raised in the mesh (a T-pose the shader lowers): leave them out.
        if (Math.abs(lx) > 0.24) continue;
        if (lz > -0.6 && lz < 0.2) back = Math.min(back, v.y);
        if (lz > -0.2 && lz < 0.15) torsoBand.push(v.y);
        const ix = Math.floor(((lx - grid.x0) / (grid.x1 - grid.x0)) * grid.nx);
        const iz = Math.floor(((lz - grid.z0) / (grid.z1 - grid.z0)) * grid.nz);
        if (ix < 0 || iz < 0 || ix >= grid.nx || iz >= grid.nz) continue;
        heights[iz * grid.nx + ix] = Math.max(heights[iz * grid.nx + ix], v.y);
      }
      // Rest the back a couple of centimetres into the mattress.
      const lift = Number.isFinite(back) ? top - 0.02 - back : 0.8;
      body.root.position.y += lift;
      for (let i = 0; i < heights.length; i += 1) if (heights[i] > 0) heights[i] += lift;
      if (torsoBand.length) {
        torsoBand.sort((a, b) => a - b);
        midTorso = (torsoBand[0] + torsoBand[torsoBand.length - 1]) / 2 + lift;
      }
    } else {
      body.root.position.y = top + 0.12;
    }
    // The arms at the sides (lowered by the shader, so not in the mesh):
    // from the shoulders to just past the hips.
    for (let iz = 0; iz < grid.nz; iz += 1) {
      const lz = grid.z0 + ((iz + 0.5) / grid.nz) * (grid.z1 - grid.z0);
      if (lz < -0.35 || lz > 0.3) continue;
      for (let ix = 0; ix < grid.nx; ix += 1) {
        const lx = grid.x0 + ((ix + 0.5) / grid.nx) * (grid.x1 - grid.x0);
        const d = Math.abs(Math.abs(lx) - 0.27);
        if (d < 0.06) heights[iz * grid.nx + ix] = Math.max(heights[iz * grid.nx + ix], midTorso + 0.055 * Math.sqrt(1 - (d / 0.06) ** 2));
      }
    }
    // Cloth bridges the dips: blur, then never below the mattress.
    const h = Float32Array.from(heights, (y) => Math.max(y, top) - top);
    for (let pass = 0; pass < 3; pass += 1) {
      const copy = h.slice();
      for (let iz = 0; iz < grid.nz; iz += 1) for (let ix = 0; ix < grid.nx; ix += 1) {
        let m = copy[iz * grid.nx + ix];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jx = ix + dx;
          const jz = iz + dz;
          if (jx >= 0 && jz >= 0 && jx < grid.nx && jz < grid.nz) m = Math.max(m, copy[jz * grid.nx + jx] * 0.95);
        }
        h[iz * grid.nx + ix] = m;
      }
    }
    const sample = (lx, lz) => {
      const fx = ((lx - grid.x0) / (grid.x1 - grid.x0)) * grid.nx - 0.5;
      const fz = ((lz - grid.z0) / (grid.z1 - grid.z0)) * grid.nz - 0.5;
      const ix = Math.max(0, Math.min(grid.nx - 2, Math.floor(fx)));
      const iz = Math.max(0, Math.min(grid.nz - 2, Math.floor(fz)));
      const tx = THREE.MathUtils.clamp(fx - ix, 0, 1);
      const tz = THREE.MathUtils.clamp(fz - iz, 0, 1);
      const at = (a, b) => h[b * grid.nx + a];
      return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
    };
    // The blanket: from the foot of the bed to the chest.
    const from = -1.0;
    const to = 0.32;
    const length = to - from;
    const blanket = this.kit.drape({
      width: 0.98, length, top: top + 0.012, drop: 0.3, edge: 0.47, material: this.kit.M.blanket, segW: 36, segL: 60, seed: 4,
      bump: (x, z) => sample(x, z + from + length / 2) + 0.03 + 0.02 * THREE.MathUtils.smoothstep(z + from + length / 2, -0.3, 0.2),
    });
    blanket.position.set(bedX, 0, bedZ + from + length / 2);
    scene.add(blanket);
    // The sheet folded back over its top edge, across the chest.
    const fold = this.kit.drape({
      width: 0.98, length: 0.14, top: top + 0.02, drop: 0.12, edge: 0.47, foot: false, material: this.kit.M.linen, segW: 36, segL: 6, seed: 9,
      bump: (x, z) => sample(x, z + to - 0.07) + 0.06,
    });
    fold.position.set(bedX, 0, bedZ + to - 0.07);
    scene.add(fold);
    // The made bed's own flat blanket goes: this one covers them.
    ward.bed.root.traverse((o) => { if (o.userData.cover) o.visible = false; });
  }

  /** Okoro's office, late: sending everything to the police. */
  _buildLeak() {
    const set = this._set("leak", { background: 0x040506 });
    const s = set.scene;
    const kit = this.kit;
    s.add(new THREE.HemisphereLight(0x3a4458, 0x0a0806, 0.35));
    const screenLight = new THREE.PointLight(0x8fd8ff, 9, 5, 1.8);
    screenLight.position.set(0.4, 1.3, -0.3);
    s.add(screenLight);
    const lamp = new THREE.PointLight(0xffc98a, 6, 4, 1.8);
    lamp.position.set(1.05, 1.25, -0.75);
    s.add(lamp);
    const place = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; s.add(o); return o; };
    const floor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(10, 10)), kit.M.carpet);
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const wallMat = this._own(new THREE.MeshStandardMaterial({ color: 0x272a30, roughness: 0.9 }));
    const wall = new THREE.Mesh(this._own(new THREE.PlaneGeometry(10, 4)), wallMat);
    wall.position.set(0, 2, -1.6);
    s.add(wall);
    const side = new THREE.Mesh(this._own(new THREE.PlaneGeometry(10, 4)), wallMat);
    side.position.set(-2.4, 2, 1);
    side.rotation.y = Math.PI / 2;
    s.add(side);
    // The other wall: a window onto the city, blinds half down.
    const right = new THREE.Mesh(this._own(new THREE.PlaneGeometry(10, 4)), wallMat);
    right.position.set(2.6, 2, 1);
    right.rotation.y = -Math.PI / 2;
    s.add(right);
    const night = this._own(new THREE.MeshBasicMaterial({ map: this._own(cityGlassTexture()) }));
    place(kit.blindWindow({ width: 1.8, height: 1.3, night }), 2.58, 1.55, 0.6, -Math.PI / 2);
    // The desk (the supplied model, or a slab).
    const desk = this.assets.get("officeDesk");
    let deskTop = 0.75;
    if (desk) {
      const model = desk.template.clone(true);
      model.scale.setScalar(1.6 / Math.max(desk.size.x, desk.size.z));
      model.position.set(0.4, 0, -0.6);
      s.add(model);
      deskTop = desk.size.y * model.scale.y;
    } else {
      const slab = new THREE.Mesh(this._own(new THREE.BoxGeometry(1.6, 0.06, 0.8)), this._own(new THREE.MeshStandardMaterial({ color: 0x555b60 })));
      slab.position.set(0.4, 0.75, -0.6);
      s.add(slab);
    }
    // The monitor: the upload.
    this.leakCanvas = document.createElement("canvas");
    this.leakCanvas.width = 512;
    this.leakCanvas.height = 300;
    this.leakTex = this._own(new THREE.CanvasTexture(this.leakCanvas));
    this.leakTex.colorSpace = THREE.SRGBColorSpace;
    const monitor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(0.62, 0.36)), this._own(new THREE.MeshBasicMaterial({ map: this.leakTex })));
    monitor.position.set(0.45, 1.13, -0.85);
    monitor.rotation.y = -0.15;
    s.add(monitor);
    const bezel = kit.part(s, kit.M.plasticDark, 0.66, 0.4, 0.03, 0.45, 1.13, -0.868, { r: 0.008, ry: -0.15 });
    bezel.castShadow = false;
    kit.rod(s, kit.M.plasticDark, 0.02, Math.max(0.05, 0.93 - deskTop), 0.45, (0.93 + deskTop) / 2, -0.9);
    // On the desk: the lamp, a keyboard, a mug, the files he printed.
    place(kit.deskLamp(), 1.05, deskTop, -0.8, -0.6);
    kit.part(s, kit.M.plasticDark, 0.44, 0.02, 0.14, 0.4, deskTop + 0.01, -0.45, { r: 0.006 });
    place(kit.mug(0x7a2b22), -0.15, deskTop, -0.55);
    place(kit.papers(7, 3), 0.95, deskTop, -0.45, 0.4);
    place(kit.papers(4, 6), -0.25, deskTop, -0.8, -0.2);
    // His chair, under him; the room round him.
    place(kit.officeChair({ material: kit.M.fabricDark, seat: 0.44 }), 0.2, 0, 0.32, Math.PI - 0.1);
    place(kit.bookshelf({ width: 1.4, height: 2.1, seed: 9 }), -1.4, 0, -1.58);
    place(kit.filingCabinet(), 1.9, 0, -1.25);
    place(kit.plant({ height: 0.9, seed: 7 }), -2.0, 0, 0.6);
    place(kit.wallClock(), 1.2, 2.3, -1.58);
    const diploma = kit.sign([["UNIVERSITY OF THE CAPE", 22], ["MBChB  //  ANAESTHESIOLOGY", 18], ["E. OKORO", 26]], { width: 0.5, height: 0.36, bg: "#efe6d0", fg: "#3a2a18" });
    place(diploma, 0.4, 1.95, -1.585);
    kit.part(s, kit.M.darkWood, 0.56, 0.42, 0.02, 0.4, 1.95, -1.6);
    const okoro = this._person(this.templates.okoro, { position: new THREE.Vector3(0.2, 0, 0.25), heading: -0.1, action: "sit" });
    s.add(okoro.root);
    okoro.lookAt(new THREE.Vector3(0.45, 1.13, -0.85), 0.8);
    this.updaters.push((dt) => okoro.update(dt));
    this._leakT = 0;
  }

  _drawLeak(k) {
    const g = this.leakCanvas.getContext("2d");
    const w = this.leakCanvas.width;
    const h = this.leakCanvas.height;
    g.fillStyle = "#03101a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#7fe9ff";
    g.font = "bold 22px monospace";
    g.fillText("SECURE TRANSFER", 24, 40);
    g.font = "16px monospace";
    const files = ["TRIAL_01-06_CASE_RECORDS.zip", "CONSENT_FORMS_SCANNED.pdf", "SUBJECT_07_FIELD_DATA.raw", "VALE_BOARD_MINUTES.mp4"];
    files.forEach((f, i) => {
      const done = k > (i + 1) / (files.length + 1);
      g.fillStyle = done ? "#5dff9a" : "#7fa9b8";
      g.fillText(`${done ? "SENT" : "...."}  ${f}`, 24, 84 + i * 30);
    });
    g.fillStyle = "#1d3340";
    g.fillRect(24, 220, w - 48, 18);
    g.fillStyle = "#5dff9a";
    g.fillRect(24, 220, (w - 48) * Math.min(1, k), 18);
    g.fillStyle = "#ffffff";
    g.font = "bold 18px monospace";
    g.fillText(k >= 1 ? "DELIVERED: CITY POLICE // MAJOR CRIMES" : `UPLOADING  ${Math.floor(Math.min(1, k) * 100)}%`, 24, 270);
    this.leakTex.needsUpdate = true;
  }

  /** The control room: the charges armed, the clock started. */
  _buildControl() {
    const set = this._set("control", { background: 0x060203 });
    const s = set.scene;
    const kit = this.kit;
    s.add(new THREE.HemisphereLight(0x4a2a2a, 0x080404, 0.4));
    this.alarm = new THREE.PointLight(0xff2a1a, 14, 9, 1.6);
    this.alarm.position.set(0, 2.8, 0.5);
    s.add(this.alarm);
    const place = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; s.add(o); return o; };
    const floor = new THREE.Mesh(this._own(new THREE.PlaneGeometry(12, 12)), this._own(new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.5, metalness: 0.4, map: this._own(gratingTexture()) })));
    floor.material.map.repeat.set(6, 6);
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const wallMat = this._own(new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0.5 }));
    kit.part(s, wallMat, 12, 3.6, 0.2, 0, 1.8, -2.4, { cast: false });
    kit.part(s, wallMat, 0.2, 3.6, 12, -4.2, 1.8, 0, { cast: false });
    kit.part(s, wallMat, 0.2, 3.6, 12, 4.2, 1.8, 0, { cast: false });
    kit.part(s, wallMat, 12, 0.2, 12, 0, 3.6, 0, { cast: false });
    const armed = this._own(screenTexture([
      ["HALCYON // DEMOLITION", 22, "#ff9a8a"],
      ["SEQUENCE ARMED", 42, "#ff3a2a"],
      ["CHARGES: 212 FLOORS", 18, "#ffd1c8"],
      ["T-MINUS 30:00", 34, "#ffffff"],
    ], { bg: "#1a0404" }));
    const armedMat = this._own(new THREE.MeshBasicMaterial({ map: armed }));
    // The main board and a wall of smaller screens round it: floor plans, the
    // charges floor by floor, the cameras.
    kit.part(s, kit.M.black, 2.6, 1.5, 0.08, 0, 1.85, -2.26);
    const screen = new THREE.Mesh(this._own(new THREE.PlaneGeometry(2.4, 1.35)), armedMat);
    screen.position.set(0, 1.85, -2.21);
    s.add(screen);
    const small = [
      this._own(new THREE.MeshBasicMaterial({ map: this._own(screenTexture([["FLOORS 170-212", 30, "#ff6b4a"], ["CHARGES SET", 26, "#ffd1c8"], ["DET CORD OK", 26, "#5dff9a"]], { bg: "#140405" })) })),
      this._own(new THREE.MeshBasicMaterial({ map: this._own(screenTexture([["CAM 14 // WARD 4", 26, "#c8d6e0"], ["- NO SIGNAL -", 34, "#7a8a96"]], { bg: "#0b0e12" })) })),
      this._own(new THREE.MeshBasicMaterial({ map: this._own(screenTexture([["EVAC: DISABLED", 30, "#ff3a2a"], ["LIFTS: LOCKED", 28, "#ffb030"], ["ROOF: PAD 1 CLEAR", 24, "#5dff9a"]], { bg: "#0a0406" })) })),
      this._own(new THREE.MeshBasicMaterial({ map: this._own(screenTexture([["CAM 02 // SKYBRIDGE", 26, "#c8d6e0"], ["MOTION: NONE", 30, "#7a8a96"]], { bg: "#0b0e12" })) })),
    ];
    [[-2.2, 2.4], [2.2, 2.4], [-2.2, 1.4], [2.2, 1.4]].forEach(([x, y], i) => {
      kit.part(s, kit.M.black, 1.36, 0.82, 0.06, x, y, -2.27);
      const m = new THREE.Mesh(this._own(new THREE.PlaneGeometry(1.26, 0.72)), small[i]);
      m.position.set(x, y, -2.23);
      s.add(m);
    });
    // The consoles: the front row under the board, a second row behind.
    place(kit.consoleDesk({ width: 3.4, screens: [small[0], armedMat, small[2]] }), 0, 0, -1.35);
    place(kit.consoleDesk({ width: 2.4, screens: [small[1], small[3]] }), -1.9, 0, 1.0, 0.2);
    place(kit.officeChair({ material: kit.M.leather }), -0.9, 0, -0.55, Math.PI + 0.3);
    place(kit.officeChair({ material: kit.M.leather }), -2.2, 0, 1.8, Math.PI + 0.6);
    // Server racks down the sides, blinking.
    const racks = [];
    for (const [x, z, ry] of [[-3.7, -1.4, Math.PI / 2], [-3.7, -0.7, Math.PI / 2], [3.7, -1.4, -Math.PI / 2], [3.7, -0.7, -Math.PI / 2], [3.7, 0.0, -Math.PI / 2]]) {
      racks.push(place(kit.serverRack({ seed: Math.round(x * 10 + z * 3 + 50) }), x, 0, z, ry));
    }
    // Cable trays overhead, and the red beacons that turned on with the order.
    kit.part(s, kit.M.darkSteel, 0.4, 0.05, 6, 1.6, 3.2, 0);
    kit.part(s, kit.M.darkSteel, 0.4, 0.05, 6, -1.6, 3.2, 0);
    const beacons = [];
    for (const x of [-2.6, 2.6]) {
      const b = new THREE.Group();
      kit.rod(b, kit.M.ledRed, 0.08, 0.14, 0, 0, 0, { seg: 14 });
      kit.part(b, kit.M.black, 0.18, 0.12, 0.02, 0, 0, 0.05);
      place(b, x, 3.3, -2.0);
      beacons.push(b);
    }
    const order = kit.sign([["HALCYON", 54], ["BUILDING CONTROL", 26]], { width: 1.4, height: 0.42, bg: "#16181a", fg: "#ff6b4a" });
    place(order, 0, 3.0, -2.22);
    // Off to the side, so the screen reads past him.
    const vale = this._person(this.templates.vale, { position: new THREE.Vector3(1.2, 0, -0.35), heading: Math.PI + 0.35, action: "point" });
    s.add(vale.root);
    this.updaters.push((dt, time) => {
      vale.update(dt);
      this.alarm.intensity = 8 + Math.max(0, Math.sin(time * 6)) * 14;
      for (const r of racks) r.userData.tick?.(time);
      for (const b of beacons) b.rotation.y = time * 6;
    });
  }

  /* ---------------- Playing it ---------------- */

  /** Roll the film; `onDone` when it's over (or skipped). */
  start(onDone) {
    this.onDone = onDone;
    this.active = true;
    this.t = 0;
    this.chapter = -1;
    this.narrated.clear();
    this.voice?.preload(CHAPTERS.map((c) => ({ who: "narrator", text: c.text })));
    this.ended = false;
    this.ui.root.hidden = false;
    this.ui.end.classList.remove("show");
    this.ui.fade.style.opacity = "1";
    this._resize();
  }

  /** Cut it short: straight back. */
  skip() {
    if (!this.active) return;
    this._finish();
  }

  _finish() {
    this.active = false;
    this.voice?.stop();
    this.ui.root.hidden = true;
    this.ui.card.classList.remove("show");
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  _resize() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();
  }

  /** Where in the film: { index, chapter, local time, k 0..1 }. */
  _at(t) {
    let start = 0;
    for (const [index, chapter] of CHAPTERS.entries()) {
      if (t < start + chapter.seconds) return { index, chapter, local: t - start, k: (t - start) / chapter.seconds };
      start += chapter.seconds;
    }
    return null;
  }

  get duration() {
    return CHAPTERS.reduce((a, c) => a + c.seconds, 0);
  }

  update(dt, time) {
    if (!this.active) return;
    this.t += dt;
    const at = this._at(this.t);
    if (!at) {
      // The end: the title on black, then back to the menu.
      const end = this.t - this.duration;
      this.ui.card.classList.remove("show");
      this.ui.fade.style.opacity = "1";
      this.ui.end.classList.toggle("show", end > 0.4 && end < 3.6);
      if (end > 4.4) this._finish();
      return;
    }
    const { index, chapter, local, k } = at;
    if (index !== this.chapter) this._enterChapter(index, chapter);
    // The narrator reads the caption as it types out.
    if (local >= NARRATION_AT && !this.narrated.has(index)) {
      this.narrated.add(index);
      this.voice?.say({ who: "narrator", text: chapter.text });
    }
    // Fade through black between chapters.
    const fade = Math.max(1 - smooth(local, 0, 0.7), smooth(local, chapter.seconds - 0.6, chapter.seconds));
    this.ui.fade.style.opacity = fade.toFixed(3);
    // Type the caption out.
    const chars = Math.floor(Math.max(0, local - 0.8) * 42);
    this.ui.text.textContent = chapter.text.slice(0, chars);
    // The camera's move, with a little drift.
    const e = smooth(k, 0, 1);
    const p = (a, b) => new THREE.Vector3().fromArray(a).lerp(new THREE.Vector3().fromArray(b), e);
    this.camera.position.copy(p(chapter.from.pos, chapter.to.pos));
    this.camera.position.x += Math.sin(time * 0.37) * 0.03;
    this.camera.position.y += Math.sin(time * 0.53) * 0.02;
    this.camera.lookAt(p(chapter.from.look, chapter.to.look));
    for (const u of this.updaters) u(dt, time);
    if (chapter.set === "leak") this._drawLeak(smooth(local, 1.5, chapter.seconds - 1.5));
    // Thicker haze for the police shot, so the searchlight beams show in it.
    if (chapter.set === "city" && this.sets.city.scene.fog) this.sets.city.scene.fog.density = chapter.police ? 0.0036 : 0.0028;
    if (chapter.police) {
      this.police.root.visible = true;
      // Lifted to the institute's floors (they fly at a bridge's height), lights on the tower.
      this.police.update(dt, time, { worldZ: (d) => 90 - d, distance: 0, deckY: 75, overDeck: true, cityY: -115, spotZ: 0, spotSpread: 16 });
    }
    if (chapter.okoroArrives) {
      const okoro = this.sets.ward.people.okoro;
      okoro.root.visible = true;
      const run = smooth(local, 0.6, 4);
      // In through the door, up beside the bed - then turned to the patient.
      okoro.root.position.set(0.8 - run * 0.9, 0, -4.6 + run * 5.6);
      okoro.root.rotation.y = Math.PI - 0.16 - smooth(local, 3.6, 4.4) * (Math.PI / 2 - 0.16);
      okoro.act(run < 1 ? "run" : "talk");
      okoro.speed = run < 1 ? 4 : 0;
      okoro.lookAt(new THREE.Vector3(-1.4, 0.9, 2.2), 1);
    }
  }

  _enterChapter(index, chapter) {
    this.chapter = index;
    this.current = this.sets[chapter.set];
    this.police.root.visible = !!chapter.police;
    this.sets.ward.people.okoro.root.visible = !!chapter.okoroArrives;
    this.ui.tag.textContent = `${chapter.tag} // PROJECT ASCENSION`;
    this.ui.title.textContent = chapter.title;
    this.ui.text.textContent = "";
    this.ui.card.classList.remove("show");
    void this.ui.card.offsetWidth;
    this.ui.card.classList.add("show");
    [...this.ui.dots.children].forEach((d, i) => d.classList.toggle("on", i <= index));
    this.camera.fov = chapter.set === "city" ? 38 : 50;
    this.camera.updateProjectionMatrix();
  }

  render() {
    if (!this.active || !this.current) return;
    this.renderer.render(this.current.scene, this.camera);
  }

  dispose() {
    this.active = false;
    this.ui.root.remove();
    this.wardStage?.dispose();
    this.police?.dispose();
    for (const x of this.owned) x.dispose?.();
    this.owned.length = 0;
  }
}
