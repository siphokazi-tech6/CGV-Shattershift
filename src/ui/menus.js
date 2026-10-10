/**
 * The menus' moving parts: the sphere picker (the main menu's loadout and
 * the pause menu), the power-up cards with a picture of each capsule, the
 * pause menu's tabs, and its list of moves for the sector you are in.
 *
 * The capsule pictures are the real thing: each serum's capsule
 * (src/systems/spheres.js) rendered once into a small image, so the card
 * shows exactly what floats along the route.
 */

import * as THREE from "../three.js";
import { BALLS, BALL_ORDER, SERUMS, SERUM_ORDER } from "../systems/arsenal.js";
import { serumPickup } from "../systems/spheres.js";

const BALL_KEY = "fractureRun.ball";

/** The sphere picked in the menu (remembered), or glass. */
export function savedBall() {
  try {
    const key = localStorage.getItem(BALL_KEY);
    if (BALLS[key]) return key;
  } catch (error) {}
  return "glass";
}

function saveBall(key) {
  try { localStorage.setItem(BALL_KEY, key); } catch (error) {}
}

const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

/**
 * Every [data-ball-pick] on the page becomes a sphere picker.
 * @param {(key: string) => void} onPick
 * @returns {{show: (key: string) => void}}
 */
export function buildBallPickers(onPick) {
  const pickers = [...document.querySelectorAll("[data-ball-pick]")];
  for (const picker of pickers) {
    picker.innerHTML = BALL_ORDER.map((k) => {
      const b = BALLS[k];
      return `<button type="button" class="ball-card" data-ball="${k}" style="--c:${hex(b.colour)}" aria-pressed="false">
        <i class="orb" aria-hidden="true"></i>
        <span><b>${b.name}</b><small>${b.text}</small></span>
        <em>costs ${b.cost} sphere${b.cost > 1 ? "s" : ""}</em>
      </button>`;
    }).join("");
    for (const button of picker.querySelectorAll("[data-ball]")) {
      button.addEventListener("click", () => {
        saveBall(button.dataset.ball);
        onPick(button.dataset.ball);
        show(button.dataset.ball);
      });
    }
  }
  function show(key) {
    for (const button of document.querySelectorAll("[data-ball-pick] [data-ball]")) {
      const on = button.dataset.ball === key;
      button.classList.toggle("picked", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }
  show(savedBall());
  return { show };
}

/* ------------------------------------------------------------------ */
/* Power-up cards                                                       */
/* ------------------------------------------------------------------ */

let serumPictures = null;

/** One serum's capsule picture (a data URL), or null without WebGL to spare. */
export function serumPicture(type) {
  return renderSerumPictures().get(type) ?? null;
}

/** Each serum's capsule, rendered once (192 px, transparent). */
function renderSerumPictures() {
  if (serumPictures) return serumPictures;
  serumPictures = new Map();
  let renderer;
  try {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch (error) {
    return serumPictures; // no WebGL to spare: the cards draw a glow instead
  }
  renderer.setSize(192, 192, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.set(0.5, 0.35, 2.6);
  camera.lookAt(0, 0, 0);
  for (const type of SERUM_ORDER) {
    const pickup = serumPickup(type);
    pickup.tick(0, 1.7);
    pickup.root.rotation.y = 0.4;
    scene.add(pickup.root);
    renderer.render(scene, camera);
    serumPictures.set(type, renderer.domElement.toDataURL("image/png"));
    scene.remove(pickup.root);
    for (const m of pickup.materials) m.dispose();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return serumPictures;
}

/** Fill every [data-serum-cards] with a card per serum. */
export function buildSerumCards() {
  const pictures = renderSerumPictures();
  for (const holder of document.querySelectorAll("[data-serum-cards]")) {
    holder.innerHTML = SERUM_ORDER.map((k) => {
      const s = SERUMS[k];
      const art = pictures.get(k) ? `<img src="${pictures.get(k)}" alt="">` : `<i class="serum-art" aria-hidden="true"></i>`;
      const lasts = s.charges ? `${s.charges} hits or ${s.duration} s` : `${s.duration} s`;
      return `<article class="serum-card" style="--c:${s.colour}">${art}
        <div><b>${s.name}</b><p>${s.text}</p><small>Lasts ${lasts}</small></div></article>`;
    }).join("");
  }
}

/* ------------------------------------------------------------------ */
/* Moves                                                                */
/* ------------------------------------------------------------------ */

const k = (...keys) => keys.map((key) => `<kbd>${key}</kbd>`).join("");

/** [keys, what it does, the sectors it belongs to (none: everywhere)] */
const MOVES = [
  [k("A", "D"), "Change lane", ["foundry", "labs", "skyline"]],
  [k("Space"), "Jump <small>(or W / up in the Foundry and the Labs)</small>", ["foundry", "labs", "skyline"]],
  [k("Shift"), "Slide - in the air, slam down into it <small>(or S / down in the Foundry and the Labs)</small>", ["foundry", "labs", "skyline"]],
  [k("W", "S"), "Sprint and brake <small>(the bridge falls behind you)</small>", ["skyline"]],
  [k("W", "A", "S", "D"), "Move about the roof", ["roof"]],
  [k("Space"), "Dodge; jump for the ladder when it comes down", ["roof"]],
  [k("Mouse"), "Aim"],
  [k("Click"), "Throw a sphere <small>(by hand in the Foundry)</small>", ["foundry", "skyline"]],
  [k("Hold click"), "Fire the launcher <small>- it overheats</small>", ["labs", "roof"]],
  [k("RMB"), "Focus: slow time while you aim"],
  [k("Q", "E"), "Sphere type <small>(or the mouse wheel)</small>"],
  [k("Space"), "Tap fast to push a fallen duct out of the way", ["labs"]],
  [k("C"), "Change camera"],
  [k("P"), "Photo mode", ["foundry", "skyline"]],
  [k("V"), "Choose what the HUD shows; " + k("H") + " hides it all"],
  [k("M"), "Minimap"],
  [k("Esc"), "Pause; hold it to skip a cutscene"],
];

/**
 * The pause menu's moves for where you are: the ones for this sector first
 * and highlighted, then everything else that works here.
 * @param {"foundry"|"labs"|"skyline"|"roof"|null} where
 */
export function showMoves(where) {
  const list = document.querySelector("[data-moves]");
  const note = document.querySelector("[data-moves-where]");
  if (!list) return;
  const names = { foundry: "Sector 01 - the Foundry", labs: "Sector 02 - the Labs", skyline: "Sector 03 - the Skyline", roof: "The Roof" };
  if (note) note.textContent = where ? `Moves in ${names[where]}.` : "Moves in every sector.";
  const here = MOVES.filter(([, , only]) => only && (!where || only.includes(where)));
  const everywhere = MOVES.filter(([, , only]) => !only);
  list.innerHTML = [...here.map((m) => [m, true]), ...everywhere.map((m) => [m, false])]
    .map(([[keys, text], mine]) => `<div class="${mine ? "here" : ""}" style="display:contents"><dt>${keys}</dt><dd>${text}</dd></div>`)
    .join("");
}

/** The pause menu's tabs. */
export function buildTabs() {
  for (const tabs of document.querySelectorAll(".tabs")) {
    const card = tabs.parentElement;
    for (const tab of tabs.querySelectorAll("[data-tab]")) {
      tab.addEventListener("click", () => {
        for (const t of tabs.querySelectorAll("[data-tab]")) {
          const on = t === tab;
          t.classList.toggle("on", on);
          t.setAttribute("aria-selected", String(on));
        }
        for (const panel of card.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== tab.dataset.tab;
        if (tab.dataset.tab === "serums") buildSerumCards();
      });
    }
  }
}
