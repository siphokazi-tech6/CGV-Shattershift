"""
Voice acting for every line in the game, generated offline.

    node tools/audio/export-lines.mjs > lines.json
    python tools/audio/voices.py --model DIR --lines lines.json

DIR holds kokoro-v1.0.onnx and voices-v1.0.bin (Kokoro-82M, Apache-2.0:
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0).
Needs `pip install kokoro-onnx soundfile scipy` and ffmpeg with rubberband.

Each character is a Kokoro voice plus a performance chain (dsp.py):

  okoro    am_onyx + bm_daniel, speaking Nigerian English (accent.py writes
           the accent into the pronunciation) - a Nigerian doctor, terrified:
           one flowing take per line, pitch pushed up, breathing in the
           pauses and, as he runs, panting under his words; whispering behind
           the desk, shouting in the lift.
  vale     bm_george + bm_lewis - slowed, the pitch dropped ~4.6 semitones
           (the throat a little), a sub-octave growl and a whispered double under it;
           his intercom lines echo through the tower and end in laughter.
  halcyon  bf_emma - the building: calm, a little metallic, over the PA,
           after a chime.
  pilot    Vale's own voice, undisguised and untreated, over a headset or a
           radio (he is the pilot - the reveal is heard as well as seen).
  narrator HALCYON's voice, without the PA's chime: the briefing film.
  you      af_heart / am_puck (by the character picked) - clear, exhausted.

Writes assets/audio/voice/*.mp3 and src/audio/voice-lines.js (the manifest
the game reads: speech length, so subtitles stay up while a line is spoken).
"""

import argparse
import hashlib
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import dsp  # noqa: E402
from accent import nigerian  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "audio", "voice")
MANIFEST = os.path.join(ROOT, "src", "audio", "voice-lines.js")
SR = 24000

# --------------------------------------------------------------------------
# What the TTS should read (the subtitle stays as written)
# --------------------------------------------------------------------------

def tts_text(text):
    t = text
    t = t.replace("Subject 07", "Subject Zero Seven")
    t = t.replace("Dr. ", "Doctor ")
    t = t.replace("naesthe", "nesthe")
    t = re.sub(r"'(\w+)'", r"\1", t)  # 'Fixed' -> Fixed
    # Shouted words in capitals: read them as words, not letters.
    t = re.sub(r"\b[A-Z]{2,}\b", lambda m: m.group(0).capitalize(), t)
    t = t.replace(" - ", ", ")
    return t.strip()


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p for p in parts if p.strip()]


# --------------------------------------------------------------------------
# Kokoro
# --------------------------------------------------------------------------

class Voices:
    def __init__(self, model_dir):
        from kokoro_onnx import Kokoro
        self.k = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
        style = self.k.get_voice_style
        self.styles = {
            "okoro": (0.6 * style("am_onyx") + 0.4 * style("bm_daniel"), "en-gb"),
            "vale": (0.65 * style("bm_george") + 0.35 * style("bm_lewis"), "en-gb"),
            "halcyon": (style("bf_emma"), "en-gb"),
            "you-f": (style("af_heart"), "en-us"),
            "you-m": (style("am_puck"), "en-us"),
        }

    def _create(self, who, text, speed, phonemes=False):
        style, lang = self.styles[who]
        samples, sr = self.k.create(text, voice=style, speed=float(np.clip(speed, 0.5, 2.0)), lang=lang, is_phonemes=phonemes)
        x = samples.astype(np.float32)
        if sr != SR:
            from scipy.signal import resample_poly
            x = resample_poly(x, SR, sr).astype(np.float32)
        return dsp.trim(x, SR, -50, 0.02)

    def say(self, who, text, speed=1.0):
        return self._create(who, text, speed)

    def say_nigerian(self, who, text, speed=1.0):
        """The line in Nigerian English pronunciation (accent.py)."""
        return self._create(who, nigerian(self.k.tokenizer, text), speed, phonemes=True)

    def held(self, who, vowel, speed=0.6):
        """A vowel held steady (the raw stuff of laughs and grunts): its middle, voiced part."""
        x = self._create(who, vowel * 6 + ".", speed, phonemes=True)
        env = dsp.envelope(x, SR, 0.02)
        on = np.nonzero(env > env.max() * 0.4)[0]
        return x[on[0] + int(0.06 * SR): on[-1] - int(0.06 * SR)]


