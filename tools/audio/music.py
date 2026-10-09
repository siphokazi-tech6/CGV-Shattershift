"""
The game's score - each stage's music composed and rendered offline.

    python tools/audio/music.py [--only NAME]

A small synthesizer and sequencer in numpy (band-limited wavetable
oscillators, filters with envelopes, drums from first principles, a
convolution hall) renders each piece as a seamless loop: the reverb tail of
the last bar is folded back over the first, so it wraps without a seam.

  foundry   D minor, 120 bpm - industrial: a press and an anvil for drums, a
            driving bass, the countdown ticking under everything
  labs      C# minor, 96 bpm - horror: a drone, string clusters that won't
            resolve, a heartbeat, a detuned music box (the patients' ward)
  skyline   E minor, 140 bpm - the escape: string ostinato, taiko, a brass
            line that climbs, the clock again
  roof      C minor, 150 bpm - the last stand: distorted bass, heavy drums,
            a dark choir, an alarm-like motif
  tension   suspense for the wake-up and the failing lift: drone, pulse, ticks
  grief     A minor, 66 bpm - the quiet ride up after Okoro: piano and strings

Writes assets/audio/music/<name>.mp3.
"""

import argparse
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(__file__))
import dsp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "audio", "music")
SR = 44100
R = None

NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def hz(name):
    """'C#4' -> Hz (A4 = 440)."""
    if isinstance(name, (int, float)):
        return float(name)
    pitch, octave = name[:-1], int(name[-1])
    return 440.0 * 2 ** ((NOTE[pitch] + 12 * (octave + 1) - 69) / 12)


def tx(seconds):
    return np.arange(int(SR * seconds)) / SR


# --------------------------------------------------------------------------
# Oscillators
# --------------------------------------------------------------------------

_TABLES = {}


def table(shape, f):
    """One band-limited cycle for a fundamental (harmonics stop below 18 kHz)."""
    h = max(1, min(160, int(18000 / max(f, 1))))
    key = (shape, h)
    if key not in _TABLES:
        n = 2048
        ph = np.arange(n) / n * 2 * np.pi
        k = np.arange(1, h + 1)
        if shape == "saw":
            amps = 1 / k
        elif shape == "square":
            amps = np.where(k % 2 == 1, 1 / k, 0)
        elif shape == "tri":
            amps = np.where(k % 2 == 1, 1 / k ** 2 * (-1) ** ((k - 1) // 2), 0)
        else:
            amps = (k == 1).astype(float)
        tab = (np.sin(np.outer(ph, k)) * amps).sum(axis=1)
        _TABLES[key] = (tab / np.max(np.abs(tab))).astype(np.float32)
    return _TABLES[key]


def osc(shape, f, seconds, detune_cents=0.0, vibrato=(0.0, 0.0), phase=None, glide=None):
    n = int(SR * seconds)
    fr = np.full(n, f * 2 ** (detune_cents / 1200), dtype=np.float64)
    if glide is not None:
        fr *= np.interp(np.arange(n), [0, n - 1], [1.0, glide])
    if vibrato[1]:
        fr *= 1 + vibrato[1] * np.sin(2 * np.pi * vibrato[0] * np.arange(n) / SR + R.uniform(0, 6.28))
    tab = table(shape, f)
    ph = (np.cumsum(fr / SR) + (R.uniform(0, 1) if phase is None else phase)) % 1.0
    idx = ph * len(tab)
    i0 = idx.astype(int) % len(tab)
    frac = (idx - np.floor(idx)).astype(np.float32)
    return tab[i0] * (1 - frac) + tab[(i0 + 1) % len(tab)] * frac


def supersaw(f, seconds, voices=7, spread=18.0, shape="saw"):
    out = np.zeros(int(SR * seconds), dtype=np.float32)
    for i in range(voices):
        d = (i - (voices - 1) / 2) / max(1, (voices - 1) / 2) * spread
        out += osc(shape, f, seconds, d)
    return out / np.sqrt(voices)


def adsr(seconds, a=0.01, d=0.1, s=0.7, r=0.2, hold=None):
    n = int(SR * seconds)
    t = np.arange(n) / SR
    hold = seconds - r if hold is None else hold
    env = np.where(t < a, t / max(a, 1e-4), np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-4), s))
    rel = t > hold
    env[rel] = env[rel] * np.clip(1 - (t[rel] - hold) / max(r, 1e-4), 0, 1)
    return env.astype(np.float32)


