"""
Shared signal processing for the audio generators (voices.py, creatures.py,
sfx.py, music.py). numpy/scipy for the DSP, ffmpeg for rubberband pitch
shifting and the final encode.

Signals are float32 numpy arrays in -1..1: mono is shape (n,), stereo (n, 2).
"""

import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf
from scipy import signal

RNG = np.random.default_rng(7)


def seed(value):
    """Re-seed the shared generator (each generator script seeds once, so a re-run is identical)."""
    global RNG
    RNG = np.random.default_rng(value)


# --------------------------------------------------------------------------
# Basics
# --------------------------------------------------------------------------

def db(value):
    return 10 ** (value / 20)


def silence(sr, seconds, channels=1):
    n = int(round(sr * seconds))
    return np.zeros((n, channels) if channels > 1 else n, dtype=np.float32)


def mono(x):
    return x.mean(axis=1) if x.ndim == 2 else x


def stereo(x, pan=0.0):
    """Mono to stereo with an equal-power pan (-1 left .. 1 right)."""
    if x.ndim == 2:
        return x
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def pad_to(x, n):
    if len(x) >= n:
        return x[:n]
    shape = (n - len(x),) + x.shape[1:]
    return np.concatenate([x, np.zeros(shape, dtype=x.dtype)])


def mix_into(dest, src, at_sample, gain=1.0):
    """Add src into dest starting at a sample index (clipped to dest)."""
    if at_sample >= len(dest):
        return dest
    if at_sample < 0:
        src = src[-at_sample:]
        at_sample = 0
    end = min(len(dest), at_sample + len(src))
    if src.ndim == 1 and dest.ndim == 2:
        src = stereo(src)
    dest[at_sample:end] += src[: end - at_sample] * gain
    return dest


def concat(parts, sr, gaps=None):
    out = []
    for i, p in enumerate(parts):
        out.append(p)
        if gaps and i < len(gaps):
            out.append(silence(sr, gaps[i], 1 if p.ndim == 1 else p.shape[1]))
    return np.concatenate(out).astype(np.float32)


def fade(x, sr, fade_in=0.0, fade_out=0.0):
    x = x.copy()
    n_in, n_out = int(sr * fade_in), int(sr * fade_out)
    if n_in:
        ramp = np.sin(np.linspace(0, np.pi / 2, n_in)) ** 2
        x[:n_in] *= ramp if x.ndim == 1 else ramp[:, None]
    if n_out:
        ramp = np.cos(np.linspace(0, np.pi / 2, n_out)) ** 2
        x[-n_out:] *= ramp if x.ndim == 1 else ramp[:, None]
    return x


def trim(x, sr, threshold_db=-48, pad=0.03):
    """Cut leading and trailing quiet (relative to the peak)."""
    m = np.abs(mono(x))
    if not m.any():
        return x
    env = np.convolve(m, np.ones(int(sr * 0.01)) / int(sr * 0.01), mode="same")
    above = np.nonzero(env > m.max() * db(threshold_db))[0]
    if not len(above):
        return x
    a = max(0, above[0] - int(sr * pad))
    b = min(len(x), above[-1] + int(sr * pad))
    return x[a:b]


def envelope(x, sr, seconds=0.01):
    n = max(1, int(sr * seconds))
    return np.sqrt(np.convolve(mono(x) ** 2, np.ones(n) / n, mode="same"))


def k_weight(x, sr):
    """Roughly the ear's weighting (ITU-R BS.1770 'K'): no infrasound, a lift above 1.5 kHz."""
    y = signal.sosfilt(signal.butter(2, 60, "highpass", fs=sr, output="sos"), mono(x))
    return _sos(y.astype(np.float32), _biquad("highshelf", sr, 1500, 4.0))


def active_rms(x, sr, floor_db=-35):
    """Loudness (K-weighted RMS) over the frames that are actually sounding."""
    w = k_weight(x, sr)
    env = envelope(w, sr, 0.03)
    if not env.any():
        return 0.0
    active = env > env.max() * db(floor_db)
    return float(np.sqrt(np.mean(w[active] ** 2))) if active.any() else 0.0