# --------------------------------------------------------------------------
# Rooms
# --------------------------------------------------------------------------

ROOMS = {
    "ward": dict(rt60=0.55, wet=0.12, predelay=0.008, damp=4500),
    "corridor": dict(rt60=0.9, wet=0.14, predelay=0.012, damp=4000),
    "foundry": dict(rt60=1.9, wet=0.16, predelay=0.025, damp=3000),
    "cabin": dict(rt60=0.32, wet=0.18, predelay=0.003, damp=6000, early=10),
    "labs": dict(rt60=0.95, wet=0.13, predelay=0.012, damp=4200),
    "heli": dict(rt60=0.28, wet=0.1, predelay=0.003, damp=5000),
}

SCENE_ROOM = {
    "wake": "ward", "walkOut": "corridor", "foundryTalk": "foundry",
    "liftFault": "cabin", "liftBreaks": "cabin", "liftSaved": "cabin",
    "breach": "labs", "bendAttack": "labs", "bendSaved": "labs", "hide": "labs",
    "ending": "heli",
}


def room(x, name):
    return dsp.reverb(x, SR, **ROOMS[name])


# --------------------------------------------------------------------------
# Okoro: a Nigerian doctor, terrified
# --------------------------------------------------------------------------

OKORO = {
    #           speed  pitch  vib    breathy lead   pause-breaths  pant under
    "urgent":  (1.04, 0.8, 0.0,   0.06,   0.5,   0.5,           0.0),
    "running": (1.08, 1.2, 0.0,   0.10,   0.7,   0.85,          0.30),
    "panic":   (1.12, 2.0, 0.016, 0.10,   0.8,   0.7,           0.0),
    "relief":  (0.98, 0.5, 0.0,   0.08,   0.0,   0.45,          0.0),
    "hushed":  (1.02, 0.8, 0.014, 0.0,    0.4,   0.5,           0.0),
    "tender":  (0.94, 0.5, 0.014, 0.0,    0.3,   0.45,          0.0),
    "shout":   (1.08, 2.4, 0.0,   0.06,   0.7,   0.6,           0.0),
}


def okoro_mood(line):
    s, t = line["scene"], line["text"]
    if s == "hide":
        if t.startswith("You were never") or t.startswith("Take the bag"):
            return "tender"
        if "GO" in t or "OVER HERE" in t:
            return "shout"
        return "hushed"
    if s == "liftSaved":
        return "relief"
    if s in ("liftFault", "liftBreaks", "bendAttack", "bendSaved") or (s == "breach" and "Go!" in t):
        return "shout" if re.search(r"[A-Z]{3,}|!$", t) and s != "breach" else "panic"
    if s == "breach":
        return "panic"
    if s == "foundryTalk":
        return "running"
    return "urgent"


def gasp(effort=0.8, seconds=0.24):
    """A quick, frightened intake of breath."""
    g = dsp.breath(SR, seconds, inhale=True, effort=effort, throat=0.95, voiced=0.1, voice_hz=150)
    return dsp.fade(g, SR, 0.01, 0.03) * 0.5


def shout(x, amount=1.0):
    """TTS cannot shout: lift it there - brighter, pushed, a little strained."""
    x = dsp.eq(x, SR, "peak", 1900, 5 * amount, 0.8)
    x = dsp.eq(x, SR, "lowshelf", 220, -3 * amount)
    x = dsp.drive(dsp.peak_normalize(x, 0.9), 1 + 0.8 * amount)
    return dsp.compress(x, SR, -18, 4, 0.004, 0.1)


