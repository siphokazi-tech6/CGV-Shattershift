"""
The patients (Vale's "fixed" people): growls, moans, shrieks, pain, death,
and what is left of their speech - generated offline.

    python tools/audio/creatures.py --model DIR

Each sound starts as a human voice (Kokoro, as voices.py) and is made into
something else: a bigger throat and a lower pitch, a rattle in it (vocal
fry: the voice chopped at 25-45 Hz), driven into grit, a whisper of breath
under it, and for the dying a wet gurgle (bubbles: damped sines that rise).
Several speakers, male and female, so a crowd is not one voice.

Writes assets/audio/creatures/patient-<kind>-<n>.mp3.
"""

import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import dsp  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "audio", "creatures")
SR = 24000

SPEAKERS = [("am_onyx", "en-us"), ("bm_lewis", "en-gb"), ("am_adam", "en-us"), ("bf_isabella", "en-gb"), ("af_nicole", "en-us"), ("am_fenrir", "en-us")]


class Source:
    def __init__(self, model_dir):
        from kokoro_onnx import Kokoro
        self.k = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))

    def say(self, text, speaker, speed=1.0):
        name, lang = SPEAKERS[speaker % len(SPEAKERS)]
        samples, sr = self.k.create(text, voice=self.k.get_voice_style(name), speed=speed, lang=lang)
        x = samples.astype(np.float32)
        if sr != SR:
            from scipy.signal import resample_poly
            x = resample_poly(x, SR, sr).astype(np.float32)
        return dsp.trim(x, SR, -45, 0.02)


def rattle(x, hz=32.0, depth=0.6):
    """Vocal fry: the voice chopped into pulses, unevenly - a rattling throat."""
    t = np.arange(len(x)) / SR
    wander = np.cumsum(dsp.RNG.normal(0, 4.0, len(x))) / SR
    ph = 2 * np.pi * (hz * t + wander * hz * 0.3)
    pulses = 0.5 * (1 + np.sign(np.sin(ph)) * np.abs(np.sin(ph)) ** 0.4)
    return (x * (1 - depth + depth * pulses)).astype(np.float32)


def ring(x, hz=38.0, mix=0.3):
    t = np.arange(len(x)) / SR
    return (x * (1 - mix) + x * np.sin(2 * np.pi * hz * t) * mix).astype(np.float32)


def stutter(x, count=2):
    """A glitch: a grain of the word caught and repeated - a mind skipping."""
    out = x.copy()
    for _ in range(count):
        g = int(SR * dsp.RNG.uniform(0.05, 0.09))
        at = int(dsp.RNG.uniform(0.15, 0.6) * max(1, len(out) - g))
        grain = dsp.fade(out[at:at + g], SR, 0.004, 0.004)
        reps = int(dsp.RNG.integers(2, 4))
        out = np.concatenate([out[:at + g]] + [grain] * reps + [out[at + g:]])
    return out


def gurgle(seconds, density=28, low=180, high=650):
    """Wet bubbles in the throat: short damped sines sweeping up."""
    out = dsp.silence(SR, seconds + 0.2)
    for _ in range(int(density * seconds)):
        at = dsp.RNG.uniform(0, seconds)
        f0 = dsp.RNG.uniform(low, high)
        d = dsp.RNG.uniform(0.012, 0.04)
        t = np.arange(int(SR * d)) / SR
        f = f0 * (1 + t / d * dsp.RNG.uniform(0.4, 1.2))
        b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (d * 0.35))
        dsp.mix_into(out, b.astype(np.float32) * dsp.RNG.uniform(0.2, 1.0), int(at * SR))
    return dsp.lowpass(out, SR, 2200)


