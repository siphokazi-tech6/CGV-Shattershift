/**
 * The story layer: one per page, shared by every level (docs/story-phases-plan.md §2).
 *
 * Bundles the Phase 1 systems - StoryUI, ReactionHits, CutscenePlayer,
 * StoryVoice - with what every host needs around them:
 *
 *   const story = new StoryLayer({ getAudioContext, blurTargets: [canvas] });
 *   story.play(scene, { camera, on: { event, done, fail } });
 *   story.update(dt);            // every frame the game is not paused
 *   story.talk(line);            // a subtitle during play (no letterbox)
 *   story.setPaused(true);       // the pause menu is up: Esc is the menu's
 *
 * - Per-scene handlers: `on` handlers are dropped when the scene ends, so a
 *   host can play scene after scene without tidying up.
 * - A failed reaction: `fail` is called; by default the layer plays a short
 *   death (red, then black) and retries the reaction itself. A host that
 *   plays its own death passes `deathSeconds: 0` and calls `retry()`.
 * - Seen-once flags (`seen`): kept for the session, so a restart after a
 *   death skips the talking it has already shown. `forgetSeen()` when a new
 *   story starts from the menu.
 * - Everything is clocked by update(dt): no timers, so pause freezes it all
 *   and tests can step it.
 */

import { StoryUI } from "./story-ui.js";
import { ReactionHits } from "./reaction.js";
import { CutscenePlayer } from "./cutscene.js";
import { StoryVoice } from "./voice.js";
import { lineHold } from "./script.js";

export class StoryLayer {
  /**
   * @param {object} o
   * @param {() => AudioContext|null} [o.getAudioContext]
   * @param {object} [o.sfx]  the game's sound set (level1-audio.js): the stage directions' sounds
   * @param {HTMLElement[]} [o.blurTargets]
   * @param {object} [o.options]  { longWindows, holdInsteadOfMash, reducedMotion }
   */
  constructor({ getAudioContext = () => null, sfx = null, blurTargets = [], options = {} } = {}) {
    this.ui = new StoryUI({ blurTargets });
    this.reactions = new ReactionHits(this.ui);
    this.voice = new StoryVoice(getAudioContext, { sfx });
    this.player = new CutscenePlayer({ ui: this.ui, reactions: this.reactions, voice: this.voice });
    this.reactions.listen();
    this.player.listen();
    this.seen = new Set();
    this.paused = false;
    this.log = [];
    this._scene = null;
    this._off = [];
    this._death = null;
    this._talk = { line: null, left: 0, queue: [] };
    this.setOptions(options);

    // A few things worth keeping for tests and the handover notes.
    this.player.on("line", (line) => this.log.push(["line", line.who, line.text]));
    this.player.on("event", (name, data) => this.log.push(["event", name, !!data.skipped]));
    this.player.on("reaction-start", ({ id }) => this.log.push(["reaction-start", id]));
    this.player.on("reaction-success", ({ id }) => this.log.push(["reaction-success", id]));
    this.player.on("reaction-fail", ({ id, reason }) => this.log.push(["reaction-fail", id, reason]));
    this.player.on("done", ({ id, skipped }) => this.log.push(["done", id, skipped]));
  }

  /** { longWindows, holdInsteadOfMash, reducedMotion } - from the settings menu. */
  setOptions({ longWindows, holdInsteadOfMash, reducedMotion } = {}) {
    const reaction = {};
    if (longWindows !== undefined) reaction.longWindows = !!longWindows;
    if (holdInsteadOfMash !== undefined) reaction.holdInsteadOfMash = !!holdInsteadOfMash;
    this.reactions.setOptions(reaction);
    if (reducedMotion !== undefined) this.player.reducedMotion = !!reducedMotion;
  }

  /** The canvases the blur applies to (the main one, plus a level's own while it is up). */
  setBlurTargets(list) {
    this.ui.setBlur(0);
    this.ui.blurTargets = list;
  }

  /** A cutscene is running (including a reaction, a failed reaction, or its death). */
  get active() {
    return this.player.active || !!this._death;
  }

  /** Seconds into the default death after a missed reaction (0 when there is none). */
  get deathTime() {
    return this._death ? this._death.t : 0;
  }

  /** The id of the scene playing, or null. */
  get sceneId() {
    return this.active ? this._scene?.id ?? null : null;
  }