def pauses(x, min_len=0.12, floor_db=-30):
    """The gaps between his phrases, in seconds: [(start, end), ...]."""
    hop = int(SR * 0.01)
    env = dsp.envelope(x, SR, 0.02)[::hop]
    quiet = env < env.max() * dsp.db(floor_db)
    runs, start = [], None
    for i, q in enumerate(quiet):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) * 0.01 >= min_len:
                runs.append((start * 0.01, i * 0.01))
            start = None
    return runs


def breaths_in_pauses(x, level):
    """A breath in each pause between phrases - in the gap, so the line still flows."""
    if not level:
        return x
    out = x.copy()
    end = len(x) / SR
    for a, b in pauses(x):
        if a < 0.2 or b > end - 0.05:
            continue
        dur = min(0.34, (b - a) * 0.85)
        if dur < 0.1:
            continue
        g = dsp.breath(SR, dur, inhale=True, effort=0.5 + 0.45 * level, throat=0.95, voiced=0.08, voice_hz=140)
        out = dsp.mix_into(out, dsp.fade(g, SR, 0.01, 0.03) * 0.45 * level, int((a + (b - a - dur) * 0.5) * SR))
    return out


def pant_under(x, level):
    """Running while he talks: his breath under the words, loudest in the gaps."""
    n = len(x)
    out = np.zeros(n, dtype=np.float32)
    at = 0.0
    while at < n / SR:
        i_len, e_len = dsp.RNG.uniform(0.15, 0.21), dsp.RNG.uniform(0.2, 0.27)
        dsp.mix_into(out, dsp.breath(SR, i_len, inhale=True, effort=0.75, throat=0.95) * 0.6, int(at * SR))
        at += i_len + 0.02
        dsp.mix_into(out, dsp.breath(SR, e_len, inhale=False, effort=0.85, throat=0.95, voiced=0.3, voice_hz=118), int(at * SR))
        at += e_len + dsp.RNG.uniform(0.05, 0.12)
    # Out of his way while he speaks (the words must carry): heard in the gaps.
    env = dsp.envelope(x, SR, 0.06)
    duck = 1 - 0.97 * np.clip(env / (env.max() + 1e-9) * 5, 0, 1)
    duck = np.convolve(duck, np.ones(int(SR * 0.04)) / int(SR * 0.04), mode="same")
    return (out * duck * level * np.max(np.abs(x))).astype(np.float32)


def okoro(v, line, speed_scale=1.0):
    mood = okoro_mood(line)
    speed, semis, vib, breathy, lead_gasp, pause_breaths, pant = OKORO[mood]
    text = tts_text(line["text"])
    # One take: the line flows as he would say it, in his own accent.
    x = v.say_nigerian("okoro", text, speed * speed_scale)
    if mood == "shout":
        x = shout(x, 1.0)
    elif mood == "panic" and text.rstrip().endswith("!"):
        x = shout(x, 0.6)
    x = dsp.pitch(x, SR, semis)
    if vib:
        x = dsp.vibrato(x, SR, 7.0, vib)
    if breathy:
        x = x + dsp.whisper(x, SR) * breathy * 2.0
    if mood in ("hushed", "tender"):
        w = dsp.whisper(x, SR)
        x = dsp.lowpass(x * (0.4 if mood == "hushed" else 0.55) + w * (1.3 if mood == "hushed" else 0.8), SR, 7000)
    x = breaths_in_pauses(x, pause_breaths)
    if pant:
        x = x + pant_under(x, pant)
    speech = len(x) / SR
    lead = gasp(lead_gasp, 0.24) if lead_gasp else dsp.silence(SR, 0.05)
    x = np.concatenate([lead, dsp.silence(SR, 0.02), x])
    speech += len(lead) / SR + 0.02
    if mood == "shout" and "OVER HERE" in line["text"]:
        # Running away from you, down the corridor, drawing them off.
        x = dsp.lowpass(x, SR, 3800)
        x = dsp.reverb(x, SR, rt60=1.4, wet=0.4, predelay=0.03, damp=3000)
    else:
        x = room(x, SCENE_ROOM.get(line["scene"], "corridor"))
    level = {"hushed": -21, "tender": -20, "shout": -16}.get(mood, -17.5)
    return dsp.normalize(x, SR, level), speech


