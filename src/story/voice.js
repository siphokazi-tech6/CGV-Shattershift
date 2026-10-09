/**
 * The story's voices. Every line is spoken - recorded by
 * tools/audio/voices.py and listed in src/audio/voice-lines.js - and every
 * stage direction in [square brackets] is a sound cue (CUES, played from the
 * game's sound set, level1-audio.js). A line with no recording (its words
 * changed since the voices were made) falls back to a short blip pitched per
 * speaker (CAST[who].pitch in script.js) until the generator is run again.
 *
 *   const voice = new StoryVoice(() => audioContext, { sfx: level1Audio });
 *   voice.say({ who: "okoro", text: "..." });
 *   voice.preload(lines);      // fetch a scene's clips before they are due
 *   voice.speaking;            // a line is being spoken (the host ducks the music)
 *   voice.setPaused(true);     // the pause menu: it stops, and resumes where it was
 *   voice.stop();              // skipped, quit
 */

import { CAST } from "./script.js";
import { VOICE_LINES } from "../audio/voice-lines.js";
import { outputFor } from "../audio/output.js";

const BASE = new URL("../../assets/audio/voice/", import.meta.url).href;

/**
 * Stage directions, heard. Each is a list of calls on the sound set
 * (level1-audio.js) - [method, ...arguments] - or ["laugh", kind] for a voice.
 */
export const CUES = {
  "[a slow monitor beep]": [["play", "monitor-beep"]],
  "[the launcher clatters across the floor]": [["play", "clatter"]],
  "[glass, everywhere, all at once]": [["glassCascade"]],
  "[it hits you from the side]": [["play", "body-hit"]],
  "[a pistol shot]": [["play", "pistol"]],
  "[the shouting stops]": [], // silence is the point
  "[breathing hard]": [["breath", "pant"]],
  "...": [["breath", "scared"]],
  "[the brakes catch]": [["play", "brake"]],
  "[the last cable snaps]": [["play", "cable-snap"]],
  "[the bridge starts to go]": [["metalGroan", 1.1]],
  "[you pull yourself up]": [["grunt"]],
  "[breathing - slower now]": [["breath", "recover"]],
  "[laughs]": [["laugh", "maniac"]],
  "[the wind]": [], // over a fall: the scream is the game's own
};

const isDirection = (text) => /^\[.*\]$/.test(text) || text === "...";

export class StoryVoice {
  /**
   * @param {() => AudioContext|null} getContext
   * @param {object} [o]
   * @param {object} [o.sfx]     the game's sound set (Level1Audio) for the cues
   * @param {number} [o.volume]  the blip's
   */
  constructor(getContext, { volume = 0.08, sfx = null, voiceVolume = 1.0 } = {}) {
    this.getContext = getContext;
    this.volume = volume;
    this.voiceVolume = voiceVolume;
    this.sfx = sfx;
    this.muted = false;
    this.buffers = new Map();
    this.loads = new Map();
    /** { source, gain, startedAt, offset, speech, total, buffer } */
    this.current = null;
    this.paused = false;
    this._resume = null;
    this._token = 0;
  }

  get gender() {
    return this.sfx?.gender ?? "f";
  }

  /** The clip for a line: { file, speech, total } or null. */
  clipFor(line) {
    const entry = VOICE_LINES[line.key ?? `${line.who}|${line.text}`];
    if (!entry) return null;
    const [file, speech, total, gendered] = entry;
    return { file: gendered ? `${file}-${this.gender}` : file, speech, total };
  }

  /** A line from the script (a cutscene's, or talk during play). */
  say(line) {
    if (!line) return;
    const text = line.text.trim();
    if (isDirection(text)) {
      this.cue(text);
      return;
    }
    const clip = this.clipFor(line);
    if (clip) this._speak(clip);
    else this.blip(line.who);
  }

  /** A stage direction's sound, if it has one. */
  cue(text) {
    for (const [method, ...args] of CUES[text] ?? []) {
      if (method === "laugh") {
        const clip = this.clipFor({ key: `#laugh-${args[0]}` });
        if (clip) this._speak(clip);
      } else this.sfx?.[method]?.(...args);
    }
  }

  /** Fetch and decode clips ahead of their lines. */
  preload(lines = []) {
    if (!this._context()) return;
    for (const line of lines) {
      if (isDirection(line.text.trim())) {
        if (line.text.trim() === "[laughs]") this._load("vale-laugh-maniac");
        continue;
      }
      const clip = this.clipFor(line);
      if (clip) this._load(clip.file);
    }
  }