  /**
   * Play a scene (from scenes.js).
   * @param {object} scene
   * @param {object} [o]
   * @param {THREE.Camera} [o.camera]  the camera the scene drives (null: read player.pose)
   * @param {object} [o.ctx]
   * @param {object} [o.on]  { event(name, data), done({id, skipped}), fail({id, reason}),
   *   retry({id, from}), reactionStart({id}), reactionSuccess({id}), line(line) }
   * @param {number} [o.deathSeconds]  the default death on a failed reaction
   *   (red, then black) before the retry; 0 = the host handles it and calls retry()
   * @param {string} [o.deathLine]  a subtitle over the death
   */
  play(scene, { camera = null, ctx = {}, on = {}, deathSeconds = 1.8, deathLine = null } = {}) {
    this._unbind();
    this._death = null;
    // A line said during play is cut off by the scene (its subtitle goes too).
    if (this._talk.line) this.voice.stop();
    this.stopTalk();
    this._scene = scene;
    this._deathSeconds = deathSeconds;
    this._deathLine = deathLine;
    this.player.camera = camera;
    this.voice.preload(scene.lines ?? []);
    const p = this.player;
    const bind = (name, fn) => fn && this._off.push(p.on(name, fn));
    bind("event", on.event);
    bind("line", on.line);
    bind("retry", on.retry);
    bind("reaction-start", on.reactionStart);
    bind("reaction-success", on.reactionSuccess);
    this._off.push(p.on("reaction-fail", (info) => {
      on.fail?.(info);
      if (this._deathSeconds > 0) this._death = { t: 0, info };
    }));
    this._off.push(p.on("done", (info) => {
      this.seen.add(info.id);
      this._unbind();
      on.done?.(info);
    }));
    p.play(scene, ctx);
    return this;
  }

  /** After a failed reaction (when a host plays its own death): try again. */
  retry() {
    this._death = null;
    this.ui.setTint(0);
    this.ui.setFade(0);
    this.ui.say(null);
    this.player.retry();
  }

  /** Abandon whatever is playing (quit, restart, a demo jump). */
  stop() {
    this._unbind();
    this._death = null;
    this.stopTalk();
    this.voice.stop();
    this.player.stop();
    this.ui.reset();
    this.ui.hide();
  }

  setPaused(paused) {
    this.paused = paused;
    this.player.paused = paused;
    this.reactions.paused = paused;
    this.voice.setPaused(paused);
    if (paused) {
      this.player.skipHeld = false;
      this.player.skipProgress = 0;
    }
  }

  /**
   * One frame. Returns the player's {state, t, timeScale} (timeScale is the
   * slow motion during a reaction - hosts slow their world with it).
   */
  update(dt) {
    if (this.paused) return { state: this.player.state, t: this.player.t, timeScale: 0 };
    if (this._death) {
      // The default death: red, then black, a beat, then the retry.
      const d = this._death;
      d.t += dt;
      const total = this._deathSeconds;
      this.ui.setTint(Math.min(0.85, d.t * 3));
      this.ui.setFade(Math.min(1, Math.max(0, (d.t - 0.35) / 0.6)));
      if (this._deathLine && d.t > 0.4) this.ui.say(this._deathLine.who, this._deathLine.text);
      if (d.t >= total) this.retry();
      return { state: "failed", t: this.player.t, timeScale: 0 };
    }
    const out = this.player.update(dt);
    this._updateTalk(dt);
    return out;
  }

  /* ---- Talk during play (no letterbox, subtitles above the HUD) ---- */

  /**
   * Show a line during gameplay. Lines never overlap: one that arrives while
   * another is up waits its turn.
   * @param {{who:string, text:string, hold?:number}} line
   */
  talk(line) {
    const t = this._talk;
    if (t.line) {
      t.queue.push(line);
      return;
    }
    this._showTalk(line);
  }

  /** Lines shown or waiting. */
  get talking() {
    return !!this._talk.line || this._talk.queue.length > 0;
  }

  stopTalk() {
    const t = this._talk;
    t.line = null;
    t.queue.length = 0;
    t.left = 0;
    if (!this.player.active) {
      this.ui.say(null);
      this.ui.setGameplay(false);
    }
  }

  _showTalk(line) {
    const t = this._talk;
    t.line = line;
    t.left = lineHold(line);
    this.ui.show();
    this.ui.setGameplay(true);
    this.ui.say(line.who, line.text);
    this.voice.say(line);
    this.log.push(["talk", line.who, line.text]);
  }

  _updateTalk(dt) {
    const t = this._talk;
    if (!t.line || this.player.active) return;
    t.left -= dt;
    if (t.left > 0) return;
    t.line = null;
    this.ui.say(null);
    if (t.queue.length) this._showTalk(t.queue.shift());
    else this.ui.setGameplay(false);
  }

  /* ---- Seen-once ---- */

  hasSeen(id) {
    return this.seen.has(id);
  }

  markSeen(id) {
    this.seen.add(id);
  }

  /** A new story from the menu: every scene plays again. */
  forgetSeen() {
    this.seen.clear();
  }

  _unbind() {
    for (const off of this._off) off();
    this._off.length = 0;
  }

  dispose() {
    this.stop();
    this.reactions.dispose();
    this.player.dispose();
    this.ui.dispose();
  }
}