# --------------------------------------------------------------------------
# Dr. Vale: deep, slow, wrong
# --------------------------------------------------------------------------

def vale_core(x, wobble=True):
    """The voice itself: a bigger throat, a lower pitch, a growl and a whisper under it."""
    # Depth mostly from the pitch (formants kept, so the words stay clear),
    # a little from a bigger throat.
    x = dsp.body(x, SR, -0.6)
    x = dsp.pitch(x, SR, -4.0)
    if wobble:
        x = dsp.vibrato(x, SR, 4.2, 0.02)
    sub = dsp.lowpass(dsp.pitch(x, SR, -12, formant="shifted"), SR, 320, order=4)
    hiss = dsp.highpass(dsp.whisper(x, SR), SR, 1100)
    y = x.copy()
    y += dsp.pad_to(sub, len(y)) * 0.32
    y = dsp.mix_into(y, hiss * 0.35, int(SR * 0.014))
    y = dsp.eq(y, SR, "lowshelf", 150, 5)
    y = dsp.eq(y, SR, "peak", 2600, 2.5, 1.0)
    y = dsp.drive(dsp.peak_normalize(y, 0.8), 1.7)
    return dsp.compress(y, SR, -20, 3.5, 0.01, 0.15)


def vale_space(x, context):
    if context == "intercom":
        # The tower's PA: one slap off the concrete and a short room - more
        # would smear the words (measured: tools/audio/README.md).
        x = dsp.bandpass(x, SR, 110, 7000, order=1)
        x = dsp.bitcrush(x, 10, 0.06)
        x = dsp.echo(x, SR, 0.23, 0.12, 1, 2600)
        return dsp.reverb(x, SR, rt60=1.5, wet=0.12, predelay=0.03, damp=3200)
    if context == "monitor":
        # A wall monitor, in the room with you (the voice is driven enough already).
        x = dsp.bandpass(x, SR, 150, 6500, order=1)
        return dsp.reverb(x, SR, **ROOMS["labs"])
    return dsp.reverb(x, SR, **ROOMS["heli"])


def vale_context(line):
    s = line["scene"]
    if s == "breach":
        return "monitor"
    if s == "ending":
        return "close"
    return "intercom"


# Laughter after these lines (kind of laugh).
VALE_LAUGHS = {
    "Enjoy your last half hour.": "chuckle",
    "Run all you like. Everything you are, I made.": "chuckle",
    "Lights out, Seven. My patients never needed them.": "chuckle",
    "Did you think I'd leave the roof unguarded? Say hello to my children.": "cackle",
    "Break every lock you like, Seven. The charges don't care.": "chuckle",
    "The atrium's gone. There's no way down, Seven - and nobody is coming for you.": "chuckle",
}


def vale(v, line, speed_scale=1.0):
    text = tts_text(line["text"])
    raw = v.say("vale", text, 0.84 * speed_scale)
    x = vale_core(raw)
    speech = len(x) / SR
    context = vale_context(line)
    if line["text"].startswith("Hello, Seven"):
        # The reveal: the room breathes in before he speaks.
        before = len(x)
        x = dsp.reverse_swell(x, SR, 0.8, 1.8)
        speech += (len(x) - before) / SR
    kind = VALE_LAUGHS.get(line["text"])
    if kind:
        x = np.concatenate([x, dsp.silence(SR, 0.18), laugh_core(v, kind)])
    x = vale_space(x, context)
    return dsp.normalize(x, SR, -16.5 if context == "close" else -17), speech


