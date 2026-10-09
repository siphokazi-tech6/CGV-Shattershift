"""
The game's rendered sound effects - synthesized offline, so they can be as
detailed as they need to be (real convolution reverb, thousands of grains)
without costing the game anything at run time.

    python tools/audio/sfx.py --model DIR     # DIR: Kokoro, for the player's voice

Writes assets/audio/sfx/*.mp3:

  fire-alarm            the tower's fire alarm: a horn in the Temporal-3
                        pattern (three blasts, a pause), down a concrete
                        corridor - a seamless loop
  breath-*-f / -m       the player (by the character picked): running pant
                        (loop), exhausted panting, frightened held breath,
                        breathing slowing down, effort grunt, pain grunts,
                        a fall scream
  demolition-charges    the charges going off floor by floor, far away
  building-collapse     a tower coming down: rumble, crumbling concrete,
                        steel groaning and snapping, glass, dust
  explosion-1..2        a blast close by
  distant-collapse-1..2 the building giving way somewhere above you
  metal-groan-1..2      steel under load: stick-slip creaks through a beam
  debris                concrete chunks coming down and settling
  sprinkler-burst       a sprinkler bulb popping and the spray starting
  glass-cascade         everything glass breaking at once (built from the
                        team's recorded glass, re-pitched and spread)
  monitor-beep, pistol, clatter, brake, cable-snap, lift-chime, lift-doors,
  body-hit              the cutscenes' sound cues
"""

import argparse
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(__file__))
import dsp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "audio", "sfx")
SFX_IN = os.path.join(ROOT, "assets", "audio", "sound-effects")
SR = 44100
R = None  # the random generator (dsp.RNG after seeding)


def t_axis(seconds):
    return np.arange(int(SR * seconds)) / SR


def noise(seconds):
    return R.standard_normal(int(SR * seconds)).astype(np.float32)


def sweep_lowpass(x, start_hz, end_hz, curve=2.0, block=512):
    """A low-pass whose cut-off glides (block-wise, state kept between blocks)."""
    out = np.zeros_like(x)
    n = len(x)
    zi = None
    for i in range(0, n, block):
        k = (i / max(1, n - 1)) ** (1 / curve)
        hz = start_hz * (end_hz / start_hz) ** k
        sos = signal.butter(2, min(hz, SR * 0.45), "lowpass", fs=SR, output="sos")
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        out[i:i + block], zi = signal.sosfilt(sos, x[i:i + block], zi=zi)
    return out.astype(np.float32)


def seamless(x, tail):
    """Fold a rendered tail back over the start so the loop has no seam."""
    body = x[: len(x) - tail].copy()
    body[:tail] += x[len(x) - tail:]
    return body


def save(name, x, bitrate="128k"):
    path = os.path.join(OUT, f"{name}.mp3")
    # Sharp transients overshoot after mp3 encoding: leave them room.
    dsp.encode(dsp.soft_limit(x, 0.84), SR, path, bitrate=bitrate)
    print(f"{name:24s} {len(x) / SR:6.2f}s")


def outdoor(x, distance=1.0):
    """A city at night: slap-back off the towers, a long open tail."""
    x = dsp.echo(x, SR, 0.38 + 0.2 * distance, 0.3, 3, 1800, pan_spread=0.5)
    return dsp.reverb(x, SR, rt60=2.8 + distance, wet=0.3 + 0.15 * distance, predelay=0.04, damp=2200, stereo_out=True)


# --------------------------------------------------------------------------
# The fire alarm
# --------------------------------------------------------------------------

def fire_alarm():
    """An electromechanical horn: a buzzing reed through a horn's throat, T3 pattern."""
    cycle = 4.0  # on .5, off .5, on .5, off .5, on .5, off 1.5
    cycles = 2
    total = cycle * cycles
    t = t_axis(total)
    f0 = 515.0
    ph = 2 * np.pi * f0 * t + 0.02 * np.sin(2 * np.pi * 60 * t)
    reed = signal.square(ph, 0.32) * 0.6 + signal.sawtooth(ph * 2, 0.5) * 0.25
    reed = reed.astype(np.float32)
    horn = dsp.formants(reed, SR, [(1550, 3, 1.0), (3100, 4, 0.9), (4600, 6, 0.35)]) + reed * 0.15
    gate = np.zeros_like(t)
    for c in range(cycles):
        for k in range(3):
            a = c * cycle + k * 1.0
            on = (t >= a) & (t < a + 0.5)
            gate[on] = 1
    gate = signal.lfilter([0.02], [1, -0.98], gate)  # the reed takes a moment to speak
    x = horn * gate * 0.5
    x = dsp.drive(x, 1.8)
    # Down the corridor: concrete, long and hard.
    tail = int(SR * 2.5)
    x = np.concatenate([x, np.zeros(tail, dtype=np.float32)])
    x = dsp.reverb(x, SR, rt60=2.1, wet=0.45, predelay=0.02, damp=3500, stereo_out=True)[: len(x)]
    x = seamless(x, tail)
    return dsp.normalize(x, SR, -19)