def normalize(x, sr, rms_db=-18, peak=0.89):
    """Set the sounding level, then keep peaks under the ceiling (soft)."""
    level = active_rms(x, sr)
    if level > 0:
        x = x * (db(rms_db) / level)
    return soft_limit(x, peak)


def peak_normalize(x, peak=0.9):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def soft_limit(x, ceiling=0.95):
    """Linear below 70 % of the ceiling, a tanh knee above it."""
    knee = ceiling * 0.7
    y = x.copy()
    over = np.abs(y) > knee
    y[over] = np.sign(y[over]) * (knee + (ceiling - knee) * np.tanh((np.abs(y[over]) - knee) / (ceiling - knee)))
    return y.astype(np.float32)


def drive(x, amount=2.0):
    """Saturation: tanh, level-matched at small signals."""
    return (np.tanh(x * amount) / np.tanh(amount)).astype(np.float32)


def bitcrush(x, bits=8, mix=0.3):
    q = 2 ** (bits - 1)
    return (x * (1 - mix) + np.round(x * q) / q * mix).astype(np.float32)


# --------------------------------------------------------------------------
# Filters
# --------------------------------------------------------------------------

def _sos(x, sos):
    return signal.sosfilt(sos, x, axis=0).astype(np.float32)


def highpass(x, sr, hz, order=2):
    return _sos(x, signal.butter(order, hz, "highpass", fs=sr, output="sos"))


def lowpass(x, sr, hz, order=2):
    return _sos(x, signal.butter(order, min(hz, sr * 0.45), "lowpass", fs=sr, output="sos"))


def bandpass(x, sr, lo, hi, order=2):
    return _sos(x, signal.butter(order, [lo, min(hi, sr * 0.45)], "bandpass", fs=sr, output="sos"))


def _biquad(kind, sr, hz, gain_db=0.0, q=0.707):
    """RBJ cookbook biquads as one SOS row."""
    a = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * hz / sr
    cos, sin = np.cos(w0), np.sin(w0)
    alpha = sin / (2 * q)
    if kind == "peak":
        b = [1 + alpha * a, -2 * cos, 1 - alpha * a]
        aa = [1 + alpha / a, -2 * cos, 1 - alpha / a]
    elif kind == "lowshelf":
        s = 2 * np.sqrt(a) * alpha
        b = [a * ((a + 1) - (a - 1) * cos + s), 2 * a * ((a - 1) - (a + 1) * cos), a * ((a + 1) - (a - 1) * cos - s)]
        aa = [(a + 1) + (a - 1) * cos + s, -2 * ((a - 1) + (a + 1) * cos), (a + 1) + (a - 1) * cos - s]
    elif kind == "highshelf":
        s = 2 * np.sqrt(a) * alpha
        b = [a * ((a + 1) + (a - 1) * cos + s), -2 * a * ((a - 1) + (a + 1) * cos), a * ((a + 1) + (a - 1) * cos - s)]
        aa = [(a + 1) - (a - 1) * cos + s, 2 * ((a - 1) - (a + 1) * cos), (a + 1) - (a - 1) * cos - s]
    elif kind == "bandpass":
        b = [alpha, 0, -alpha]
        aa = [1 + alpha, -2 * cos, 1 - alpha]
    else:
        raise ValueError(kind)
    b, aa = np.array(b) / aa[0], np.array(aa) / aa[0]
    return np.array([[*b, *aa]])


def eq(x, sr, kind, hz, gain_db=0.0, q=0.707):
    return _sos(x, _biquad(kind, sr, hz, gain_db, q))


def resonator(x, sr, hz, q):
    """A narrow resonance (a formant, a pipe, a bell partial)."""
    return _sos(x, _biquad("bandpass", sr, hz, 0, q))