_HELD = {}


def _held(v, vowel, semis):
    """Vale's held vowel, at a pitch (kept per half-semitone)."""
    key = (vowel, round(semis * 2) / 2)
    if key not in _HELD:
        if (vowel, 0) not in _HELD:
            _HELD[(vowel, 0)] = v.held("vale", vowel)
        base = _HELD[(vowel, 0)]
        _HELD[key] = base if key[1] == 0 else dsp.pitch(base, SR, key[1])
    return _HELD[key]


def _glide(x, semis):
    """Read x faster or slower so its pitch slides by `semis` across it."""
    n = len(x)
    rate = 2 ** (np.linspace(0, semis, n) / 12)
    pos = np.cumsum(rate)
    pos = pos[pos < n - 1]
    return np.interp(pos, np.arange(n), x).astype(np.float32)


def _ha(v, vowel, semis, dur, amp=1.0, fall=-2.0, breath=0.5):
    """One burst of laughter: the h (the vowel breathed), then the voice, falling."""
    src = _held(v, vowel, semis)
    need = int((dur + 0.12) * SR)
    start = int(dsp.RNG.integers(0, max(1, len(src) - need)))
    seg = _glide(src[start:start + need], fall)[: int(dur * SR)]
    n = len(seg)
    t = np.arange(n) / SR
    h = dsp.whisper(seg, SR)
    voice = np.clip((t - 0.03) / 0.015, 0, 1) * np.exp(-np.maximum(0, t - 0.05) / max(0.04, dur * 0.42))
    air = np.exp(-t / 0.045) * breath + np.exp(-np.maximum(0, t - dur * 0.6) / 0.04) * (t > dur * 0.6) * breath * 0.3
    return ((seg * voice + h * air * 1.6) * amp).astype(np.float32)


def _gasp_in(seconds=0.26, level=0.35):
    """The high, rasping breath in between bouts of a mad laugh."""
    w = dsp.breath(SR, seconds, inhale=True, effort=0.9, throat=0.9, voiced=0.3, voice_hz=320)
    return dsp.lowpass(dsp.fade(w, SR, 0.02, 0.04), SR, 5000) * level


def _bout(v, vowel, notes, step, slow=1.0, breath=0.5):
    """notes: [(semis, dur, amp, fall)]; `step` seconds between bursts, stretched by `slow` each time."""
    parts, at = [], 0.0
    for semis, dur, amp, fall in notes:
        parts.append((at, _ha(v, vowel, semis, dur, amp, fall, breath)))
        at += step
        step *= slow
    out = dsp.silence(SR, at + 0.6)
    for a, x in parts:
        dsp.mix_into(out, x, int(a * SR))
    return dsp.trim(out, SR, -45, 0.03)