# --------------------------------------------------------------------------
# The player's breath and voice
# --------------------------------------------------------------------------

GENDER = {"f": dict(throat=1.16, f0=215.0), "m": dict(throat=0.97, f0=118.0)}


def breath(g, seconds, inhale, effort, voiced=0.0):
    p = GENDER[g]
    return dsp.breath(SR, seconds, inhale=inhale, effort=effort, voice_hz=p["f0"] * R.uniform(0.9, 1.1), voiced=voiced, throat=p["throat"] * R.uniform(0.97, 1.03))


def run_loop(g):
    """Huffing and puffing on the run: in through the mouth, out hard, in time with the stride."""
    out = dsp.silence(SR, 8.4)
    at = 0.05
    while at < 8.0:
        i_len = R.uniform(0.2, 0.28)
        e_len = R.uniform(0.26, 0.36)
        dsp.mix_into(out, breath(g, i_len, True, R.uniform(0.55, 0.75)) * 0.7, int(at * SR))
        at += i_len + R.uniform(0.02, 0.05)
        double = R.random() < 0.35  # "hh-HUH"
        if double:
            dsp.mix_into(out, breath(g, e_len * 0.5, False, 0.7, voiced=0.25) * 0.75, int(at * SR))
            at += e_len * 0.45
        dsp.mix_into(out, breath(g, e_len, False, R.uniform(0.7, 0.95), voiced=R.uniform(0.2, 0.5)), int(at * SR))
        at += e_len + R.uniform(0.04, 0.1)
    out = out[: int(SR * 8.0)]
    # Each loop ends in the gap after an exhale; a short cross-fade hides the rest.
    out = dsp.fade(out, SR, 0.02, 0.06)
    return dsp.normalize(dsp.reverb(out, SR, rt60=0.3, wet=0.08), SR, -21)[: int(SR * 8.0)]


def panting(g, seconds=4.5, start_rate=2.6, end_rate=1.4, voiced=0.45):
    """Out of breath and slowing down: fast ragged pants easing off."""
    out = dsp.silence(SR, seconds + 0.6)
    at = 0.0
    while at < seconds:
        k = at / seconds
        rate = start_rate + (end_rate - start_rate) * k
        cycle = 1 / rate
        i_len = cycle * R.uniform(0.38, 0.46)
        e_len = cycle * R.uniform(0.44, 0.52)
        effort = 1.0 - 0.45 * k
        dsp.mix_into(out, breath(g, i_len, True, effort * 0.8) * 0.75, int(at * SR))
        dsp.mix_into(out, breath(g, e_len, False, effort, voiced=voiced * (1 - 0.5 * k)), int((at + i_len + 0.02) * SR))
        at += cycle * R.uniform(0.95, 1.08)
    out = dsp.fade(out, SR, 0.01, 0.4)
    return dsp.normalize(dsp.reverb(out, SR, rt60=0.4, wet=0.1), SR, -20)


def scared(g):
    """Hiding: a shaky breath in, held, let out in a tremble."""
    out = dsp.silence(SR, 3.6)
    inhale = dsp.tremolo(breath(g, 0.85, True, 0.45), SR, 11, 0.5, jitter=6)
    dsp.mix_into(out, inhale * 0.8, int(0.05 * SR))
    exhale = dsp.tremolo(breath(g, 1.5, False, 0.4, voiced=0.12), SR, 9, 0.65, jitter=5)
    dsp.mix_into(out, exhale, int(1.6 * SR))
    dsp.mix_into(out, breath(g, 0.35, True, 0.3) * 0.5, int(3.15 * SR))
    return dsp.normalize(dsp.reverb(out, SR, rt60=0.5, wet=0.1), SR, -23)