def filt_env(x, start, end, seconds, curve=1.0, q_order=2):
    """A low-pass gliding from start to end Hz over `seconds` (then held)."""
    out = np.zeros_like(x)
    block = 256
    zi = None
    for i in range(0, len(x), block):
        k = min(1.0, (i / SR) / max(seconds, 1e-4)) ** curve
        f = start * (end / start) ** k
        sos = signal.butter(q_order, min(f, SR * 0.45), "lowpass", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
    return out.astype(np.float32)


# --------------------------------------------------------------------------
# Instruments (each returns a mono note)
# --------------------------------------------------------------------------

def pad(f, seconds, bright=1800, attack=1.2, release=1.5, voices=7):
    x = supersaw(f, seconds + release, voices, 14)
    x = dsp.lowpass(x, SR, bright, order=2)
    return x * adsr(seconds + release, attack, 0.5, 0.85, release, hold=seconds)


def choir(f, seconds, vowel="a", attack=0.9, release=1.2):
    x = supersaw(f, seconds + release, 5, 9) * 0.6
    x = osc("saw", f, seconds + release, 0, vibrato=(5.2, 0.006)) * 0.5 + x
    forms = {"a": [(730, 7, 1.0), (1090, 9, 0.6), (2440, 12, 0.3)], "o": [(570, 7, 1.0), (840, 9, 0.6), (2410, 12, 0.2)], "u": [(300, 6, 1.0), (870, 9, 0.4), (2240, 12, 0.15)]}[vowel]
    y = dsp.formants(x, SR, forms) * 3 + dsp.lowpass(x, SR, 500) * 0.2
    return y * adsr(seconds + release, attack, 0.4, 0.9, release, hold=seconds)


def pluck_bass(f, seconds, cutoff=(2400, 180), drive_amt=1.6, sub=0.6):
    x = osc("saw", f, seconds, 0) * 0.6 + osc("square", f, seconds, 7) * 0.4
    x = filt_env(x, cutoff[0], cutoff[1], seconds * 0.6, 0.5)
    x = x + osc("sine", f / 2 if f > 70 else f, seconds) * sub
    x = dsp.drive(x * 0.8, drive_amt)
    return x * adsr(seconds, 0.003, seconds * 0.5, 0.5, min(0.05, seconds * 0.3))


def staccato(f, seconds, bright=3200):
    x = supersaw(f, seconds, 3, 10)
    x = filt_env(x, bright, 700, seconds, 0.6)
    return x * adsr(seconds, 0.004, seconds * 0.6, 0.35, min(0.06, seconds * 0.4))


def brass(f, seconds, attack=0.18):
    x = supersaw(f, seconds + 0.4, 4, 7) + osc("square", f, seconds + 0.4, -4) * 0.3
    x = filt_env(x, 400, 2600, attack + 0.25, 0.7)
    x = dsp.eq(x, SR, "peak", 1200, 4, 0.9)
    return dsp.drive(x, 1.4) * adsr(seconds + 0.4, attack, 0.3, 0.8, 0.4, hold=seconds)


def piano(f, seconds=3.0, vel=0.8):
    """Additive piano-ish: stretched partials, highs die first, a hammer knock."""
    t = tx(seconds)
    x = np.zeros(len(t), dtype=np.float64)
    B = 0.0004
    for k in range(1, 14):
        fk = f * k * np.sqrt(1 + B * k * k)
        if fk > 16000:
            break
        x += np.sin(2 * np.pi * fk * t + R.uniform(0, 6.28)) * (vel ** (k * 0.3)) / k ** 1.1 * np.exp(-t * (0.6 + 0.35 * k) * (f / 260) ** 0.4)
    hammer = dsp.lowpass(R.standard_normal(int(SR * 0.02)).astype(np.float32), SR, 2500) * np.exp(-np.arange(int(SR * 0.02)) / (SR * 0.004))
    x[: len(hammer)] += hammer * 0.15
    return (x * np.minimum(1, t / 0.002) * vel).astype(np.float32)


def music_box(f, seconds=2.5, detune=-25):
    """FM bell, a little flat: a child's music box gone wrong."""
    t = tx(seconds)
    fc = f * 2 ** (detune / 1200)
    idx = 2.2 * np.exp(-t * 6)
    x = np.sin(2 * np.pi * fc * t + idx * np.sin(2 * np.pi * fc * 3.5 * t)) * np.exp(-t * 2.2)
    x += 0.25 * np.sin(2 * np.pi * fc * 2.01 * t) * np.exp(-t * 4)
    return x.astype(np.float32)


def drone(f, seconds, cutoff=320):
    x = supersaw(f, seconds, 5, 6) * 0.7 + osc("sine", f / 2, seconds) * 0.6
    lfo = 1 + 0.5 * np.sin(2 * np.pi * 0.05 * tx(seconds) + R.uniform(0, 6))
    return dsp.lowpass(x, SR, cutoff) * (0.8 + 0.2 * lfo)


def kick(vel=1.0, punch=1.0):
    t = tx(0.6)
    f = 52 + 110 * np.exp(-t / 0.035) * punch
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.28)
    click = R.standard_normal(int(SR * 0.004)) * 0.4
    x[: len(click)] += click
    return (dsp.drive(x.astype(np.float32), 1.5) * vel)