def laugh_core(v, kind):
    """
    Vale laughing: bursts of his own held vowel - each one breathed in on an
    h, voiced, its pitch falling - in bouts that climb and run down, with
    the rasping gasps of a man who can't stop. Then his voice (vale_core).
    """
    if kind == "chuckle":
        # Low, through the nose almost: heh-heh-heh, running down.
        x = _bout(v, "ɛ", [(-1, 0.11, 0.6, -1.5), (-1.5, 0.11, 0.65, -1.5), (-2, 0.12, 0.55, -2), (-2.5, 0.13, 0.45, -2.5), (-3.5, 0.17, 0.35, -3.5)], 0.19, 1.06, 0.75)
        parts = [x]
    elif kind == "cackle":
        up = _bout(v, "ɑː", [(1, 0.12, 0.8, -2), (2, 0.12, 0.9, -2), (3, 0.13, 1, -2), (4, 0.13, 1, -2.5), (5, 0.14, 1, -2.5), (5.5, 0.32, 1, -5)], 0.17, 1.0)
        down = _bout(v, "ɑː", [(4, 0.13, 0.85, -2), (3, 0.13, 0.75, -2), (1.5, 0.14, 0.6, -2.5), (0, 0.18, 0.45, -3.5)], 0.2, 1.12)
        parts = [up, _gasp_in(0.24), down]
    else:  # maniac: a low chuckle, a climb into a shriek of a laugh, gasps, and down again
        low = _bout(v, "ɛ", [(-1, 0.11, 0.6, -1.5), (-1, 0.11, 0.7, -1.5), (-0.5, 0.12, 0.75, -2)], 0.2, 1.0, 0.7)
        climb = _bout(v, "ɑː", [(2, 0.12, 0.85, -2), (3, 0.12, 0.9, -2), (4, 0.12, 0.95, -2), (5, 0.13, 1, -2), (6, 0.13, 1, -2.5), (7, 0.13, 1, -2.5), (7.5, 0.5, 1, -6)], 0.16, 1.0)
        down = _bout(v, "ɑː", [(6, 0.13, 0.9, -2), (5, 0.13, 0.85, -2), (3.5, 0.14, 0.75, -2.5), (2, 0.15, 0.6, -2.5), (0.5, 0.17, 0.45, -3), (-1, 0.22, 0.3, -4)], 0.19, 1.1)
        parts = [low, _gasp_in(0.22, 0.25), climb, _gasp_in(0.3, 0.4), down]
    x = np.concatenate([np.concatenate([p, dsp.silence(SR, 0.02)]) for p in parts])
    x = vale_core(x, wobble=False)
    if kind != "chuckle":
        # Not one voice in that head: a second, a hair sharp and late.
        twin = dsp.pitch(x, SR, 0.2)
        x = dsp.mix_into(x.copy(), twin * 0.35, int(SR * 0.019))
    return x


def vale_laugh(v, kind="maniac", context="close"):
    x = laugh_core(v, kind)
    speech = len(x) / SR
    x = dsp.echo(x, SR, 0.27, 0.22, 3, 2600)
    x = vale_space(x, context)
    return dsp.normalize(x, SR, -16), speech


# --------------------------------------------------------------------------
# HALCYON: the building
# --------------------------------------------------------------------------

def chime():
    """The PA's two-note chime before an announcement."""
    out = dsp.silence(SR, 0.95)
    for i, f in enumerate([659.25, 523.25]):
        t = np.arange(int(SR * 0.7)) / SR
        tone = sum(np.sin(2 * np.pi * f * m * t) * g for m, g in [(1, 1), (2.01, 0.25), (3.0, 0.08)])
        tone = (tone * np.exp(-t * 5.5) * np.minimum(1, t / 0.004)).astype(np.float32)
        dsp.mix_into(out, tone * 0.22, int(SR * i * 0.28))
    return out


def halcyon(v, line, speed_scale=1.0):
    x = v.say("halcyon", tts_text(line["text"]), 0.97 * speed_scale)
    # A machine's evenness: a static comb (metal), a hair of crush.
    comb = np.zeros_like(x)
    d = int(SR * 0.0045)
    comb[d:] = x[:-d]
    x = x + comb * 0.25
    x = dsp.bitcrush(x, 11, 0.1)
    x = dsp.bandpass(x, SR, 220, 7500, order=1)
    lead = chime()
    speech = (len(lead) + len(x)) / SR
    x = np.concatenate([lead, x])
    x = dsp.echo(x, SR, 0.19, 0.12, 1, 3000)
    x = dsp.reverb(x, SR, rt60=1.4, wet=0.13, predelay=0.025, damp=3500)
    return dsp.normalize(x, SR, -19), speech


# --------------------------------------------------------------------------
# The pilot (Vale, undisguised), and Subject 07
# --------------------------------------------------------------------------