def recover(g):
    """On your back, alive: long breaths, slower each time."""
    out = dsp.silence(SR, 6.0)
    at = 0.05
    for i, (inn, ex) in enumerate([(0.55, 0.8), (0.65, 1.0), (0.8, 1.25), (0.9, 1.4)]):
        dsp.mix_into(out, breath(g, inn, True, 0.55 - i * 0.08) * 0.8, int(at * SR))
        at += inn + 0.05
        dsp.mix_into(out, breath(g, ex, False, 0.6 - i * 0.1, voiced=0.2 if i == 0 else 0.05), int(at * SR))
        at += ex + 0.15 + i * 0.05
    out = dsp.fade(out[: int(min(at, 6.0) * SR)], SR, 0.01, 0.3)
    return dsp.normalize(dsp.reverb(out, SR, rt60=1.2, wet=0.12), SR, -21)


class PlayerVoice:
    """Grunts and screams from Kokoro, for the effort and the pain."""

    def __init__(self, model_dir):
        self.k = None
        if model_dir:
            from kokoro_onnx import Kokoro
            self.k = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))

    def say(self, g, text, speed=1.0):
        voice = "af_heart" if g == "f" else "am_echo"
        samples, sr = self.k.create(text, voice=self.k.get_voice_style(voice), speed=speed, lang="en-us")
        x = signal.resample_poly(samples.astype(np.float32), SR, sr).astype(np.float32)
        return dsp.trim(x, SR, -45, 0.01)


def strain(x):
    """A grunt from the gut: tight, pushed, breathy."""
    x = dsp.eq(x, SR, "peak", 1500, 5, 0.9)
    x = dsp.drive(dsp.peak_normalize(x, 0.9), 2.4)
    return x + dsp.whisper(x, SR) * 0.6


def grunt(voice, g, text, semis=0.0, speed=1.1, level=-18):
    x = voice.say(g, text, speed)
    x = dsp.pitch(x, SR, semis)
    x = strain(x)
    return dsp.normalize(dsp.reverb(dsp.fade(x, SR, 0.005, 0.06), SR, rt60=0.3, wet=0.08), SR, level)


def fall_scream(voice, g):
    """Over the edge: a scream torn away by the drop and the wind."""
    x = voice.say(g, "Aaaaaaaaaaahhh!", 0.75)
    x = dsp.pitch(x, SR, 2.0, 0.7)
    x = strain(x)
    tt = np.arange(len(x)) / SR
    dur = len(x) / SR
    # Falling away: it drops in pitch, loses its top and its level.
    x = dsp.pitch(x, SR, 0) * np.clip(1.1 - tt / dur, 0, 1) ** 1.4
    x = sweep_lowpass(x, 9000, 900, 1.5)
    wind = dsp.bandpass(noise(dur), SR, 300, 2500) * np.linspace(0.2, 0.6, len(x)) * 0.25
    return dsp.normalize(dsp.reverb(x + wind, SR, rt60=1.8, wet=0.3, damp=2500), SR, -16)


# --------------------------------------------------------------------------
# Things blowing up and falling down
# --------------------------------------------------------------------------

def blast(seconds=3.0, power=1.0, bright=1.0):
    """One explosion, dry: crack, roar, thump, and debris pattering after."""
    t = t_axis(seconds)
    x = np.zeros(len(t), dtype=np.float32)
    # The crack.
    crack = noise(0.012) * np.exp(-np.arange(int(SR * 0.012)) / (SR * 0.003))
    x[: len(crack)] += crack * 1.5 * bright
    # The roar: noise whose top closes down as the fireball cools.
    roar = dsp.brown(SR, seconds) * 3 + noise(seconds) * 0.4
    roar = sweep_lowpass(roar, 7000 * bright, 320, 2.5)
    env = np.minimum(1, t / 0.006) * np.exp(-t / (0.55 * power))
    x += roar * env * 1.2
    # The thump in your chest.
    f = 55 * np.exp(-t / 0.5) + 26
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.45 * power))
    x += thump.astype(np.float32) * 0.55
    # Debris coming back down.
    for _ in range(int(40 * power)):
        at = R.uniform(0.25, seconds * 0.85)
        d = R.uniform(0.01, 0.05)
        hit = noise(d) * np.exp(-np.arange(int(SR * d)) / (SR * d * 0.25))
        hit = dsp.bandpass(hit, SR, R.uniform(300, 900), R.uniform(1500, 5000))
        dsp.mix_into(x, hit * R.uniform(0.05, 0.25) * np.exp(-at / seconds * 2), int(at * SR))
    x = dsp.highpass(x, SR, 32)
    x = dsp.eq(x, SR, "peak", 450, 3.5, 0.8)
    return dsp.drive(dsp.peak_normalize(x, 0.9), 1.6)


