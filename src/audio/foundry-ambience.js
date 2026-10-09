/**
 * The Foundry's machinery, heard: a bed under the run so the basement
 * sounds like the plant it is (the Skyline has its fire, water and glass;
 * the Labs its fire and the building giving way).
 *
 *   hum       mains hum and the deep rumble of a big room full of machines
 *   rhythm    the plant's heartbeat: a press thumping, a metallic clank after it
 *   steam     a relief valve venting now and then
 *   chain     a chain running over a sprocket somewhere
 *
 * Synthesized with the Web Audio API on the game's shared AudioContext
 * (the music manager's), so it needs no files and starts once audio is
 * unlocked. start() when the Foundry is live, stop() when you leave it.
 */

import { outputFor } from "./output.js";

export class FoundryAmbience {
  /** @param {() => AudioContext | null} getContext */
  constructor(getContext, { volume = 0.55 } = {}) {
    this.getContext = getContext;
    this.volume = volume;
    this.running = false;
    this.paused = false;
    this.nodes = [];
  }

  start() {
    const ctx = this.getContext();
    if (!ctx || this.running) return;
    this.ctx = ctx;
    this.running = true;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(this.volume, ctx.currentTime + 1.5);
    this.out.connect(outputFor(ctx));
    this.noise ??= this._buffer(ctx, 3, false);
    this.brown ??= this._buffer(ctx, 4, true);

    // Mains hum: 50 Hz and its harmonics, faint.
    for (const [f, g] of [[50, 0.02], [100, 0.012], [150, 0.006]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      osc.connect(gain).connect(this.out);
      osc.start();
      this.nodes.push(osc);
    }
    // The room: low rumble, breathing slowly.
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.brown;
    rumble.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 170;
    const rg = ctx.createGain();
    rg.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const depth = ctx.createGain();
    depth.gain.value = 0.05;
    lfo.connect(depth).connect(rg.gain);
    rumble.connect(low).connect(rg).connect(this.out);
    rumble.start();
    lfo.start();
    this.nodes.push(rumble, lfo);

    let nextBeat = ctx.currentTime + 0.5;
    let nextSteam = ctx.currentTime + 3;
    let nextChain = ctx.currentTime + 6;
    const tick = () => {
      if (!this.running) return;
      const now = ctx.currentTime;
      if (!this.paused) {
        if (now >= nextBeat - 0.05) {
          this._press(nextBeat);
          nextBeat += 1.05 + Math.random() * 0.35;
        }
        if (now >= nextSteam) {
          this._steam(now);
          nextSteam = now + 4 + Math.random() * 6;
        }
        if (now >= nextChain) {
          this._chain(now);
          nextChain = now + 7 + Math.random() * 8;
        }
      } else {
        nextBeat = now + 0.5;
      }
      this._timer = setTimeout(tick, 80);
    };
    tick();
  }

  setPaused(paused) {
    this.paused = paused;
    if (!this.out) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(paused ? 0.0001 : this.volume, t, 0.2);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this._timer);
    const t = this.ctx.currentTime;
    const out = this.out;
    out.gain.cancelScheduledValues(t);
    out.gain.setTargetAtTime(0.0001, t, 0.3);
    const nodes = this.nodes;
    this.nodes = [];
    setTimeout(() => {
      for (const n of nodes) { try { n.stop(); } catch (error) {} }
      out.disconnect();
    }, 1500);
  }

  _buffer(ctx, seconds, brown) {
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.5; } else d[i] = white;
    }
    return b;
  }

  _env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out);
    return g;
  }

  /** A press coming down: the thump, then the ring of the steel. */
  _press(t) {
    const ctx = this.ctx;
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(78, t);
    thump.frequency.exponentialRampToValueAtTime(36, t + 0.18);
    thump.connect(this._env(t, 0.22, 0.008, 0.25));
    thump.start(t);
    thump.stop(t + 0.3);
    const hit = ctx.createBufferSource();
    hit.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 1.4;
    hit.connect(band).connect(this._env(t, 0.05, 0.004, 0.12));
    hit.start(t, Math.random());
    hit.stop(t + 0.2);
    // The clank: inharmonic partials, as struck steel has.
    const ring = t + 0.09;
    for (const [f, g] of [[312, 0.018], [847, 0.012], [1531, 0.007]]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f * (0.97 + Math.random() * 0.06);
      osc.connect(this._env(ring, g, 0.003, 0.45));
      osc.start(ring);
      osc.stop(ring + 0.5);
    }
  }

  /** A relief valve venting: a hiss that swells and dies. */
  _steam(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 2200;
    const dur = 0.9 + Math.random() * 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out);
    src.connect(high).connect(g);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** A chain running over a sprocket: quick small ticks. */
  _chain(t) {
    const ctx = this.ctx;
    const count = 10 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i += 1) {
      const at = t + i * (0.055 + Math.random() * 0.02);
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 1900 + Math.random() * 600;
      osc.connect(this._env(at, 0.008, 0.002, 0.03));
      osc.start(at);
      osc.stop(at + 0.05);
    }
  }
}