def radio_static(n, level=0.02):
    hiss = dsp.bandpass(dsp.RNG.standard_normal(n).astype(np.float32), SR, 600, 4000) * level
    crackle = (dsp.RNG.random(n) < 0.0009) * dsp.RNG.standard_normal(n) * level * 14
    return (hiss + dsp.lowpass(crackle.astype(np.float32), SR, 3000)).astype(np.float32)


def squelch():
    k = dsp.bandpass(dsp.white(SR, 0.09), SR, 900, 5000) * np.linspace(1, 0, int(SR * 0.09)) ** 2
    return (k * 0.5).astype(np.float32)


def pilot(v, line, speed_scale=1.0):
    radio = line["scene"] == "quietRideRadio"
    x = v.say("vale", tts_text(line["text"]), (1.12 if radio else 1.0) * speed_scale)
    x = dsp.pitch(x, SR, -0.8)
    if radio:
        x = dsp.bandpass(x, SR, 380, 3300, order=3)
        x = dsp.drive(dsp.peak_normalize(x, 0.9), 3.0)
        x = dsp.bitcrush(x, 7, 0.22)
        speech = len(x) / SR + 0.12
        x = np.concatenate([squelch(), dsp.silence(SR, 0.03), x, dsp.silence(SR, 0.05), squelch()])
        x = x + radio_static(len(x))
    else:
        x = dsp.bandpass(x, SR, 260, 4200, order=2)
        x = dsp.drive(dsp.peak_normalize(x, 0.9), 1.8)
        speech = len(x) / SR
        x = x + radio_static(len(x), 0.008)
        x = room(x, "heli")
    return dsp.normalize(x, SR, -19), speech


def narrator(v, line, speed_scale=1.0):
    """The briefing: HALCYON's voice telling it, without the PA's chime."""
    x = v.say("halcyon", tts_text(line["text"]), 0.95 * speed_scale)
    comb = np.zeros_like(x)
    d = int(SR * 0.0045)
    comb[d:] = x[:-d]
    x = x + comb * 0.18
    x = dsp.bitcrush(x, 11, 0.06)
    x = dsp.bandpass(x, SR, 120, 9000, order=1)
    speech = len(x) / SR
    x = dsp.reverb(x, SR, rt60=0.9, wet=0.1, predelay=0.015, damp=4500)
    return dsp.normalize(x, SR, -18), speech


def you(v, line, who, speed_scale=1.0):
    """Subject 07: clear and tired, in the character's own voice."""
    x = v.say(who, tts_text(line["text"]), 0.9 * speed_scale)
    x = x + dsp.whisper(x, SR) * 0.35
    throat = 1.12 if who == "you-f" else 0.95
    lead = dsp.breath(SR, 0.45, inhale=False, effort=0.4, throat=throat) * 0.3
    speech = (len(lead) + len(x)) / SR
    x = np.concatenate([lead, x])
    return dsp.normalize(room(x, "heli"), SR, -18), speech


# --------------------------------------------------------------------------

def file_id(key):
    return hashlib.sha1(key.encode("utf8")).hexdigest()[:10]


def render(v, line, scale=1.0):
    who = line["who"]
    if who == "okoro":
        return okoro(v, line, scale)
    if who == "vale":
        return vale(v, line, scale)
    if who == "halcyon":
        return halcyon(v, line, scale)
    if who == "pilot":
        return pilot(v, line, scale)
    if who == "narrator":
        return narrator(v, line, scale)
    raise ValueError(who)