def explosion(variant):
    x = blast(3.2, 1.0 + 0.2 * variant, 1.0)
    x = outdoor(x, 0.2)
    return dsp.normalize(x, SR, -14)


def demolition_charges():
    """The charges: a ripple of cracks up the tower, the booms rolling back off the city."""
    out = dsp.silence(SR, 4.0)
    at = 0.0
    for i in range(9):
        b = blast(1.6, 0.5, R.uniform(0.6, 0.9)) * R.uniform(0.5, 0.9)
        dsp.mix_into(out, b, int(at * SR))
        at += R.uniform(0.12, 0.32)
    x = dsp.lowpass(out, SR, 5000)
    x = outdoor(x, 0.8)
    return dsp.normalize(x, SR, -15)


def creak(seconds, base=90.0, rate=(18, 60), modes=(140, 385, 760, 1250, 2100)):
    """Steel under load: stick-slip pulses ringing the beam's modes."""
    n = int(SR * seconds)
    exc = np.zeros(n, dtype=np.float32)
    at = 0.0
    while at < seconds:
        k = at / seconds
        r = rate[0] + (rate[1] - rate[0]) * (0.5 + 0.5 * np.sin(k * 7 + R.uniform(0, 1)))
        i = int(at * SR)
        if i < n:
            exc[i] = R.uniform(0.4, 1.0)
        at += 1 / r * R.uniform(0.7, 1.3)
    bank = np.zeros(n, dtype=np.float32)
    for m in modes:
        bank += dsp.resonator(exc, SR, m * R.uniform(0.95, 1.05), 18) * R.uniform(0.5, 1.0)
    tone = np.sin(2 * np.pi * np.cumsum(base * (1 + 0.15 * np.sin(np.linspace(0, 3, n)))) / SR)
    bank += dsp.resonator(tone.astype(np.float32), SR, base * 3, 5) * 0.15
    env = np.minimum(1, np.arange(n) / (SR * 0.3)) * np.minimum(1, (n - np.arange(n)) / (SR * 0.5))
    return (bank * env).astype(np.float32)


def metal_groan(variant):
    x = creak(3.2 + variant, base=70 + 30 * variant)
    x = dsp.drive(dsp.peak_normalize(x, 0.9), 1.5)
    x = dsp.reverb(x, SR, rt60=2.2, wet=0.35, predelay=0.02, damp=2500, stereo_out=True)
    return dsp.normalize(x, SR, -18)


def snap():
    """A beam or a cable letting go: a crack and the steel ringing."""
    t = t_axis(1.4)
    x = noise(1.4) * np.exp(-t / 0.008) * 1.5
    for f, g in [(212, 0.6), (583, 0.4), (1147, 0.3), (1874, 0.2)]:
        x += np.sin(2 * np.pi * f * t * (1 - 0.04 * t)) * np.exp(-t / 0.35) * g
    return x.astype(np.float32)


def glass_tinkles(seconds, count, start=0.0):
    out = dsp.silence(SR, seconds)
    for _ in range(count):
        at = start + R.uniform(0, seconds - start - 0.1) * R.random() ** 0.6
        d = R.uniform(0.03, 0.12)
        tt = np.arange(int(SR * d)) / SR
        ping = sum(np.sin(2 * np.pi * R.uniform(2200, 7500) * tt) for _ in range(2)) * np.exp(-tt / (d * 0.3))
        dsp.mix_into(out, ping.astype(np.float32) * R.uniform(0.02, 0.12), int(at * SR))
    return out


