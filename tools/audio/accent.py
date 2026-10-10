"""
Nigerian English, as pronunciation: turns Kokoro's British-English phonemes
(espeak IPA) into a Nigerian English rendering, word by word, for Dr. Okoro.

There is no Nigerian English voice in Kokoro, so the accent is written into
what the voice is told to say. The features, from the descriptions of
Nigerian English (Jowitt, "Nigerian English Usage"; Gut, "Nigerian English:
phonology"):

  - full vowels, no reduction: the weak "uh" (schwa) takes the vowel its
    spelling suggests - "about" a-baut, "sister" sis-ta, "doctor" dok-ta
  - TH-stopping: "the" de, "think" tink
  - monophthongs for FACE and GOAT: "day" de, "go" go
  - vowel mergers: FLEECE/KIT i, GOOSE/FOOT u, TRAP/BATH a, STRUT o (open),
    NURSE e (open), LOT/THOUGHT o (open)
  - NEAR ia, CURE ua, SQUARE e
  - non-rhotic, with a tapped r where one is said
  - syllable-timed: no secondary stresses, every vowel given its weight

    phonemes = nigerian(tokenizer, "There's a helicopter coming for the roof.")
"""

import re

VOWEL_LETTERS = "aeiouy"
# espeak IPA vowels, longest first (diphthongs and long vowels before singles).
VOWELS = ["aɪə", "aʊə", "eɪ", "aɪ", "aʊ", "ɔɪ", "əʊ", "oʊ", "ɪə", "eə", "ʊə", "iː", "uː", "ɑː", "ɔː", "ɜː",
          "i", "ɪ", "ᵻ", "e", "ɛ", "æ", "a", "ɐ", "ɑ", "ɒ", "ɔ", "o", "ʌ", "ʊ", "u", "ə", "ɚ", "ɜ"]

# Full vowel for each vowel phoneme (the schwas are decided by spelling, below).
MAP = {
    "aɪə": "aia", "aʊə": "aua", "eɪ": "e", "aɪ": "aɪ", "aʊ": "aʊ", "ɔɪ": "ɔɪ", "əʊ": "o", "oʊ": "o",
    "ɪə": "ia", "eə": "ɛ", "ʊə": "ua", "iː": "i", "uː": "u", "ɑː": "a", "ɔː": "ɔ", "ɜː": "ɛ",
    "i": "i", "ɪ": "i", "ᵻ": "i", "e": "e", "ɛ": "ɛ", "æ": "a", "a": "a", "ɐ": "a", "ɑ": "a", "ɒ": "ɔ",
    "ɔ": "ɔ", "o": "o", "ʌ": "ɔ", "ʊ": "u", "u": "u", "ɜ": "ɛ",
}
SCHWAS = {"ə", "ɚ"}
LETTER_VOWEL = {"a": "a", "e": "ɛ", "i": "i", "o": "ɔ", "u": "u", "y": "i"}


def _units(ipa):
    """Split a word's IPA into vowel and non-vowel units."""
    out, i = [], 0
    while i < len(ipa):
        for v in VOWELS:
            if ipa.startswith(v, i):
                out.append(("V", v))
                i += len(v)
                break
        else:
            out.append(("C", ipa[i]))
            i += 1
    return out


def _letter_groups(word):
    """The word's vowel spellings in order (a silent final e dropped)."""
    w = word.lower()
    if len(w) > 2 and w.endswith("e") and w[-2] not in VOWEL_LETTERS and not w.endswith("le"):
        w = w[:-1]
    groups = re.findall(r"[aeiouy]+", w)
    # "-le" at the end ("people", "bottle") is a syllable: u.
    if word.lower().endswith("le") and len(word) > 3:
        groups = groups[:-1] + ["u"]
    return groups


def _schwa_for(word, group, is_last):
    w = word.lower()
    # Final -er/-or/-ar/-our: "a" (sista, dokta).
    if is_last and re.search(r"(er|or|ar|our)s?$", w):
        return "a"
    return LETTER_VOWEL.get(group[0], "a")


def word(tokenizer, text_word):
    """One word to Nigerian English phonemes."""
    core = re.sub(r"[^A-Za-z']", "", text_word)
    if not core:
        return ""
    ipa = tokenizer.phonemize(core, "en-gb").strip()
    ipa = ipa.replace("ˌ", "")  # no secondary stress: syllable-timed
    units = _units(ipa)
    groups = _letter_groups(core.replace("'", ""))
    vowel_units = [i for i, (k, _) in enumerate(units) if k == "V"]
    aligned = len(groups) == len(vowel_units)
    out = []
    for n, (kind, u) in enumerate(units):
        if kind == "C":
            u = {"θ": "t", "ð": "d", "ɹ": "ɾ", "ɾ": "ɾ"}.get(u, u)
            if u == "ː":
                continue
            out.append(u)
            continue
        if u in SCHWAS:
            if aligned:
                k = vowel_units.index(n)
                out.append(_schwa_for(core, groups[k], k == len(groups) - 1))
            else:
                out.append("a")
        else:
            out.append(MAP.get(u, u))
    s = "".join(out)
    # "ɾ" before a consonant or at the end is not said (non-rhotic).
    s = re.sub(r"ɾ(?!ˈ?[aeiouɛɔɪʊ])", "", s)
    return s


def nigerian(tokenizer, text):
    """A line to Nigerian English phonemes, punctuation kept for the phrasing."""
    out = []
    for token in re.findall(r"[A-Za-z']+|[.,!?;:—…]", text):
        if re.match(r"[A-Za-z']", token):
            w = word(tokenizer, token)
            if w:
                out.append(w)
        else:
            if out:
                out[-1] = out[-1] + token
    return " ".join(out)