def formants(x, sr, bands):
    """Parallel resonators: [(hz, q, gain), ...]."""
    out = np.zeros_like(x)
    for hz, q, g in bands:
        out += resonator(x, sr, hz, q) * g
    return out


# --------------------------------------------------------------------------
# Time and pitch (ffmpeg's rubberband)
# --------------------------------------------------------------------------

def _ffmpeg_af(x, sr, af):
    with tempfile.TemporaryDirectory() as tmp:
        a, b = os.path.join(tmp, "a.wav"), os.path.join(tmp, "b.wav")
        sf.write(a, x, sr, subtype="FLOAT")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a, "-af", af, "-ar", str(sr), b], check=True)
        y, _ = sf.read(b, dtype="float32")
    return y


def pitch(x, sr, semitones=0.0, tempo=1.0, formant="preserved"):
    """Shift pitch (and/or tempo) with rubberband; formants kept or shifted with it."""
    if abs(semitones) < 1e-3 and abs(tempo - 1) < 1e-3:
        return x
    ratio = 2 ** (semitones / 12)
    return _ffmpeg_af(x, sr, f"rubberband=pitch={ratio:.6f}:tempo={tempo:.6f}:formant={formant}:pitchq=quality:window=standard")


def body(x, sr, semitones):
    """Move the formants (the size of the throat) as well as the pitch, keeping the duration."""
    if abs(semitones) < 1e-3:
        return x
    ratio = 2 ** (semitones / 12)
    return _ffmpeg_af(x, sr, f"asetrate={sr * ratio:.3f},aresample={sr},atempo={1 / ratio:.6f}")


def vibrato(x, sr, hz=6.0, depth=0.05):
    return _ffmpeg_af(x, sr, f"vibrato=f={hz}:d={depth}")


def tremolo(x, sr, hz=8.0, depth=0.2, jitter=0.0):
    t = np.arange(len(x)) / sr
    phase = 2 * np.pi * hz * t
    if jitter:
        phase += np.cumsum(RNG.normal(0, jitter, len(x))) / sr * 2 * np.pi
    m = 1 - depth * 0.5 * (1 + np.sin(phase))
    return (x * (m if x.ndim == 1 else m[:, None])).astype(np.float32)


# --------------------------------------------------------------------------
# Space
# --------------------------------------------------------------------------

def impulse(sr, rt60=1.2, predelay=0.01, damp=5000, early=6, width=1.0, channels=1, density=1.0):
    """
    A synthetic room: a few early reflections, then a noise tail in three
    bands whose highs die faster (damp ~ where the air and walls eat it).
    """
    n = int(sr * (predelay + rt60 * 1.1))
    t = np.arange(n) / sr
    irs = []
    for ch in range(channels):
        ir = np.zeros(n, dtype=np.float32)
        start = int(predelay * sr)
        tail = RNG.standard_normal(n).astype(np.float32)
        if density < 1:
            tail *= RNG.random(n) < density
        decay = np.exp(-6.9 * np.maximum(0, t - predelay) / rt60)
        low = lowpass(tail, sr, 600) * decay
        mid = bandpass(tail, sr, 600, 3000) * decay ** 1.25
        high = highpass(tail, sr, 3000) * decay ** (1.0 + 4000 / max(damp, 500))
        body_ = (low * 0.9 + mid + high * 0.7)
        body_[:start] = 0
        ir += body_ * 0.12
        for i in range(early):
            d = start + int(RNG.uniform(0.002, 0.035) * sr * (0.6 + 0.8 * width))
            if d < n:
                ir[d] += RNG.uniform(0.3, 0.8) * (1 if RNG.random() < 0.5 else -1) * (0.85 ** i)
        irs.append(ir / (np.sqrt(np.sum(ir ** 2)) + 1e-9))
    return irs[0] if channels == 1 else np.stack(irs, axis=1)