def building_collapse():
    """A tower coming down, heard from the next building over."""
    secs = 11.0
    t = t_axis(secs)
    n = len(t)
    out = np.zeros((n, 2), dtype=np.float32)
    swell = np.clip(t / 1.6, 0, 1) ** 1.5 * np.clip((secs - t) / 4.0, 0, 1)
    # The ground taking it: a rumble that breathes.
    rumble = dsp.lowpass(dsp.brown(SR, secs) * 4, SR, 140, order=4)
    rumble *= swell * (1 + 0.35 * np.sin(2 * np.pi * 0.7 * t + 2 * np.sin(2 * np.pi * 0.23 * t)))
    out += dsp.stereo(rumble) * 0.5
    # Concrete crumbling: thousands of grains.
    grains = np.zeros((n, 2), dtype=np.float32)
    for _ in range(4200):
        at = R.uniform(0.3, secs - 2.0) * R.random() ** 0.35 + 0.4
        if at >= secs - 0.2:
            continue
        d = R.uniform(0.004, 0.045)
        g = noise(d) * np.exp(-np.arange(int(SR * d)) / (SR * d * 0.3))
        lo = R.uniform(200, 1200)
        g = dsp.bandpass(g, SR, lo, lo * R.uniform(2, 6))
        dsp.mix_into(grains, dsp.stereo(g, R.uniform(-0.9, 0.9)), int(at * SR), R.uniform(0.05, 0.26))
    out += grains * swell[:, None]
    # Big pieces landing.
    for _ in range(26):
        at = R.uniform(0.6, secs - 2.5)
        tt = t_axis(0.6)
        f = R.uniform(45, 110) * np.exp(-tt / 0.2) + 25
        hit = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.18) * 0.7 + dsp.bandpass(noise(0.6), SR, 250, 2500) * np.exp(-tt / 0.06)
        dsp.mix_into(out, dsp.stereo(hit.astype(np.float32), R.uniform(-0.6, 0.6)), int(at * SR), R.uniform(0.25, 0.6))
    # Steel: groans, and things snapping.
    for k in range(3):
        c = creak(R.uniform(2.0, 3.2), base=R.uniform(50, 110), rate=(10, 40))
        dsp.mix_into(out, dsp.stereo(c, R.uniform(-0.7, 0.7)), int(R.uniform(0.5, 5.5) * SR), 0.18)
    for _ in range(7):
        dsp.mix_into(out, dsp.stereo(snap(), R.uniform(-0.8, 0.8)), int(R.uniform(0.8, 7.0) * SR), R.uniform(0.08, 0.2))
    # Every window going.
    gl = glass_tinkles(secs, 260, 0.6)
    out += dsp.stereo(gl * swell, 0.2) * 0.8
    # The dust cloud rolling out.
    dust = dsp.bandpass(dsp.pink(SR, secs), SR, 250, 2500) * np.clip((t - 2.5) / 3, 0, 1) * np.clip((secs - t) / 3, 0, 1)
    out += dsp.stereo(dust * 0.6, -0.2)
    x = dsp.lowpass(dsp.highpass(out, SR, 32), SR, 7000)
    x = dsp.eq(dsp.eq(x, SR, "lowshelf", 90, -3), SR, "peak", 520, 3, 0.8)
    x = outdoor(x, 0.6)
    return dsp.normalize(x, SR, -15)


def distant_collapse(variant):
    """Somewhere above you, through the floor slabs: muffled, felt more than heard."""
    secs = 4.5
    t = t_axis(secs)
    x = dsp.lowpass(dsp.brown(SR, secs) * 4, SR, 220, 4) * np.minimum(1, t / 0.05) * np.exp(-t / 1.2)
    tt = t_axis(1.8)
    f = 48 * np.exp(-tt / 0.6) + 24
    x[: len(tt)] += np.sin(2 * np.pi * np.cumsum(f) / SR).astype(np.float32) * np.exp(-tt / 0.7) * 0.8
    for _ in range(14):
        at = R.uniform(0.1, 2.5)
        hit = dsp.lowpass(noise(0.2), SR, 700) * np.exp(-np.arange(int(SR * 0.2)) / (SR * 0.05))
        dsp.mix_into(x, hit * R.uniform(0.1, 0.3), int(at * SR))
    c = creak(2.4, base=55 + 15 * variant, rate=(8, 25))
    dsp.mix_into(x, dsp.lowpass(c, SR, 1500) * 0.35, int(0.7 * SR))
    x = dsp.eq(dsp.highpass(x, SR, 30), SR, "peak", 300, 4, 0.9)
    x = dsp.reverb(x, SR, rt60=1.8, wet=0.35, predelay=0.03, damp=1500, stereo_out=True)
    return dsp.normalize(x, SR, -17)


