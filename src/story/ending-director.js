/**
 * The ending, staged on the roof (Phase 6). MeltdownGame starts one when the
 * story's roof ending (the climb, or the leap for the ladder) is over:
 *
 *   ending scene (cabin, the reveal, outside)  -> title on black
 *     -> credits roll -> the game's own end screen
 *
 * The cabin (stages/cabin.js) flies away from the tower on its own path; the
 * roof keeps burning under it. For the shot from outside, the real
 * helicopter model is put where the cabin is and flies on.
 */

import * as THREE from "../three.js";
import { Companion } from "./companion.js";
import { CabinStage } from "./stages/cabin.js";
import { endingScene, titleScene, creditsScene } from "./scenes-ending.js";
import { creditsHTML } from "./credits-roll.js";
import { EDGE } from "../levels/meltdown/roof.js";

/**
 * Where the flight out starts (east of the roof, above it) and how it goes:
 * nose north (-Z), so the open door on the cabin's left looks back west at
 * the burning tower as it falls behind.
 */
const START = new THREE.Vector3(EDGE + 22, 24, 2);
const VELOCITY = new THREE.Vector3(2.6, 2.0, -8.5);
/** The shot from outside: off the east edge, climbing away, gathering speed. */
const OUT_START = new THREE.Vector3(EDGE + 8, 9, -4);
const OUT_VELOCITY = new THREE.Vector3(3, 2.4, -6);
const OUT_ACCEL = new THREE.Vector3(1.5, 1.2, -5);

const _q = new THREE.Quaternion();

export class EndingDirector {
  /**
   * @param {import("../levels/meltdown/game.js").MeltdownGame} game
   * @param {object} story  { layer, valeTemplate }
   * @param {(skippedCredits:boolean) => void} onDone
   */
  constructor(game, story, onDone) {
    this.game = game;
    this.layer = story.layer;
    this.onDone = onDone;
    this.t = 0;
    this.log = [];
    this.stage = "ending";

    const cabin = new CabinStage();
    this.cabin = cabin;
    cabin.root.position.copy(START);
    game.scene.add(cabin.root);

    // The pilot: Dr. Vale, sat facing the nose (no helmet - his head over the seat back).
    const vale = new Companion();
    vale.setModel(story.valeTemplate?.());
    vale.root.position.copy(cabin.anchors.pilot);
    vale.root.rotation.y = 0;
    vale.act("sit");
    vale.shadow.visible = false;
    cabin.root.add(vale.root);
    this.vale = vale;
    this.turn = 0;

    game.avatar.setVisible(false);
    game.avatar.shadow.visible = false;
    if (game.roof?.heli) game.roof.heli.root.visible = false;

    const a = cabin.anchors;
    const world = (local) => () => cabin.world(local, new THREE.Vector3());
    const scene = endingScene({
      seatEye: world(a.seatEye),
      doorLook: () => cabin.world(a.doorLook, new THREE.Vector3()),
      pilotBack: world(a.pilotBack),
      pilotFace: () => vale.headPosition(new THREE.Vector3()),
      outside: () => this._outside(),
      turn: (k) => (this.turn = k),
    });
    this.scene = scene;
    this.layer.play(scene, {
      camera: game.camera,
      on: {
        event: (name) => this._event(name),
        done: () => this._title(),
      },
    });
  }

  _event(name) {
    const game = this.game;
    this.log.push(["event", name]);
    // (His laugh is the scene's "[laughs]": the voice plays it.)
    if (name === "outside") {
      // The tower behind, still coming down.
      game.sfx?.buildingCollapse(0.55);
      // Outside: the real helicopter where the cabin is, flying on.
      this.cabin.root.visible = false;
      this.outsideT = this.t;
    }
  }

  /** The camera outside: low on the roof, watching it lift away into the smoke. */
  _outside() {
    const heli = this.game.roof?.heli;
    const at = heli && this.outsideT !== undefined ? heli.root.position : OUT_START;
    return {
      pos: new THREE.Vector3(EDGE - 6, 2.2, 10),
      look: at.clone().add(new THREE.Vector3(0, 1.5, 0)),
    };
  }

  _title() {
    this.stage = "title";
    const ui = this.layer.ui;
    this.layer.play(titleScene(ui), {
      camera: null,
      on: {
        event: (name) => this.log.push(["event", name]),
        done: () => this._credits(),
      },
    });
  }

  _credits() {
    this.stage = "credits";
    this.creditsT = 0;
    const ui = this.layer.ui;
    ui.title(null);
    this.layer.play(creditsScene(ui, creditsHTML()), {
      camera: null,
      on: {
        event: (name) => this.log.push(["event", name]),
        done: ({ skipped }) => {
          this.stage = "done";
          ui.credits(null);
          this.onDone?.(skipped);
        },
      },
    });
  }

  /** Every frame of the finale: the flight, the pilot, the helicopter outside. */
  update(dt, time) {
    this.t += dt;
    if (this.stage === "credits") this._creditsShot(dt);
    const cabin = this.cabin;
    // Pulling away from the tower, slowly (the view out of the door is the
    // point), banking a little, riding the air.
    cabin.root.position.copy(START).addScaledVector(VELOCITY, this.t * 0.22);
    cabin.root.position.y += Math.sin(time * 1.3) * 0.12;
    cabin.root.rotation.set(-0.06 + Math.sin(time * 0.9) * 0.025, -0.3, 0.05 + Math.sin(time * 0.7) * 0.03);
    cabin.update(dt, time);
    // The pilot turns round in his seat at the reveal (the seat with him).
    const vale = this.vale;
    vale.root.rotation.y = this.turn * 2.75;
    cabin.seat.rotation.y = vale.root.rotation.y;
    vale.lookAt(this.turn > 0.5 ? this.game.camera.position : null, 0.9);
    // Seated throughout; once he's facing you, he talks with his shoulders.
    vale.act("sit");
    vale.adjust.twist = this.turn > 0.95 ? Math.sin(time * 1.7) * 0.08 : 0;
    vale.adjust.headNod = this.turn > 0.95 ? Math.sin(time * 2.3) * 0.05 - 0.12 : 0;
    vale.update(dt);
    // Outside: the helicopter model, off the roof's edge and away.
    const heli = this.game.roof?.heli;
    if (heli && this.outsideT !== undefined) {
      const k = this.t - this.outsideT;
      heli.root.visible = true;
      heli.root.position.copy(OUT_START).addScaledVector(OUT_VELOCITY, k);
      heli.root.position.addScaledVector(OUT_ACCEL, k * k * 0.5);
      heli.root.rotation.set(-0.12 - Math.min(0.1, k * 0.03), -0.35, 0.08);
      heli.update(dt, { rotor: 1, light: 1 });
    }
  }

  /**
   * Behind the credits: the burning tower in the city at night, the camera
   * circling it slowly from far out and above (the story layer keeps the
   * frame dark, so it is a backdrop, not a shot).
   */
  _creditsShot(dt) {
    this.creditsT += dt;
    const camera = this.game.camera;
    const a = 2.2 + this.creditsT * 0.035;
    camera.position.set(Math.cos(a) * 150, 70 - this.creditsT * 0.4, Math.sin(a) * 150);
    camera.lookAt(0, -10, 0);
  }

  dispose() {
    this.vale.dispose();
    this.cabin.dispose();
  }
}