def reverb(x, sr, rt60=1.2, wet=0.25, predelay=0.012, damp=5000, early=6, stereo_out=False, width=1.0):
    """Convolution reverb with an impulse() room. Returns dry + wet (same length + tail)."""
    channels = 2 if stereo_out else 1
    ir = impulse(sr, rt60, predelay, damp, early, width, channels)
    src = mono(x)
    if stereo_out:
        wet_sig = np.stack([signal.fftconvolve(src, ir[:, c]) for c in range(2)], axis=1)
        dry = stereo(src)
    else:
        wet_sig = signal.fftconvolve(src, ir)
        dry = src
    dry = pad_to(dry, len(wet_sig))
    return (dry * (1 - wet * 0.5) + wet_sig * wet).astype(np.float32)


def echo(x, sr, delay=0.3, feedback=0.35, taps=5, damp=3500, pan_spread=0.0):
    """A tape echo: repeats that darken as they go."""
    n = len(x) + int(sr * delay * taps)
    out = np.zeros((n, 2), dtype=np.float32) if pan_spread else np.zeros(n, dtype=np.float32)
    src = mono(x)
    out = mix_into(out, stereo(src) if pan_spread else src, 0)
    rep = src
    for i in range(1, taps + 1):
        rep = lowpass(rep, sr, damp) * feedback
        if pan_spread:
            mix_into(out, stereo(rep, pan_spread * (1 if i % 2 else -1)), int(sr * delay * i))
        else:
            mix_into(out, rep, int(sr * delay * i))
    return out


def reverse_swell(x, sr, seconds=0.9, rt60=1.6):
    """Reverse reverb: the voice's own tail, played backwards, rising into it (a horror staple)."""
    head = x[: int(sr * 0.5)]
    tail = signal.fftconvolve(mono(head), impulse(sr, rt60, 0.0, 4000))[: int(sr * seconds)]
    tail = fade(tail[::-1].astype(np.float32), sr, 0.2, 0.0)
    tail = peak_normalize(tail, np.max(np.abs(x)) * 0.5)
    return np.concatenate([tail, x]).astype(np.float32)


# --------------------------------------------------------------------------
# Voice tricks
# --------------------------------------------------------------------------