def debris():
    """Chunks of ceiling coming down and settling."""
    secs = 2.6
    out = dsp.silence(SR, secs, 2)
    for i in range(34):
        at = R.uniform(0, 1.6) ** 1.3
        d = R.uniform(0.02, 0.12)
        tt = np.arange(int(SR * d)) / SR
        hit = dsp.bandpass(noise(d), SR, R.uniform(150, 600), R.uniform(1500, 6000)) * np.exp(-tt / (d * 0.3))
        thud = np.sin(2 * np.pi * R.uniform(70, 160) * tt) * np.exp(-tt / (d * 0.5))
        dsp.mix_into(out, dsp.stereo((hit + thud * 0.7).astype(np.float32), R.uniform(-0.6, 0.6)), int(at * SR), R.uniform(0.2, 0.8) * (1 - i / 50))
    dust = dsp.bandpass(dsp.pink(SR, secs), SR, 400, 3000) * np.exp(-t_axis(secs) / 0.8)
    out += dsp.stereo(dust * 0.3)
    return dsp.normalize(dsp.reverb(out, SR, rt60=1.0, wet=0.2, stereo_out=True), SR, -16)


# --------------------------------------------------------------------------
# Water and glass
# --------------------------------------------------------------------------

def sprinkler_burst():
    """The bulb pops, the line hisses, and the water comes."""
    secs = 2.4
    t = t_axis(secs)
    pop = glass_tinkles(0.4, 10) * 2 + noise(0.4) * np.exp(-t_axis(0.4) / 0.006) * 0.8
    hiss = dsp.highpass(noise(secs), SR, 2500) * np.clip(t / 0.05, 0, 1) * np.exp(-t / 0.5) * 0.4
    spray = dsp.bandpass(noise(secs), SR, 600, 9000) * np.clip((t - 0.15) / 0.5, 0, 1) * 0.35
    drops = np.zeros(len(t), dtype=np.float32)
    for _ in range(500):
        at = R.uniform(0.3, secs - 0.05)
        d = R.uniform(0.004, 0.012)
        tt = np.arange(int(SR * d)) / SR
        f = R.uniform(900, 3500) * (1 + tt / d)
        b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / (d * 0.4))
        dsp.mix_into(drops, b.astype(np.float32) * R.uniform(0.02, 0.08), int(at * SR))
    x = dsp.pad_to(pop, len(t)) + hiss + spray + drops
    x = dsp.fade(x, SR, 0.0, 0.5)
    return dsp.normalize(dsp.reverb(x, SR, rt60=0.9, wet=0.2, stereo_out=True), SR, -18)


def glass_cascade():
    """Everything glass breaking at once, from the team's recordings."""
    a, sa = dsp.read(os.path.join(SFX_IN, "eaglaxle-glass-shattering-461637.mp3"))
    b, sb = dsp.read(os.path.join(SFX_IN, "universfield-glass-bottle-breaking-351297.mp3"))
    srcs = [signal.resample_poly(dsp.mono(a), SR, sa).astype(np.float32), signal.resample_poly(dsp.mono(b), SR, sb).astype(np.float32)]
    out = dsp.silence(SR, 4.5, 2)
    for i in range(9):
        s = srcs[i % 2]
        rate = R.uniform(0.75, 1.3)
        y = signal.resample(s, int(len(s) / rate)).astype(np.float32)
        y = dsp.trim(y, SR, -40, 0.0)[: int(SR * 2.5)]
        y = dsp.fade(y, SR, 0.0, 0.3)
        dsp.mix_into(out, dsp.stereo(y, R.uniform(-0.8, 0.8)), int(R.uniform(0, 1.1) * SR), R.uniform(0.4, 0.9))
    out += dsp.stereo(glass_tinkles(4.5, 120, 0.3) * 0.7, 0.1)
    return dsp.normalize(dsp.reverb(out, SR, rt60=1.1, wet=0.2, stereo_out=True), SR, -15)


# --------------------------------------------------------------------------
# Cutscene cues
# --------------------------------------------------------------------------

def monitor_beep():
    out = dsp.silence(SR, 2.2)
    for k in range(2):
        tt = t_axis(0.14)
        b = np.sin(2 * np.pi * 988 * tt) * np.minimum(1, tt / 0.005) * np.minimum(1, (0.14 - tt) / 0.02)
        dsp.mix_into(out, b.astype(np.float32) * 0.3, int((0.05 + k * 1.1) * SR))
    return dsp.normalize(dsp.reverb(out, SR, rt60=0.5, wet=0.15), SR, -22)


def pistol():
    t = t_axis(1.6)
    crack = noise(0.03) * np.exp(-t_axis(0.03) / 0.004) * 2
    body = dsp.lowpass(noise(0.4), SR, 2500) * np.exp(-t_axis(0.4) / 0.05)
    f = 120 * np.exp(-t / 0.05) + 50
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12)
    x = boom.astype(np.float32) * 0.8
    dsp.mix_into(x, crack, 0)
    dsp.mix_into(x, body, 0, 0.8)
    x = dsp.drive(dsp.peak_normalize(x, 0.9), 2.2)
    x = dsp.reverb(x, SR, rt60=1.3, wet=0.4, predelay=0.008, damp=3000, stereo_out=True)
    return dsp.normalize(x, SR, -14)