def snare(vel=1.0, tone=190, decay=0.16):
    t = tx(0.5)
    n = dsp.bandpass(R.standard_normal(len(t)).astype(np.float32), SR, 1200, 9000) * np.exp(-t / decay)
    body = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.06)
    return ((n * 0.8 + body * 0.6) * vel).astype(np.float32)


def hat(vel=1.0, open_=False):
    d = 0.22 if open_ else 0.035
    t = tx(d * 4)
    n = dsp.highpass(R.standard_normal(len(t)).astype(np.float32), SR, 7500) * np.exp(-t / d)
    return n * vel * 0.5


def taiko(vel=1.0, f0=95):
    t = tx(1.4)
    f = f0 * (0.6 + 0.4 * np.exp(-t / 0.06))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.45)
    skin = dsp.lowpass(R.standard_normal(len(t)).astype(np.float32), SR, 1400) * np.exp(-t / 0.05) * 0.5
    return (dsp.drive((x + skin).astype(np.float32), 1.3) * vel)


def tom(vel, f0):
    t = tx(0.7)
    f = f0 * (0.75 + 0.25 * np.exp(-t / 0.05))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    return (x * vel).astype(np.float32)


def anvil(vel=1.0, f0=420):
    """A hammer on steel: inharmonic partials, a hard attack."""
    t = tx(1.2)
    x = R.standard_normal(int(SR * 0.006)).astype(np.float32) * 0.8
    x = dsp.pad_to(x, len(t))
    for m, g, d in [(1, 1, 0.4), (2.71, 0.7, 0.25), (5.18, 0.5, 0.15), (8.43, 0.3, 0.08), (11.9, 0.2, 0.05)]:
        x += np.sin(2 * np.pi * f0 * m * t) * np.exp(-t / d) * g * 0.35
    return (x * vel).astype(np.float32)


def press(vel=1.0):
    """The foundry's press: a heavy thud with a hiss after it."""
    t = tx(0.9)
    f = 48 + 60 * np.exp(-t / 0.04)
    thud = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.25)
    hiss = dsp.highpass(R.standard_normal(len(t)).astype(np.float32), SR, 3000) * np.exp(-((t - 0.25) ** 2) / 0.02) * 0.12
    return ((thud + hiss) * vel).astype(np.float32)


def tick(vel=1.0, tock=False):
    t = tx(0.08)
    f = 1900 if not tock else 1250
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.008) + R.standard_normal(len(t)) * np.exp(-t / 0.002) * 0.4
    return dsp.bandpass(x.astype(np.float32), SR, 700, 6000) * vel


