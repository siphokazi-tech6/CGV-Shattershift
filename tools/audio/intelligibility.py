"""
Can the words still be made out? A machine listener's check on the voices.

    pip install pocketsphinx
    node tools/audio/export-lines.mjs > lines.json
    python tools/audio/intelligibility.py --lines lines.json [--who vale]

Runs CMU PocketSphinx (its English model ships with the pip package) over
each finished voice file and reports the share of the script's words it
recognises, per speaker. It is a harsh, crude listener - it hears far worse
than a person, and very deep voices worst of all - so read the numbers
relatively: before and after a change to a character's processing. (It is
how Vale's intercom echo was found to smear his words and was cut back.)
"""

import argparse
import io
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from voices import OUT, read_manifest  # noqa: E402


def recognise(decoder, path):
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
    decoder.start_utt()
    decoder.process_raw(pcm, full_utt=True)
    decoder.end_utt()
    return decoder.hyp().hypstr if decoder.hyp() else ""


def words(text):
    return re.findall(r"[a-z']+", text.lower().replace("07", "zero seven"))


def recall(reference, heard):
    pool = words(heard)
    hits = 0
    for w in words(reference):
        if w in pool:
            hits += 1
            pool.remove(w)
    return hits / max(1, len(words(reference)))


def main():
    from pocketsphinx import Decoder
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--who", default=None)
    args = ap.parse_args()
    decoder = Decoder(samprate=16000, logfn=os.devnull)
    manifest = read_manifest()
    scores = {}
    for line in json.load(open(args.lines)):
        if args.who and line["who"] != args.who:
            continue
        entry = manifest.get(line["key"])
        if not entry:
            print(f"(no recording) {line['key']}")
            continue
        file = f"{entry[0]}-f" if len(entry) > 3 and entry[3] else entry[0]
        score = recall(line["text"], recognise(decoder, os.path.join(OUT, f"{file}.mp3")))
        scores.setdefault(line["who"], []).append(score)
        print(f"{line['who']:8s} {score:4.0%}  {line['text'][:70]}")
    for who, s in scores.items():
        print(f"== {who}: {np.mean(s):.0%} of the words recognised over {len(s)} lines")


if __name__ == "__main__":
    main()