def clank(f0=310, decay=0.25, brightness=1.0):
    tt = t_axis(decay * 3)
    x = noise(0.01) * 0.5
    x = dsp.pad_to(x, len(tt))
    for m, g in [(1, 1), (2.76, 0.7), (5.4, 0.45), (8.93, 0.25 * brightness)]:
        x += np.sin(2 * np.pi * f0 * m * R.uniform(0.98, 1.02) * tt) * np.exp(-tt / (decay / m ** 0.3)) * g * 0.3
    return x.astype(np.float32)


def clatter():
    """The launcher hitting the floor and skidding across it."""
    out = dsp.silence(SR, 1.8, 2)
    at, gap = 0.0, 0.18
    for i in range(7):
        dsp.mix_into(out, dsp.stereo(clank(R.uniform(220, 420), 0.18) * (1 - i * 0.11), -0.3 + i * 0.1), int(at * SR))
        at += gap
        gap *= 0.72
    scrape = dsp.bandpass(noise(0.7), SR, 1200, 6000) * np.exp(-t_axis(0.7) / 0.3) * 0.25
    dsp.mix_into(out, dsp.stereo(scrape, 0.2), int(at * SR))
    return dsp.normalize(dsp.reverb(out, SR, rt60=0.4, wet=0.2, stereo_out=True), SR, -17)


def brake():
    """The brakes biting on the rails: a screech, then the catch."""
    secs = 1.6
    t = t_axis(secs)
    f = 2400 + 300 * np.sin(2 * np.pi * 7 * t) + np.cumsum(R.normal(0, 30, len(t))) / 50
    sq = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * np.cumsum(f * 1.51) / SR)
    sq = sq * np.minimum(1, t / 0.05) * np.clip((1.15 - t) / 0.2, 0, 1) * 0.2
    grind = dsp.bandpass(noise(secs), SR, 800, 5000) * np.clip((1.15 - t) / 0.3, 0, 1) * 0.15
    x = (sq + grind).astype(np.float32)
    catch = clank(140, 0.45, 0.6) * 1.2
    tt = t_axis(0.5)
    thump = np.sin(2 * np.pi * (60 * np.exp(-tt / 0.1) + 35) * tt) * np.exp(-tt / 0.12)
    dsp.mix_into(x, dsp.pad_to(catch, len(tt)) + thump.astype(np.float32), int(1.1 * SR))
    return dsp.normalize(dsp.reverb(x, SR, rt60=0.6, wet=0.2, stereo_out=True), SR, -16)


def cable_snap():
    """The last cable: a crack, the twang of steel whipping, the drop beginning."""
    secs = 2.4
    t = t_axis(secs)
    x = snap()
    x = dsp.pad_to(x, len(t))
    f = 95 * np.exp(-t / 0.6) + 40
    twang = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.5) * 0.6
    whoosh = dsp.bandpass(noise(secs), SR, 300, 3000) * np.clip((t - 0.2) / 1.2, 0, 1) * 0.3
    x = x + twang.astype(np.float32) + whoosh
    return dsp.normalize(dsp.reverb(x, SR, rt60=1.5, wet=0.3, stereo_out=True), SR, -15)


def lift_chime():
    out = dsp.silence(SR, 1.6)
    tt = t_axis(1.2)
    ding = (np.sin(2 * np.pi * 1318.5 * tt) + 0.3 * np.sin(2 * np.pi * 2637 * tt)) * np.exp(-tt * 3.5)
    dsp.mix_into(out, ding.astype(np.float32) * 0.3, 0)
    return dsp.normalize(dsp.reverb(out, SR, rt60=0.6, wet=0.15), SR, -20)


def lift_doors():
    secs = 1.6
    t = t_axis(secs)
    motor = np.sin(2 * np.pi * (110 + 20 * np.minimum(1, t)) * t) * 0.2 + dsp.bandpass(noise(secs), SR, 200, 1200) * 0.4
    env = np.minimum(1, t / 0.15) * np.clip((1.3 - t) / 0.2, 0, 1)
    x = (motor * env).astype(np.float32)
    dsp.mix_into(x, clank(180, 0.15, 0.4) * 0.6, int(1.25 * SR))
    return dsp.normalize(dsp.reverb(x, SR, rt60=0.4, wet=0.15, stereo_out=True), SR, -20)