def monster(x, semis=-7.0, throat=-3.0, fry=32, fry_depth=0.55, grit=4.0, tempo=1.0, breath=0.3, ring_mix=0.0):
    x = dsp.body(x, SR, throat)
    x = dsp.pitch(x, SR, semis, tempo)
    x = rattle(x, fry * dsp.RNG.uniform(0.85, 1.2), fry_depth)
    if ring_mix:
        x = ring(x, dsp.RNG.uniform(30, 48), ring_mix)
    x = dsp.drive(dsp.peak_normalize(x, 0.9), grit)
    x = x + dsp.whisper(x, SR) * breath * 2
    x = dsp.eq(x, SR, "peak", 380, 4, 1.2)    # the chest
    x = dsp.eq(x, SR, "peak", 2800, -3, 1.0)  # less "voice", more throat
    return x


def finish(x, wet=0.16, rt=0.7, level=-16):
    x = dsp.fade(x, SR, 0.02, 0.12)
    x = dsp.reverb(x, SR, rt60=rt, wet=wet, predelay=0.006, damp=3500)
    return dsp.normalize(x, SR, level)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    args = ap.parse_args()
    dsp.seed(2026)
    src = Source(args.model)
    made = []

    def save(kind, n, x):
        path = os.path.join(OUT, f"patient-{kind}-{n}.mp3")
        dsp.encode(x, SR, path)
        made.append((os.path.basename(path), len(x) / SR))

    # Growls: the snarl as one goes for you.
    growls = [("Grrraaahhh!", 0), ("Rrrhhaaagh!", 1), ("Hhhuuurrgh!", 2), ("Gaaahhrr!", 5), ("Rraaagh!", 1), ("Hhaarrgh!", 0)]
    for i, (text, spk) in enumerate(growls, 1):
        x = src.say(text, spk, 0.9)
        x = monster(x, semis=dsp.RNG.uniform(-9, -6), throat=dsp.RNG.uniform(-4, -2.5), fry=dsp.RNG.uniform(26, 38), grit=5, tempo=0.72)
        save("growl", i, finish(x, level=-17))

    # Moans: shuffling, somewhere near, lost.
    moans = [("Uuuuhhhhh...", 0), ("Ooohhhh...", 3), ("Hhhnnnnnn...", 2), ("Aaaaahhhh...", 4), ("Uuuurrrhh...", 1), ("Mmmmhhhaaa...", 3)]
    for i, (text, spk) in enumerate(moans, 1):
        x = src.say(text, spk, 0.8)
        x = monster(x, semis=dsp.RNG.uniform(-5, -3), throat=-2, fry=dsp.RNG.uniform(22, 30), fry_depth=0.4, grit=2.5, tempo=0.5, breath=0.45)
        x = dsp.vibrato(x, SR, dsp.RNG.uniform(3, 5), 0.08)
        save("moan", i, finish(x, wet=0.22, rt=1.0, level=-21))

    # What is left of them: the words. Begging, mostly.
    words = [
        ("Help... me...", 0), ("It hurts...", 3), ("Doctor...", 1), ("Why...", 4),
        ("Make it stop...", 2), ("So cold...", 3), ("Kill me...", 0), ("Where am I...", 4),
    ]
    for i, (text, spk) in enumerate(words, 1):
        x = src.say(text, spk, 0.78)
        x = stutter(x, 1 + (i % 2))
        female = SPEAKERS[spk][0][1] == "f"
        x = monster(x, semis=-4.5 if female else -3.5, throat=-2.5 if female else -1.5, fry=24, fry_depth=0.35, grit=2.2, tempo=0.68, breath=0.6, ring_mix=0.22)
        save("speech", i, finish(x, wet=0.24, rt=1.1, level=-19))

    # Shrieks: the lunge - an infected scream, raw and torn.
    shrieks = [("Aaaaahhh!", 3), ("Raaaaahh!", 5), ("Kyaaahhh!", 4), ("Haaaaagh!", 2)]
    for i, (text, spk) in enumerate(shrieks, 1):
        x = src.say(text, spk, 1.0)
        x = monster(x, semis=dsp.RNG.uniform(-1.5, 1.0), throat=-1.0, fry=45, fry_depth=0.35, grit=7, tempo=0.8, breath=0.5)
        x = dsp.highpass(x, SR, 240)
        sub = monster(src.say(text, spk, 1.0), semis=-10, throat=-3, grit=4, tempo=0.8, breath=0.0)
        x = dsp.pad_to(x, max(len(x), len(sub))) + dsp.pad_to(sub, max(len(x), len(sub))) * 0.45
        save("shriek", i, finish(x, level=-16))

    # Pain: a ball into one.
    pains = [("Uagh!", 0), ("Nngh!", 2), ("Gahh!", 1), ("Hurgh!", 5), ("Aagh!", 3)]
    for i, (text, spk) in enumerate(pains, 1):
        x = src.say(text, spk, 1.1)
        x = monster(x, semis=dsp.RNG.uniform(-6, -4), throat=-2, fry=34, grit=4.5, tempo=0.9, breath=0.3)
        save("pain", i, finish(x, wet=0.12, rt=0.5, level=-18))

    # Death: the moan running out, and the gurgle.
    deaths = [("Uuuhhhhhh...", 0), ("Aaaahhhh...", 3), ("Hhhuuuhh...", 1), ("Ooohhh...", 2)]
    for i, (text, spk) in enumerate(deaths, 1):
        x = src.say(text, spk, 0.85)
        x = monster(x, semis=-6, throat=-2.5, fry=22, fry_depth=0.6, grit=3, tempo=0.62, breath=0.5)
        t = np.arange(len(x)) / SR
        x = x * np.clip(1.15 - t / (len(x) / SR), 0, 1)  # the life going out of it
        x = dsp.pitch(x, SR, 0, 1.0)
        g = gurgle(len(x) / SR * 0.8)
        x = dsp.pad_to(x, len(g)) + g * 0.35
        save("death", i, finish(x, wet=0.14, rt=0.7, level=-19))

    # The brute's roar: the biggest throat on the roof.
    for i, (text, spk) in enumerate([("Rrraaaaaawwrrgh!", 1), ("Hhhwwoooaaarrgh!", 0)], 1):
        x = src.say(text, spk, 0.85)
        x = monster(x, semis=-11, throat=-4.5, fry=24, fry_depth=0.6, grit=6, tempo=0.6, breath=0.35)
        save("roar", i, finish(x, wet=0.25, rt=1.4, level=-15))

    # A horde: a dozen of them at once (the breach, the sacrifice, a wave).
    for n in (1, 2):
        bed = dsp.silence(SR, 4.5, 2)
        for j in range(12):
            text, spk = (moans + growls)[int(dsp.RNG.integers(0, len(moans) + len(growls)))]
            x = src.say(text, spk + j, dsp.RNG.uniform(0.75, 1.0))
            x = monster(x, semis=dsp.RNG.uniform(-8, -4), throat=-2.5, fry=dsp.RNG.uniform(22, 40), grit=4, tempo=dsp.RNG.uniform(0.55, 0.8), breath=0.4)
            x = dsp.lowpass(x, SR, dsp.RNG.uniform(2500, 6000))  # some further off than others
            dsp.mix_into(bed, dsp.stereo(dsp.fade(x, SR, 0.05, 0.2), dsp.RNG.uniform(-0.85, 0.85)), int(dsp.RNG.uniform(0, 2.2) * SR), dsp.RNG.uniform(0.35, 1.0))
        bed = dsp.fade(bed, SR, 0.15, 0.8)
        bed = dsp.reverb(bed, SR, rt60=1.3, wet=0.25, predelay=0.01, damp=3200, stereo_out=True)
        bed = dsp.normalize(bed, SR, -18)
        path = os.path.join(OUT, f"patient-horde-{n}.mp3")
        dsp.encode(bed, SR, path, bitrate="96k")
        made.append((os.path.basename(path), len(bed) / SR))

    for name, seconds in made:
        print(f"{name:28s} {seconds:5.2f}s")


if __name__ == "__main__":
    main()
