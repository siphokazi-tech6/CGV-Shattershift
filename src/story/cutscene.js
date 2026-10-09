/**
 * First-person cutscenes.
 *
 * A scene is data: camera shots, subtitle lines, overlay keyframes (eyelids,
 * blur, fade...), events for the host to act on, and reaction points where
 * the player has to hit keys. The player is clocked by the host's update(dt)
 * - no timers of its own - so the game can pause it and tests can step it.
 *
 *   const player = new CutscenePlayer({ ui, reactions, camera, voice });
 *   player.on("event", (name, data) => ...);        // the scene's cues
 *   player.on("reaction-fail", ({ id }) => ...);    // e.g. play a death
 *   player.on("pause-request", () => ...);          // Esc tapped (held = skip)
 *   player.play(scene, ctx);
 *   // each frame:
 *   player.update(dt);           // moves the camera, shows lines, ...
 *   // after a failed reaction (when the death has played):
 *   player.retry();              // back to just before that reaction
 *
 * Scene fields (all optional except id):
 *   id
 *   duration     seconds (default: the end of the last line/shot/event)
 *   lines        timed lines - timeLines(SCENES.x) from script.js
 *   shots        [{ at, dur, from: {pos, look, fov, roll}, to: {...}, ease }]
 *                pos/look: THREE.Vector3, [x, y, z], or (ctx) => Vector3
 *   camera       (t, pose, ctx) => void - write pose.position/look/fov/roll
 *                yourself instead of shots (both can be used: shots first);
 *                pose.shake (0..1) adds a camera shake for that frame
 *                (a quarter of it under reduced motion)
 *                A shot with `whip: true` is a fast pan; reduced motion
 *                turns it into a cut.
 *   head         { breath, bob, bobRate, sway } - first-person life
 *   track        { lids, blur, vignette, fade, tint }: [[t, value], ...]
 *   events       [{ at, name, data }]
 *   reactions    [{ at, id, spec, lead = 2, slow = 0.12, retryFrom }] - see
 *                reaction.js; `slow` 0 freezes the scene clock while it is
 *                up; `retryFrom` an earlier reaction's id to go back to on a miss
 *   onUpdate     (t, dt, ctx, player) => void - per-frame scene logic
 *   letterbox    default true
 *   hideHud      hide the level HUDs even without the letterbox (a quick
 *                reaction moment in play, like the roof's ladder latch)
 *   skippable    default true (hold Esc). A skip runs up to the next
 *                reaction - reactions are gameplay, never skipped - firing
 *                every event it jumps over, in order.
 *   keepFade     leave the fade where the scene ended it (chaining to black)
 */

import * as THREE from "../three.js";

const SKIP_HOLD = 0.7;
/** Esc released sooner than this is a tap: pause, not skip. */
export const TAP_PAUSE = 0.25;

function ease(kind, k) {
  if (kind === "linear") return k;
  if (kind === "in") return k * k;
  if (kind === "out") return 1 - (1 - k) * (1 - k);
  return k * k * (3 - 2 * k);
}

/** Linear keyframe track: [[t, v], ...] sorted by t. */
export function sampleTrack(track, t) {
  if (!track?.length) return null;
  if (t <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i += 1) {
    const [t1, v1] = track[i];
    if (t <= t1) {
      const [t0, v0] = track[i - 1];
      const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return v0 + (v1 - v0) * k;
    }
  }
  return track[track.length - 1][1];
}

function toVec(v, ctx, out) {
  if (!v) return null;
  if (typeof v === "function") return out.copy(v(ctx));
  if (Array.isArray(v)) return out.set(v[0], v[1], v[2]);
  return out.copy(v);
}