def clank_hit():
    """A clamp biting home: steel on steel, a thud behind it."""
    tt = t_axis(0.8)
    x = dsp.pad_to(clank(260, 0.3, 0.8), len(tt))
    x += (np.sin(2 * np.pi * (80 * np.exp(-tt / 0.05) + 50) * tt) * np.exp(-tt / 0.1)).astype(np.float32) * 0.6
    return dsp.normalize(dsp.reverb(x, SR, rt60=0.5, wet=0.2, stereo_out=True), SR, -16)


def spark():
    """An electrical fault arcing: crackle gated in bursts over a mains buzz."""
    secs = 1.2
    t = t_axis(secs)
    gate = (signal.lfilter([1], [1, -0.995], (R.random(len(t)) < 0.004).astype(np.float32)) > 0.3).astype(np.float32)
    crackle = dsp.highpass(noise(secs), SR, 2500) * gate * 0.6
    buzz = (signal.square(2 * np.pi * 100 * t, 0.1) * 0.15 * gate).astype(np.float32)
    x = dsp.fade(crackle + dsp.bandpass(buzz, SR, 200, 4000), SR, 0.005, 0.2)
    return dsp.normalize(dsp.reverb(x, SR, rt60=0.4, wet=0.15), SR, -19)


def body_hit():
    tt = t_axis(0.7)
    thud = np.sin(2 * np.pi * (90 * np.exp(-tt / 0.08) + 45) * tt) * np.exp(-tt / 0.12)
    slap = dsp.bandpass(noise(0.7), SR, 300, 3000) * np.exp(-tt / 0.03)
    x = (thud * 0.9 + slap * 0.6).astype(np.float32)
    return dsp.normalize(dsp.reverb(x, SR, rt60=0.5, wet=0.15), SR, -15)


# --------------------------------------------------------------------------

def main():
    global R
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="Kokoro model dir (the player's grunts and screams)")
    ap.add_argument("--only", default=None)
    args = ap.parse_args()
    dsp.seed(99)
    R = dsp.RNG
    os.makedirs(OUT, exist_ok=True)
    jobs = {
        "fire-alarm": fire_alarm,
        "demolition-charges": demolition_charges,
        "building-collapse": building_collapse,
        "explosion-1": lambda: explosion(0),
        "explosion-2": lambda: explosion(1),
        "distant-collapse-1": lambda: distant_collapse(0),
        "distant-collapse-2": lambda: distant_collapse(1),
        "metal-groan-1": lambda: metal_groan(0),
        "metal-groan-2": lambda: metal_groan(1),
        "debris": debris,
        "sprinkler-burst": sprinkler_burst,
        "glass-cascade": glass_cascade,
        "monitor-beep": monitor_beep,
        "pistol": pistol,
        "clatter": clatter,
        "brake": brake,
        "cable-snap": cable_snap,
        "lift-chime": lift_chime,
        "lift-doors": lift_doors,
        "body-hit": body_hit,
        "clank": clank_hit,
        "spark": spark,
    }
    for g in ("f", "m"):
        jobs[f"breath-run-{g}"] = (lambda g=g: run_loop(g))
        jobs[f"breath-pant-{g}"] = (lambda g=g: panting(g))
        jobs[f"breath-scared-{g}"] = (lambda g=g: scared(g))
        jobs[f"breath-recover-{g}"] = (lambda g=g: recover(g))
    for name, job in jobs.items():
        if args.only and args.only not in name:
            continue
        save(name, job(), "96k" if name.startswith("breath") else "128k")
    if args.model:
        voice = PlayerVoice(args.model)
        for g in ("f", "m"):
            for name, job in {
                f"grunt-{g}": lambda: grunt(voice, g, "Hnngh!", -1.0, 1.0),
                f"hurt-1-{g}": lambda: grunt(voice, g, "Ugh!", 0.0, 1.2, -17),
                f"hurt-2-{g}": lambda: grunt(voice, g, "Agh!", 0.5, 1.2, -17),
                f"hurt-3-{g}": lambda: grunt(voice, g, "Nngh!", -0.5, 1.1, -17),
                f"scream-{g}": lambda: fall_scream(voice, g),
            }.items():
                if args.only and args.only not in name:
                    continue
                save(name, job(), "96k")


if __name__ == "__main__":
    main()