  /** Every recorded line of these speakers (the Skyline's intercom comes from its layout). */
  preloadSpeakers(who = []) {
    if (!this._context()) return;
    for (const [key, [file, , , gendered]] of Object.entries(VOICE_LINES)) {
      if (who.includes(key.split("|")[0])) this._load(gendered ? `${file}-${this.gender}` : file);
    }
  }

  /** A line is being spoken (not just its echo ringing out). */
  get speaking() {
    const c = this.current;
    const ctx = this._context();
    if (!c || !ctx || this.paused) return false;
    return ctx.currentTime < c.startedAt - c.offset + c.speech;
  }

  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    const ctx = this._context();
    if (paused) {
      const c = this.current;
      if (c && ctx) {
        const at = c.offset + (ctx.currentTime - c.startedAt);
        if (at < c.buffer.duration - 0.05) this._resume = { clip: c.clip, buffer: c.buffer, at };
        this._halt(c, 0.05);
        this.current = null;
      }
    } else if (this._resume && ctx) {
      const r = this._resume;
      this._resume = null;
      this._start(r.clip, r.buffer, r.at);
    }
  }

  /** Silence (a skip, a quit): what is playing fades, what is loading is dropped. */
  stop() {
    this._token += 1;
    this._resume = null;
    if (this.current) this._halt(this.current, 0.12);
    this.current = null;
  }

  blip(who) {
    const pitch = CAST[who]?.pitch ?? 1;
    const ctx = this.getContext?.();
    if (!ctx || this.muted || !pitch || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = this.volume;
    out.connect(outputFor(ctx));
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900 * pitch;
    filter.Q.value = 1.4;
    filter.connect(out);
    for (let i = 0; i < 3; i += 1) {
      const at = now + i * 0.075;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(170 * pitch * (1 + (i % 2) * 0.12 - i * 0.04), at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(1, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.065);
      osc.connect(gain).connect(filter);
      osc.start(at);
      osc.stop(at + 0.08);
    }
  }

  /* ---------------------------------------------------------------- */

  _context() {
    const ctx = this.getContext?.();
    return ctx && ctx.state === "running" ? ctx : null;
  }

  async _speak(clip) {
    const ctx = this._context();
    if (!ctx || this.muted) return;
    const token = ++this._token;
    const asked = ctx.currentTime;
    const buffer = this.buffers.get(clip.file) ?? (await this._load(clip.file));
    if (!buffer || token !== this._token) return;
    // Too late (a slow network): a line that starts well after its subtitle is worse than none.
    const late = ctx.currentTime - asked;
    if (late > 1.0) return;
    if (this.paused) {
      this._resume = { clip, buffer, at: 0 };
      return;
    }
    this._start(clip, buffer, late > 0.25 ? Math.min(late - 0.25, 0.4) : 0);
  }

  _start(clip, buffer, offset) {
    const ctx = this._context();
    if (!ctx) return;
    // The line before: cut off mid-sentence, but its laugh or echo may ring on.
    const prev = this.current;
    if (prev && ctx.currentTime < prev.startedAt - prev.offset + prev.speech) this._halt(prev, 0.12);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = this.voiceVolume;
    source.connect(gain).connect(outputFor(ctx));
    const c = { clip, source, gain, buffer, startedAt: ctx.currentTime, offset, speech: clip.speech, total: clip.total };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this.current === c) this.current = null;
    };
    source.start(ctx.currentTime, offset);
    this.current = c;
  }

  _halt(c, seconds) {
    const ctx = this.getContext?.();
    if (!ctx) return;
    const now = ctx.currentTime;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(0, now + seconds);
    try { c.source.stop(now + seconds + 0.02); } catch (error) {}
  }

  async _load(file) {
    if (this.buffers.has(file)) return this.buffers.get(file);
    const ctx = this._context();
    if (!ctx) return null;
    if (!this.loads.has(file)) {
      const request = fetch(`${BASE}${file}.mp3`)
        .then((response) => {
          if (!response.ok) throw new Error(`Voice request failed (${response.status}): ${file}`);
          return response.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => { this.buffers.set(file, buffer); return buffer; })
        .catch((error) => {
          this.loads.delete(file);
          console.warn("A voice line could not be loaded.", error);
          return null;
        });
      this.loads.set(file, request);
    }
    return this.loads.get(file);
  }
}