export class CutscenePlayer {
  /**
   * @param {object} o
   * @param {import("./story-ui.js").StoryUI} o.ui
   * @param {import("./reaction.js").ReactionHits} o.reactions
   * @param {THREE.PerspectiveCamera} [o.camera]  moved every frame (null: read player.pose)
   * @param {{say(line:object):void, stop():void}} [o.voice]  the lines spoken (voice.js)
   */
  constructor({ ui, reactions, camera = null, voice = null, reducedMotion = false }) {
    this.ui = ui;
    this.reactions = reactions;
    this.camera = camera;
    this.voice = voice;
    /** Head bob/sway at a quarter, blur and blinks shortened, whip-pans cut. */
    this.reducedMotion = reducedMotion;
    /**
     * Set by the host while its pause menu is up: the clock is frozen (the
     * host stops calling update) and Esc belongs to the menu again.
     */
    this.paused = false;
    this.state = "idle";
    this.scene = null;
    this.ctx = null;
    this.t = 0;
    this.time = 0;
    this.timeScale = 1;
    this.skipHeld = false;
    this.skipProgress = 0;
    this.pose = { position: new THREE.Vector3(), look: new THREE.Vector3(0, 0, -1), fov: null, roll: 0 };
    this._from = { position: new THREE.Vector3(), look: new THREE.Vector3() };
    this._to = { position: new THREE.Vector3(), look: new THREE.Vector3() };
    this._fired = new Set();
    this._resolved = new Set();
    this._reaction = null;
    this._line = null;
    this._handlers = new Map();
    this._escDown = null;
    this._onKey = (e) => {
      if (e.code !== "Escape" || !this.active || this.paused) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === "keydown") {
        if (e.repeat) return;
        this.skipHeld = true;
        this._escDown = performance.now();
      } else {
        this.skipHeld = false;
        const held = this._escDown === null ? Infinity : (performance.now() - this._escDown) / 1000;
        this._escDown = null;
        if (held < TAP_PAUSE) this.tapEscape();
      }
    };
  }

  /**
   * A short tap of Esc: the host's pause menu (a hold skips instead). The
   * tap is not counted toward the skip.
   */
  tapEscape() {
    if (!this.active || this.paused) return;
    this.skipHeld = false;
    this.skipProgress = 0;
    this.ui.setSkip(0, false);
    this._emit("pause-request", { id: this.scene?.id });
  }

  on(name, fn) {
    if (!this._handlers.has(name)) this._handlers.set(name, new Set());
    this._handlers.get(name).add(fn);
    return () => this._handlers.get(name)?.delete(fn);
  }

  _emit(name, ...args) {
    // A copy: a handler may play the next scene and add handlers of its own,
    // which must not hear this scene's event.
    for (const fn of [...(this._handlers.get(name) ?? [])]) fn(...args);
  }

  /** Hold-Esc-to-skip from the keyboard (capture phase, before the game's Esc = pause). */
  listen(target = window) {
    this.unlisten();
    this._target = target;
    target.addEventListener("keydown", this._onKey, true);
    target.addEventListener("keyup", this._onKey, true);
  }

  unlisten() {
    this._target?.removeEventListener("keydown", this._onKey, true);
    this._target?.removeEventListener("keyup", this._onKey, true);
    this._target = null;
  }

  /** True from play() until the scene ends (including a failed reaction). */
  get active() {
    return this.state === "playing" || this.state === "reaction" || this.state === "failed";
  }

  play(scene, ctx = {}) {
    this.scene = {
      letterbox: true,
      skippable: true,
      lines: [],
      shots: [],
      events: [],
      reactions: [],
      ...scene,
    };
    const s = this.scene;
    s.events = [...s.events].sort((a, b) => a.at - b.at);
    s.reactions = [...s.reactions].sort((a, b) => a.at - b.at);
    s.duration ??= Math.max(
      0.5,
      ...s.lines.map((l) => l.at + l.hold),
      ...s.shots.map((sh) => sh.at + (sh.dur ?? 0)),
      ...s.events.map((e) => e.at),
      ...s.reactions.map((r) => r.at + 0.5),
    );
    this.ctx = ctx;
    this.t = 0;
    this.time = 0;
    this.timeScale = 1;
    this.skipHeld = false;
    this.skipProgress = 0;
    this._fired.clear();
    this._resolved.clear();
    this._reaction = null;
    this._line = null;
    this.state = "playing";
    this.ui.show();
    this.ui.setCutscene(s.letterbox);
    if (!s.letterbox && s.hideHud) document.body.classList.add("story-cutscene");
    this._emit("start", s.id);
    this._apply(0);
    return this;
  }

  /**
   * One frame.
   * @returns {{state:string, t:number, timeScale:number}}
   */
  update(dt) {
    const s = this.scene;
    if (!s || !this.active) return { state: this.state, t: this.t, timeScale: 1 };
    this.time += dt;

    if (this.state === "reaction") {
      const result = this.reactions.update(dt);
      this.timeScale = this._reaction.slow ?? 0.12;
      this.t += dt * this.timeScale;
      if (result === "success") {
        this._resolved.add(this._reaction.id);
        this._emit("reaction-success", { id: this._reaction.id });
        this._reaction = null;
        this.state = "playing";
        this.timeScale = 1;
      } else if (result === "fail") {
        this.state = "failed";
        this.timeScale = 0;
        this._emit("reaction-fail", { id: this._reaction.id, reason: this.reactions.failReason });
      }
    } else if (this.state === "playing") {
      this._updateSkip(dt);
      if (this.state !== "playing") return { state: this.state, t: this.t, timeScale: this.timeScale };
      this.timeScale = 1;
      this.t += dt;
      // A reaction point reached?
      const next = s.reactions.find((r) => !this._resolved.has(r.id));
      if (next && this.t >= next.at) {
        this.t = next.at;
        this._fireEvents(this.t);
        this._startReaction(next);
      }
    }
    // A handler may have stopped this scene (or started another) just now.
    if (this.scene !== s) return { state: this.state, t: this.t, timeScale: this.timeScale };
    if (this.state === "failed") {
      this._apply(dt);
      return { state: this.state, t: this.t, timeScale: 0 };
    }

    this._fireEvents(this.t);
    if (this.scene !== s) return { state: this.state, t: this.t, timeScale: this.timeScale };
    this._apply(dt);
    s.onUpdate?.(this.t, dt * this.timeScale, this.ctx, this);
    if (this.state === "playing" && this.t >= s.duration) this._finish(false);
    return { state: this.state, t: this.t, timeScale: this.timeScale };
  }

  /**
   * After a failed reaction: back to `lead` seconds before it, and go again.
   * A reaction with `retryFrom: id` (or a `fromId` here) goes back to that
   * earlier reaction instead - and every reaction from there is played again.
   */
  retry(fromId = null) {
    if (this.state !== "failed" || !this._reaction) return;
    const failed = this._reaction;
    const backTo = fromId ?? failed.retryFrom;
    const r = (backTo && this.scene.reactions.find((x) => x.id === backTo)) || failed;
    const from = Math.max(0, r.at - (r.lead ?? 2));
    for (const x of this.scene.reactions) if (x.at >= r.at) this._resolved.delete(x.id);
    for (const e of this.scene.events) if (e.at >= from) this._fired.delete(e);
    this.t = from;
    this.state = "playing";
    this.timeScale = 1;
    this._reaction = null;
    this.reactions.cancel();
    const scene = this.scene;
    this._emit("retry", { id: r.id, failed: failed.id, from });
    // (A host may end the scene on a retry, and hand control back.)
    if (this.scene === scene) this._apply(0);
  }

  /** Jump past the talking: to the next reaction, or the end. */
  skip() {
    const s = this.scene;
    if (!s || this.state !== "playing" || !s.skippable) return;
    const next = s.reactions.find((r) => !this._resolved.has(r.id));
    const target = next ? next.at : s.duration;
    // Skipping the talking silences it.
    this.voice?.stop?.();
    this.t = target;
    this._fireEvents(target, true);
    this._emit("skip", { to: next ? next.id : "end" });
    if (next) this._startReaction(next);
    else this._finish(true);
  }

  /** Abandon the scene (quit to menu). */
  stop() {
    if (!this.scene) return;
    this.voice?.stop?.();
    this.reactions.cancel();
    this.state = "idle";
    this.scene = null;
    this.ui.reset();
    this.ui.hide();
  }

  _updateSkip(dt) {
    const s = this.scene;
    if (!s.skippable) return;
    this.skipProgress = this.skipHeld ? this.skipProgress + dt / SKIP_HOLD : Math.max(0, this.skipProgress - dt * 3);
    this.ui.setSkip(this.skipProgress, this.time > 0.6);
    if (this.skipProgress >= 1) {
      this.skipProgress = 0;
      this.skipHeld = false;
      // The hold is spent: letting go of Esc afterwards is not a tap.
      this._escDown = null;
      this.skip();
    }
  }

  _startReaction(r) {
    this._reaction = r;
    this.state = "reaction";
    this.ui.setSkip(0, false);
    this.reactions.start(r.spec);
    this._emit("reaction-start", { id: r.id, spec: r.spec });
  }

  _fireEvents(t, skipped = false) {
    const s = this.scene;
    if (!s) return;
    for (const e of s.events) {
      // An event handler may stop the scene or start the next one.
      if (this.scene !== s) return;
      if (e.at > t || this._fired.has(e)) continue;
      this._fired.add(e);
      this._emit("event", e.name, { ...e.data, skipped, at: e.at });
    }
  }

  _finish(skipped) {
    const s = this.scene;
    this._fireEvents(s.duration, skipped);
    if (this.scene !== s) return;
    this.state = "done";
    this.ui.say(null);
    this.ui.setSkip(0, false);
    this.ui.setCutscene(false);
    this.ui.setLids(0);
    this.ui.setBlur(0);
    this.ui.setVignette(0);
    this.ui.setTint(0);
    if (!s.keepFade) this.ui.setFade(0);
    this._emit("done", { id: s.id, skipped });
  }

  /** Camera, subtitles and overlays for the current time. */
  _apply(dt) {
    const s = this.scene;
    const t = this.t;
    const pose = this.pose;
    const ctx = this.ctx;
    pose.shake = 0;

    // Shots: the last one started, eased from -> to.
    if (s.shots.length) {
      let shot = s.shots[0];
      for (const sh of s.shots) if (sh.at <= t) shot = sh;
      // Reduced motion: a fast pan (`whip`) becomes a cut.
      const dur = this.reducedMotion && shot.whip ? 0 : shot.dur;
      const k = dur ? ease(shot.ease, Math.min(1, Math.max(0, (t - shot.at) / dur))) : 1;
      const to = shot.to ?? shot.from;
      toVec(shot.from.pos, ctx, this._from.position);
      toVec(shot.from.look, ctx, this._from.look);
      toVec(to.pos ?? shot.from.pos, ctx, this._to.position);
      toVec(to.look ?? shot.from.look, ctx, this._to.look);
      pose.position.lerpVectors(this._from.position, this._to.position, k);
      pose.look.lerpVectors(this._from.look, this._to.look, k);
      const f0 = shot.from.fov ?? null;
      const f1 = to.fov ?? f0;
      pose.fov = f0 === null ? null : f0 + (f1 - f0) * k;
      const r0 = shot.from.roll ?? 0;
      pose.roll = r0 + ((to.roll ?? r0) - r0) * k;
    }
    s.camera?.(t, pose, ctx);

    // First-person life: breathing, a walking bob, a little sway.
    const head = s.head;
    const time = this.time;
    if (head) {
      const calm = this.reducedMotion ? 0.25 : 1;
      const breath = (head.breath ?? 0) * calm;
      const bob = (head.bob ?? 0) * calm;
      const rate = head.bobRate ?? 8;
      pose.position.y += Math.sin(time * 1.6) * 0.012 * breath + Math.abs(Math.sin(time * rate * 0.5)) * 0.05 * bob;
      pose.position.x += Math.sin(time * rate * 0.25) * 0.02 * bob;
      pose.roll += Math.sin(time * 0.7) * 0.012 * (head.sway ?? 0) * calm + Math.sin(time * rate * 0.25) * 0.01 * bob;
    }
    // A scene's own shake (pose.shake, 0..1), a quarter under reduced motion.
    if (pose.shake > 0) {
      const amount = pose.shake * (this.reducedMotion ? 0.25 : 1);
      pose.position.x += (Math.random() * 2 - 1) * 0.06 * amount;
      pose.position.y += (Math.random() * 2 - 1) * 0.05 * amount;
      pose.roll += (Math.random() * 2 - 1) * 0.02 * amount;
    }
    if (this.camera) {
      const cam = this.camera;
      cam.position.copy(pose.position);
      cam.up.set(0, 1, 0);
      cam.lookAt(pose.look);
      if (pose.roll) cam.rotateZ(pose.roll);
      if (pose.fov && Math.abs(cam.fov - pose.fov) > 1e-3) {
        cam.fov = pose.fov;
        cam.updateProjectionMatrix();
      }
    }

    // Overlays.
    const tr = s.track ?? {};
    const lids = sampleTrack(tr.lids, t);
    if (lids !== null) this.ui.setLids(lids);
    const blur = sampleTrack(tr.blur, t);
    if (blur !== null) this.ui.setBlur(this.reducedMotion ? blur * 0.5 : blur);
    const vignette = sampleTrack(tr.vignette, t);
    if (vignette !== null) this.ui.setVignette(vignette);
    const fade = sampleTrack(tr.fade, t);
    if (fade !== null) this.ui.setFade(fade);
    const tint = sampleTrack(tr.tint, t);
    if (tint !== null) this.ui.setTint(tint);

    // Subtitles: the latest line whose window covers t.
    let line = null;
    for (const l of s.lines) if (t >= l.at && t < l.at + l.hold) line = l;
    if (line !== this._line) {
      this._line = line;
      this.ui.say(line?.who ?? null, line?.text);
      if (line) {
        this.voice?.say(line);
        this._emit("line", line);
      }
    }
  }

  dispose() {
    this.unlisten();
    this.stop();
    this._handlers.clear();
  }
}