def heartbeat(vel=1.0):
    out = np.zeros(int(SR * 0.6), dtype=np.float32)
    for at, g in [(0.0, 1.0), (0.17, 0.7)]:
        t = tx(0.25)
        b = np.sin(2 * np.pi * (48 + 20 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.07) * g
        dsp.mix_into(out, b.astype(np.float32), int(at * SR))
    return out * vel


def braam(f, seconds=3.0):
    """The cinematic 'braam': low brass and saws ripping open."""
    x = sum(supersaw(f * m, seconds, 5, 12) * g for m, g in [(1, 1.0), (2, 0.6), (3, 0.25)])
    x = filt_env(x, 150, 2600, 0.7, 0.6)
    x = dsp.drive(x * 0.6, 2.4)
    x += osc("sine", f / 2, seconds) * 0.7
    return x * adsr(seconds, 0.05, 0.6, 0.7, 1.4)


def riser(seconds=2.0):
    t = tx(seconds)
    n = R.standard_normal(len(t)).astype(np.float32)
    out = np.zeros_like(n)
    block = 512
    zi = None
    for i in range(0, len(n), block):
        k = i / len(n)
        f = 300 * (9000 / 300) ** k
        sos = signal.butter(2, [f * 0.7, min(f * 1.4, SR * 0.45)], "bandpass", fs=SR, output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = signal.sosfilt(sos, n[i:i + block], zi=zi)
    return out * (t / seconds) ** 2 * 0.6


def reverse_cymbal(seconds=1.5):
    t = tx(seconds)
    n = dsp.highpass(R.standard_normal(len(t)).astype(np.float32), SR, 4000)
    return n * (t / seconds) ** 3 * 0.5


def boom(vel=1.0):
    t = tx(3.0)
    f = 30 + 40 * np.exp(-t / 0.15)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 1.0)
    rumble = dsp.lowpass(R.standard_normal(len(t)).astype(np.float32), SR, 200) * np.exp(-t / 0.8) * 0.5
    return ((x + rumble) * vel).astype(np.float32)


def scrape(seconds=3.0, f0=180):
    """Bowed metal: friction noise ringing a few steel modes."""
    t = tx(seconds)
    exc = dsp.lowpass(R.standard_normal(len(t)).astype(np.float32), SR, 3000) * np.sin(np.pi * t / seconds) ** 2
    y = np.zeros_like(exc)
    for m in (1, 2.32, 3.97, 6.1):
        y += dsp.resonator(exc, SR, f0 * m * R.uniform(0.98, 1.02), 60) * (1 / m)
    return y * 0.8


def tremolo_strings(fs, seconds, rate=12):
    x = sum(supersaw(hz(f), seconds, 3, 8) for f in fs)
    x = dsp.lowpass(x, SR, 6000)
    x = dsp.tremolo(x, SR, rate, 0.7)
    return x * adsr(seconds, 1.5, 0.5, 0.9, 1.5)


# --------------------------------------------------------------------------
# Sequencer
# --------------------------------------------------------------------------

class Song:
    BUSES = {
        # name: (reverb rt60, wet, sidechained)
        "drums": (1.2, 0.18, False),
        "perc": (2.2, 0.3, False),
        "bass": (0.6, 0.05, True),
        "pad": (3.2, 0.38, True),
        "lead": (2.4, 0.3, False),
        "fx": (3.5, 0.45, False),
        "dry": (0.5, 0.05, False),
    }

    def __init__(self, bpm, bars, beats=4, tail=4.0):
        self.bpm = bpm
        self.beat = 60.0 / bpm
        self.length = bars * beats * self.beat
        self.beats = beats
        self.tail = tail
        n = int(SR * (self.length + tail))
        self.buses = {k: np.zeros((n, 2), dtype=np.float32) for k in self.BUSES}
        self.kicks = np.zeros(n, dtype=np.float32)

    def t(self, bar, beat=0.0):
        return (bar * self.beats + beat) * self.beat

    def add(self, bus, x, at, gain=1.0, pan=0.0, kick=False):
        i = int(at * SR)
        y = dsp.stereo(x, pan) if x.ndim == 1 else x
        dsp.mix_into(self.buses[bus], y, i, gain)
        if kick:
            dsp.mix_into(self.kicks, np.ones(int(SR * 0.02), dtype=np.float32), i)

    def render(self, sidechain=0.45, master_db=-18.0):
        n = int(SR * self.length)
        tail = len(self.kicks) - n
        # The pump: everything sidechained ducks under the kick.
        duck = np.ones(len(self.kicks), dtype=np.float32)
        if sidechain and self.kicks.any():
            env = signal.lfilter([1], [1, -np.exp(-1 / (SR * 0.12))], self.kicks) * (1 - np.exp(-1 / (SR * 0.12)))
            env = np.clip(env / (env.max() + 1e-9), 0, 1)
            duck = 1 - sidechain * env
        mix = np.zeros((len(self.kicks), 2), dtype=np.float32)
        for name, buf in self.buses.items():
            rt, wet, side = self.BUSES[name]
            if not buf.any():
                continue
            if wet:
                ir = dsp.impulse(SR, rt, 0.02, 3800, 8, 1.0, 2)
                wet_sig = np.stack([signal.fftconvolve(buf[:, c], ir[:, c])[: len(buf)] for c in range(2)], axis=1)
                buf = buf * (1 - wet * 0.4) + wet_sig.astype(np.float32) * wet
            if side:
                buf = buf * duck[:, None]
            mix += buf
        # Seamless: the tail (reverb, the last notes ringing) over the top.
        loop = mix[:n].copy()
        loop[:tail] += mix[n:n + tail]
        loop = dsp.highpass(loop, SR, 28)
        loop = dsp.compress(loop, SR, -14, 2.5, 0.01, 0.2)
        return dsp.normalize(loop, SR, master_db, peak=0.86)


def chord_notes(names):
    return [hz(n) for n in names]


# --------------------------------------------------------------------------
# The pieces
# --------------------------------------------------------------------------

def foundry():
    s = Song(120, 32)
    chords = [  # two bars each: i - VI - iv - V
        (["D3", "A3", "D4", "F4"], "D2"),
        (["D3", "Bb3", "D4", "F4"], "Bb1"),
        (["D3", "G3", "Bb3", "D4"], "G1"),
        (["E3", "A3", "C#4", "E4"], "A1"),
    ]
    bass_pat = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0]
    for bar in range(32):
        notes, root = chords[(bar // 2) % 4]
        sec = "intro" if bar < 4 else "a" if bar < 12 else "b" if bar < 20 else "c" if bar < 28 else "out"
        if bar % 2 == 0:
            for i, f in enumerate(chord_notes(notes)):
                s.add("pad", pad(f, s.beat * 8 - 0.2, 1500 if sec in ("intro", "out") else 2200, 0.8), s.t(bar), 0.16, -0.6 + i * 0.4)
        # The bass: a sixteenth-note drive (only the pulse in the intro).
        for k, on in enumerate(bass_pat):
            if not on or (sec in ("intro", "out") and k % 4):
                continue
            f = hz(root) * (2 if k in (6, 14) and sec in ("b", "c") else 1)
            s.add("bass", pluck_bass(f, s.beat / 4 * 0.9, (2600 if k % 4 == 0 else 1600, 160)), s.t(bar, k / 4), 0.5 if k % 4 == 0 else 0.36)
        # The countdown under everything.
        for b in range(4):
            s.add("dry", tick(0.5 if b == 0 else 0.3, tock=b % 2 == 1), s.t(bar, b), 0.5, 0.35)
        if sec in ("a", "b", "c"):
            for b in (0, 2.5) if sec == "a" else (0, 1.5, 2, 2.75):
                s.add("drums", kick(1.0), s.t(bar, b), 0.85, kick=True)
            # The press and the anvil instead of a snare.
            for b in (1, 3):
                s.add("drums", press(0.7), s.t(bar, b), 0.6)
                s.add("perc", anvil(0.7, 420 if b == 1 else 470), s.t(bar, b), 0.32, 0.3 if b == 1 else -0.3)
            for k in range(16 if sec != "a" else 8):
                step = k / (4 if sec != "a" else 2)
                s.add("drums", hat(0.8 if k % 2 == 0 else 0.45), s.t(bar, step + (0.04 if k % 2 else 0)), 0.32, 0.4)
        if sec in ("b", "c"):
            # Upper strings, driving eighths on the chord.
            for k in range(8):
                f = chord_notes(notes)[1 + (k % 3)] * 2
                s.add("lead", staccato(f, s.beat / 2 * 0.8), s.t(bar, k / 2), 0.17, 0.25 if k % 2 else -0.25)
        if sec == "c" and bar % 4 == 3:
            for k, f0 in enumerate((180, 150, 120, 95)):
                s.add("perc", tom(0.8, f0), s.t(bar, 3 + k / 4), 0.5, 0.5 - k * 0.3)
        if bar in (4, 20):
            s.add("fx", braam(hz("D1"), 3.5), s.t(bar), 0.38)
            s.add("perc", boom(0.9), s.t(bar), 0.5)
        if bar in (11, 19, 27):
            s.add("fx", reverse_cymbal(s.beat * 4), s.t(bar), 0.4)
        if bar == 30:
            s.add("fx", riser(s.beat * 8), s.t(bar), 0.45)
        if sec in ("intro", "out") and bar % 2 == 0:
            s.add("drums", press(0.6), s.t(bar), 0.5)
            s.add("perc", anvil(0.5, 380), s.t(bar, 2), 0.25, -0.4)
    return s.render(0.4, -18)


def labs():
    s = Song(96, 28, tail=5.0)
    total = s.length
    # The drone, all the way through, C# and its fifth's ghost.
    s.add("pad", drone(hz("C#2"), total + 2, 260), 0, 0.35)
    s.add("pad", drone(hz("G#1"), total + 2, 200), 0, 0.18)
    clusters = [["C#3", "D3", "G#3"], ["A2", "C3", "D#3"], ["F#2", "G2", "C#3"], ["G2", "A#2", "C#3"]]
    for bar in range(0, 28, 4):
        notes = clusters[(bar // 4) % 4]
        for i, n in enumerate(notes):
            s.add("pad", pad(hz(n), s.beat * 14, 900, 3.0, 2.5, 5), s.t(bar), 0.16, -0.5 + i * 0.5)
        s.add("perc", boom(0.7), s.t(bar), 0.4)
    # The music box: a lullaby, slightly flat, from somewhere in the ward.
    lullaby = [("C#5", 0), ("E5", 1), ("D#5", 2), ("G#4", 3), ("C#5", 4.5), ("B4", 5.5), ("G4", 6), ("C#5", 7)]
    for start in (4, 16):
        for n, b in lullaby:
            s.add("lead", music_box(hz(n)), s.t(start, b), 0.2, 0.5)
    # The heartbeat, then the pulse.
    for bar in range(8, 28):
        for b in (0, 2) if bar < 20 else (0, 1, 2, 3):
            s.add("drums", heartbeat(0.9), s.t(bar, b), 0.55, kick=True)
        if bar >= 12:
            for k in range(8):
                if bar < 20 and k % 2:
                    continue
                s.add("bass", pluck_bass(hz("C#2") if k % 4 else hz("C#1") * 2, s.beat / 2 * 0.6, (900, 120), 1.4, 0.4), s.t(bar, k / 2), 0.28)
        if bar >= 20 and bar % 2 == 0:
            s.add("perc", taiko(0.8, 80), s.t(bar), 0.45)
            s.add("perc", taiko(0.5, 110), s.t(bar, 2.5), 0.3, 0.4)
    # The strings that won't stop shaking.
    s.add("lead", tremolo_strings(["C#6", "D6"], s.beat * 32), s.t(20), 0.06, 0.2)
    s.add("lead", tremolo_strings(["G5"], s.beat * 16), s.t(12), 0.05, -0.3)
    # Bowed metal, in the dark.
    for at in (2, 9, 14, 23):
        s.add("fx", scrape(4.0, R.uniform(140, 260)), s.t(at, R.uniform(0, 2)), 0.5, R.uniform(-0.7, 0.7))
    for bar in (7, 19):
        s.add("fx", reverse_cymbal(s.beat * 4), s.t(bar), 0.35)
    return s.render(0.3, -20)


def skyline():
    s = Song(140, 32)
    prog = [
        (["E3", "B3", "E4", "G4"], "E2"), (["E3", "G3", "C4", "E4"], "C2"),
        (["D3", "G3", "B3", "D4"], "G1"), (["D3", "F#3", "A3", "D4"], "D2"),
        (["E3", "B3", "E4", "G4"], "E2"), (["E3", "G3", "C4", "E4"], "C2"),
        (["E3", "A3", "C4", "E4"], "A1"), (["D#3", "F#3", "B3", "D#4"], "B1"),
    ]
    melody = [  # (bar offset, beat, note, beats) - over bars 16..31
        (0, 0, "B4", 3), (0, 3, "G4", 1), (1, 0, "E5", 4), (2, 0, "D5", 2), (2, 2, "B4", 2), (3, 0, "A4", 4),
        (4, 0, "B4", 3), (4, 3, "C5", 1), (5, 0, "E5", 3), (5, 3, "G5", 1), (6, 0, "F#5", 2), (6, 2, "E5", 2), (7, 0, "D#5", 4),
    ]
    for bar in range(32):
        notes, root = prog[bar % 8]
        sec = "intro" if bar < 4 else "a" if bar < 16 else "b" if bar < 28 else "out"
        for i, f in enumerate(chord_notes(notes)):
            s.add("pad", pad(f, s.beat * 4 - 0.1, 2400 if sec == "b" else 1700, 0.5, 0.8), s.t(bar), 0.13, -0.6 + i * 0.4)
        if sec in ("b",):
            for i, f in enumerate(chord_notes(notes)[1:3]):
                s.add("pad", choir(f, s.beat * 4 - 0.1, "a"), s.t(bar), 0.1, -0.4 + i * 0.8)
        # The ostinato: eighths, root and fifth and octave.
        pattern = [0, 12, 7, 12, 0, 12, 7, 15] if root[0] in "EA" else [0, 12, 7, 12, 0, 12, 7, 14]
        for k, iv in enumerate(pattern):
            f = hz(root) * 2 * 2 ** (iv / 12)
            s.add("lead", staccato(f, s.beat / 2 * 0.75, 2800 if sec != "intro" else 1800), s.t(bar, k / 2), 0.16 if sec != "intro" else 0.11, 0.3 if k % 2 else -0.3)
        for k in range(4 if sec == "intro" else 8):
            s.add("bass", pluck_bass(hz(root), s.beat / 2 * 0.85, (1800, 150), 1.5, 0.7), s.t(bar, k / (1 if sec == "intro" else 2)), 0.42)
        if sec != "intro":
            for b in (0, 1.5, 2.5):
                s.add("perc", taiko(1.0 if b == 0 else 0.7), s.t(bar, b), 0.62, -0.2 if b else 0, kick=True)
            if sec == "b" or bar % 2:
                s.add("drums", snare(0.9), s.t(bar, 3), 0.45)
            for k in range(16):
                s.add("dry", tick(0.35 if k % 4 else 0.6), s.t(bar, k / 4), 0.35, 0.5)
            if bar % 4 == 3:
                for k in range(8):
                    s.add("drums", snare(0.3 + k * 0.08, 210, 0.08), s.t(bar, 2 + k / 4), 0.45)
        else:
            for b in range(4):
                s.add("dry", tick(0.6 if b == 0 else 0.4, b % 2 == 1), s.t(bar, b), 0.45, 0.4)
        if bar in (4, 16, 24):
            s.add("fx", braam(hz("E1"), 3.0), s.t(bar), 0.32)
            s.add("perc", boom(0.9), s.t(bar), 0.5)
        if bar in (3, 15, 30):
            s.add("fx", riser(s.beat * (8 if bar == 30 else 4)), s.t(bar if bar != 30 else 30), 0.45)
    for bo, b, n, d in melody:
        s.add("lead", brass(hz(n), s.beat * d - 0.05), s.t(16 + bo, b), 0.2, 0.0)
        s.add("lead", brass(hz(n) / 2, s.beat * d - 0.05), s.t(16 + bo, b), 0.1, 0.0)
    for bo, b, n, d in melody:  # and again an octave down, darker, at the end
        if bo < 4:
            s.add("lead", brass(hz(n) / 2, s.beat * d - 0.05, 0.25), s.t(24 + bo, b), 0.14, 0.15)
    return s.render(0.35, -18)


def roof():
    s = Song(150, 32)
    prog = [(["C3", "G3", "C4", "Eb4"], "C2"), (["C3", "Ab3", "C4", "Eb4"], "Ab1"), (["C3", "F3", "Ab3", "C4"], "F1"), (["B2", "D3", "G3", "B3"], "G1")]
    motif = [("C5", 0), ("G5", 0.5), ("Ab5", 1), ("G5", 1.5), ("Eb5", 2), ("D5", 2.5), ("C5", 3)]
    for bar in range(32):
        notes, root = prog[(bar // 2) % 4]
        sec = "intro" if bar < 4 else "a" if bar < 16 else "b" if bar < 28 else "out"
        if bar % 2 == 0:
            for i, f in enumerate(chord_notes(notes)):
                s.add("pad", choir(f, s.beat * 8 - 0.2, "o" if sec == "intro" else "a"), s.t(bar), 0.12, -0.6 + i * 0.4)
        for k in range(8):
            oct_ = 2 if k in (3, 7) and sec != "intro" else 1
            s.add("bass", pluck_bass(hz(root) * oct_, s.beat / 2 * 0.85, (2200, 200), 3.0, 0.7), s.t(bar, k / 2), 0.4)
        if sec != "intro":
            for b in (0, 1.5, 2) if sec == "a" else (0, 0.75, 1.5, 2, 2.75):
                s.add("drums", kick(1.0, 1.2), s.t(bar, b), 0.85, kick=True)
            for b in (1, 3):
                s.add("drums", snare(1.0, 200, 0.2), s.t(bar, b), 0.6)
            for k in range(8):
                s.add("drums", hat(0.9 if k % 2 else 0.5, open_=(k == 7)), s.t(bar, k / 2), 0.3, 0.4)
        else:
            s.add("perc", taiko(0.9, 85), s.t(bar), 0.6)
            s.add("perc", taiko(0.6, 85), s.t(bar, 2.5), 0.4)
        if sec == "b" and bar % 2 == 0:
            for n, b in motif:
                s.add("lead", staccato(hz(n), s.beat / 2 * 0.9, 4500), s.t(bar, b), 0.2, 0.1)
                s.add("lead", staccato(hz(n) / 2, s.beat / 2 * 0.9, 3000), s.t(bar, b), 0.12, -0.1)
        if sec == "a" and bar % 4 == 2:
            s.add("lead", brass(hz("G4"), s.beat * 2), s.t(bar, 2), 0.18)
            s.add("lead", brass(hz("Ab4"), s.beat * 2), s.t(bar + 1, 0), 0.18)
        if bar in (4, 16, 28):
            s.add("fx", braam(hz("C1"), 3.5), s.t(bar), 0.36)
            s.add("perc", boom(1.0), s.t(bar), 0.5)
        if bar in (3, 15, 30):
            s.add("fx", riser(s.beat * (8 if bar == 30 else 4)), s.t(bar), 0.45)
        if bar % 8 == 7:
            for k, f0 in enumerate((200, 170, 140, 110, 90, 80)):
                s.add("perc", tom(0.9, f0), s.t(bar, 2.5 + k / 4), 0.55, 0.6 - k * 0.24)
    return s.render(0.45, -17.5)


def tension():
    s = Song(90, 24, tail=5.0)
    total = s.length
    s.add("pad", drone(hz("A1"), total + 2, 240), 0, 0.4)
    s.add("pad", drone(hz("A#1"), total + 2, 180), 0, 0.12)
    for bar in range(24):
        for b in range(4):
            s.add("dry", tick(0.55 if b == 0 else 0.35, b % 2 == 1), s.t(bar, b), 0.5, 0.35)
        if bar >= 4:
            for k in range(8 if bar >= 12 else 4):
                s.add("bass", pluck_bass(hz("A1"), s.beat / 2 * 0.5, (700, 100), 1.3, 0.6), s.t(bar, k / (2 if bar >= 12 else 1)), 0.32, kick=k % 2 == 0)
        if bar % 4 == 0:
            s.add("pad", pad(hz("E4") if bar % 8 else hz("F4"), s.beat * 15, 1400, 3, 2, 5), s.t(bar), 0.09, 0.4)
            s.add("pad", pad(hz("A3"), s.beat * 15, 1100, 3, 2, 5), s.t(bar), 0.09, -0.4)
        if bar >= 16 and bar % 2 == 0:
            s.add("perc", taiko(0.6, 90), s.t(bar), 0.4)
    for at in (3, 11, 19):
        s.add("fx", scrape(4.0, R.uniform(150, 240)), s.t(at), 0.35, R.uniform(-0.6, 0.6))
    s.add("lead", tremolo_strings(["A5", "A#5"], s.beat * 32), s.t(16), 0.04)
    return s.render(0.25, -21)


def grief():
    s = Song(66, 16, tail=6.0)
    prog = [(["A2", "E3", "A3", "C4"], "A1"), (["F2", "C3", "F3", "A3"], "F1"), (["C3", "E3", "G3", "C4"], "C2"), (["G2", "D3", "G3", "B3"], "G1"),
            (["A2", "E3", "A3", "C4"], "A1"), (["F2", "C3", "F3", "A3"], "F1"), (["D3", "F3", "A3", "D4"], "D2"), (["E3", "G#3", "B3", "E4"], "E2")]
    melody = [
        (0, 0, "E5", 1.5), (0, 1.5, "C5", 0.5), (0, 2, "B4", 2), (1, 0, "A4", 3), (1, 3, "C5", 1),
        (2, 0, "G4", 2), (2, 2, "E5", 2), (3, 0, "D5", 4),
        (4, 0, "E5", 1.5), (4, 1.5, "F5", 0.5), (4, 2, "E5", 2), (5, 0, "C5", 3), (5, 3, "A4", 1),
        (6, 0, "F5", 2), (6, 2, "D5", 2), (7, 0, "B4", 3), (7, 3, "G#4", 1),
    ]
    for bar in range(16):
        notes, root = prog[bar % 8]
        for i, f in enumerate(chord_notes(notes)):
            s.add("pad", pad(f, s.beat * 4, 1300, 1.2, 2.0, 5), s.t(bar), 0.11, -0.5 + i * 0.33)
        s.add("bass", osc("sine", hz(root), s.beat * 4) * adsr(s.beat * 4, 0.3, 0.5, 0.8, 0.8) * 0.8, s.t(bar), 0.35)
        # The piano's broken chord.
        for k, f in enumerate(chord_notes(notes)):
            s.add("lead", piano(f * 2, 3.5, 0.5), s.t(bar, k * 0.5 + 2), 0.17, -0.3 + k * 0.2)
    for half in (0, 8):
        for bo, b, n, d in melody:
            if half and bo < 4:
                continue
            s.add("lead", piano(hz(n), 4.0, 0.75), s.t(half + bo, b), 0.3, 0.05)
    # A cello under the second half.
    line = [("A3", 8, 4), ("C4", 9, 4), ("E4", 10, 4), ("D4", 11, 4), ("C4", 12, 4), ("A3", 13, 4), ("F3", 14, 4), ("G#3", 15, 4)]
    for n, bar, beats in line:
        x = supersaw(hz(n), s.beat * beats + 0.8, 3, 5)
        x = dsp.lowpass(x, SR, 1200) * adsr(s.beat * beats + 0.8, 0.5, 0.4, 0.85, 0.8, hold=s.beat * beats)
        x = dsp.vibrato(x, SR, 5, 0.03)
        s.add("pad", x, s.t(bar), 0.14, -0.2)
    return s.render(0.0, -21)


PIECES = {"foundry": foundry, "labs": labs, "skyline": skyline, "roof": roof, "tension": tension, "grief": grief}


def main():
    global R
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for name, piece in PIECES.items():
        if args.only and args.only != name:
            continue
        dsp.seed(sum(map(ord, name)))
        R = dsp.RNG
        x = piece()
        dsp.encode(x, SR, os.path.join(OUT, f"{name}.mp3"), bitrate="128k")
        print(f"{name:10s} {len(x) / SR:6.2f}s")


if __name__ == "__main__":
    main()