def whisper(x, sr, smooth_hz=180):
    """
    Turn a voice into a whisper of itself: keep the spectral envelope, throw
    away the pitch (random phase, magnitudes smoothed across the harmonics).
    """
    nper = 512 if sr <= 24000 else 1024
    f, t, z = signal.stft(x, sr, nperseg=nper, noverlap=nper * 3 // 4)
    mag = np.abs(z)
    bins = max(1, int(smooth_hz / (f[1] - f[0])))
    kernel = np.ones(bins) / bins
    mag = np.apply_along_axis(lambda col: np.convolve(col, kernel, mode="same"), 0, mag)
    phase = np.exp(1j * RNG.uniform(0, 2 * np.pi, mag.shape))
    _, y = signal.istft(mag * phase, sr, nperseg=nper, noverlap=nper * 3 // 4)
    y = highpass(pad_to(y.astype(np.float32), len(x)), sr, 350)
    return y


def compress(x, sr, threshold_db=-20, ratio=4, attack=0.005, release=0.12, makeup_db=0.0):
    env = np.abs(mono(x))
    a = np.exp(-1 / (sr * attack))
    r = np.exp(-1 / (sr * release))
    level = signal.lfilter([1 - r], [1, -r], env)  # fast approximation
    level = np.maximum(level, signal.lfilter([1 - a], [1, -a], env))
    level_db = 20 * np.log10(level + 1e-9)
    over = np.maximum(0, level_db - threshold_db)
    gain = db(-over * (1 - 1 / ratio) + makeup_db)
    return (x * (gain if x.ndim == 1 else gain[:, None])).astype(np.float32)


# --------------------------------------------------------------------------
# Noise and breath
# --------------------------------------------------------------------------

def white(sr, seconds):
    return RNG.standard_normal(int(sr * seconds)).astype(np.float32)


def _coloured(sr, seconds, power, floor_hz=25.0):
    """Noise with a 1/f^power spectrum from floor_hz up (nothing below: no infrasonic drift)."""
    n = int(sr * seconds)
    spec = np.fft.rfft(RNG.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / sr)
    spec *= np.where(f < floor_hz, 0.0, (floor_hz / np.maximum(f, floor_hz)) ** power)
    y = np.fft.irfft(spec, n).astype(np.float32)
    return y / (np.std(y) + 1e-9) * 0.3


def pink(sr, seconds):
    return _coloured(sr, seconds, 0.5)


def brown(sr, seconds):
    return _coloured(sr, seconds, 1.0)


def breath(sr, seconds, inhale=True, effort=0.5, voice_hz=0.0, voiced=0.0, throat=1.0):
    """
    One breath. Noise through a vocal tract: an inhale is higher and
    narrower (air pulled past the teeth and soft palate); an exhale is the
    open "hhh" of a schwa. `voiced` adds a little vocal fold buzz at
    `voice_hz` (the "huh" of an effortful pant). `throat` scales the
    formants (0.85 = bigger, 1.15 = smaller).
    """
    n = int(sr * seconds)
    t = np.arange(n) / sr
    noise = RNG.standard_normal(n).astype(np.float32)
    # Air flow wavers.
    flutter = 1 + 0.25 * signal.lfilter([0.002], [1, -0.998], RNG.standard_normal(n)) * 40
    if inhale:
        tract = [(1700 * throat, 4, 0.8), (2900 * throat, 5, 0.6), (4300 * throat, 6, 0.45), (900 * throat, 3, 0.35)]
        shape = np.minimum(1, t / (seconds * 0.55)) ** 1.5 * np.minimum(1, (seconds - t) / 0.06)
    else:
        tract = [(600 * throat, 3, 0.9), (1450 * throat, 4, 0.7), (2500 * throat, 5, 0.45), (3500 * throat, 6, 0.25)]
        shape = np.minimum(1, t / 0.04) * np.exp(-t / (seconds * (0.45 + 0.25 * effort)))
    air = formants(noise, sr, tract) + highpass(noise, sr, 3500) * (0.08 + 0.1 * effort)
    out = air * shape * flutter
    if voiced > 0 and voice_hz > 0:
        f0 = voice_hz * (1 + 0.03 * np.sin(2 * np.pi * 5 * t)) * (1 - 0.15 * t / seconds)
        ph = np.cumsum(2 * np.pi * f0 / sr)
        glottal = signal.sawtooth(ph, 0.1).astype(np.float32)
        glottal = lowpass(glottal, sr, 1800)
        vowel = formants(glottal, sr, [(560 * throat, 6, 1.0), (1400 * throat, 8, 0.5), (2400 * throat, 10, 0.25)])
        vshape = np.minimum(1, t / 0.03) * np.exp(-t / (seconds * 0.3))
        out = out + vowel * vshape * voiced * 2.5
    out = highpass(out, sr, 160)
    return (out / (np.max(np.abs(out)) + 1e-9) * (0.35 + 0.6 * effort)).astype(np.float32)


# --------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------

def read(path):
    x, sr = sf.read(path, dtype="float32")
    return x, sr


def write_wav(path, x, sr):
    sf.write(path, x, sr, subtype="FLOAT")


def encode(x, sr, path, bitrate="64k", out_rate=None):
    """Encode to mp3 (or ogg by extension) with ffmpeg."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    x = np.clip(x, -1, 1)
    with tempfile.TemporaryDirectory() as tmp:
        a = os.path.join(tmp, "a.wav")
        sf.write(a, x, sr, subtype="PCM_16")
        args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a]
        if out_rate:
            args += ["-ar", str(out_rate)]
        if path.endswith(".ogg"):
            args += ["-c:a", "libvorbis", "-b:a", bitrate]
        else:
            args += ["-c:a", "libmp3lame", "-b:a", bitrate]
        subprocess.run(args + ["-map_metadata", "-1", path], check=True)
    return path