# How much longer than its subtitle's reading time a line may run before it
# is sped up (Vale is slow on purpose; the radio has to fit its beat).
STRETCH = {"okoro": 1.12, "vale": 1.45, "halcyon": 1.5, "pilot": 1.12, "narrator": 9.0}
FIXED = {"quietRideRadio": 4.1}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--lines", required=True)
    ap.add_argument("--only", default=None, help="regex on 'who|text'")
    args = ap.parse_args()
    dsp.seed(212)
    v = Voices(args.model)
    lines = json.load(open(args.lines))
    os.makedirs(OUT, exist_ok=True)
    manifest = read_manifest()
    for line in lines:
        key = line["key"]
        if args.only and not re.search(args.only, key):
            continue
        name = f"{line['who']}-{file_id(key)}"
        if line["who"] == "you":
            for g, who in (("f", "you-f"), ("m", "you-m")):
                x, speech = you(v, line, who)
                dsp.encode(x, SR, os.path.join(OUT, f"{name}-{g}.mp3"))
            manifest[key] = [name, round(speech, 2), round(len(x) / SR, 2), 1]
            print(f"{key[:70]:70s} {speech:5.2f}s (gendered)")
            continue
        limit = FIXED.get(line["scene"], line["hold"] * STRETCH[line["who"]])
        scale = 1.0
        x, speech = render(v, line, scale)
        for _ in range(3):
            if speech <= limit:
                break
            scale *= min(1.3, speech / limit * 1.02)
            x, speech = render(v, line, scale)
        dsp.encode(x, SR, os.path.join(OUT, f"{name}.mp3"))
        manifest[key] = [name, round(speech, 2), round(len(x) / SR, 2)]
        flag = "  (over)" if speech > limit else ""
        print(f"{key[:70]:70s} {speech:5.2f}s / read {line['hold']:4.2f}s  x{scale:.2f}{flag}")

    # Vale's laugh (the ending's "[laughs]") and laughs for anywhere else.
    for kind, context in (("maniac", "close"), ("cackle", "intercom")):
        x, speech = vale_laugh(v, kind, context)
        name = f"vale-laugh-{kind}"
        dsp.encode(x, SR, os.path.join(OUT, f"{name}.mp3"))
        manifest[f"#laugh-{kind}"] = [name, round(speech, 2), round(len(x) / SR, 2)]
        print(f"laugh {kind}: {speech:.2f}s ({len(x) / SR:.2f}s with the echo)")

    # Drop clips whose lines are gone.
    keep = {k for k in manifest if k.startswith("#")} | {l["key"] for l in lines}
    manifest = {k: manifest[k] for k in sorted(manifest) if k in keep}
    write_manifest(manifest)
    # Recordings no line uses any more (its words changed) go.
    used = set()
    for file, *rest in manifest.values():
        used |= {f"{file}-f.mp3", f"{file}-m.mp3"} if len(rest) > 2 and rest[2] else {f"{file}.mp3"}
    for f in os.listdir(OUT):
        if f.endswith(".mp3") and f not in used:
            os.remove(os.path.join(OUT, f))
            print(f"removed {f} (no longer used)")


def read_manifest():
    """The clips already made (so --only can redo a few lines)."""
    if not os.path.exists(MANIFEST):
        return {}
    text = open(MANIFEST, encoding="utf8").read()
    return {json.loads(k): json.loads(v) for k, v in re.findall(r'^  (".*"): (\[[^\]]*\]),?$', text, re.M)}


def write_manifest(manifest):
    body = ",\n".join(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v)}" for k, v in manifest.items())
    with open(MANIFEST, "w") as f:
        f.write(
            "/**\n"
            " * Generated by tools/audio/voices.py - do not edit by hand.\n"
            " *\n"
            " * Every voiced line, keyed by `who|text` exactly as in the script:\n"
            " *   [file (assets/audio/voice/<file>.mp3), seconds of speech, seconds in all, gendered]\n"
            " * `gendered` lines have -f and -m files (the character picked). A line\n"
            " * whose text has changed since it was recorded is not here: it falls back\n"
            " * to the voice blip until the generator is run again.\n"
            " */\n\n"
            f"export const VOICE_LINES = {{\n{body},\n}};\n"
        )


if __name__ == "__main__":
    main()
