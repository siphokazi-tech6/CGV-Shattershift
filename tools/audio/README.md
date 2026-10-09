# Audio tools - the game's voices, creatures, effects and music

Everything under `assets/audio/voice`, `assets/audio/creatures`,
`assets/audio/sfx` and `assets/audio/music` is made by the scripts in this
folder, offline, from nothing but code and an open text-to-speech model. Run
them again after changing a line of dialogue (or a sound) and commit what
they write. The game never runs them: it only plays the files.

| Script | Writes | What it is |
| --- | --- | --- |
| `export-lines.mjs` | (stdout, JSON) | Every line the game speaks: the story script, the Skyline's intercom, the lift's radio |
| `voices.py` | `assets/audio/voice/*.mp3`, `src/audio/voice-lines.js` | The voice acting, one file per line, and the list the game reads |
| `creatures.py` | `assets/audio/creatures/*.mp3` | The patients: growls, moans, broken speech, shrieks, pain, death, the brute's roar, a horde |
| `sfx.py` | `assets/audio/sfx/*.mp3` | Fire alarm, the player's breathing and voice, demolition, the building collapsing, explosions, water, glass, the cutscenes' cues |
| `music.py` | `assets/audio/music/*.mp3` | Each stage's score, as seamless loops |
| `dsp.py` | - | The shared signal processing (filters, reverb, pitch, whisper, breath, loudness) |
| `intelligibility.py` | (report) | A machine listener's check that the words survive each character's processing |

## Setting up (once)

```text
python -m venv .venv
.venv/bin/pip install kokoro-onnx soundfile scipy numpy
```

ffmpeg must be on the PATH, built with `libmp3lame` and `rubberband`
(Ubuntu's `ffmpeg` package has both). Download the Kokoro-82M model
(Apache-2.0) into a folder, say `.vendor/kokoro`:

- https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
- https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

(`.vendor/` is ignored by git.)

## Making everything

```text
node tools/audio/export-lines.mjs > lines.json
.venv/bin/python tools/audio/voices.py --model .vendor/kokoro --lines lines.json
.venv/bin/python tools/audio/creatures.py --model .vendor/kokoro
.venv/bin/python tools/audio/sfx.py --model .vendor/kokoro
.venv/bin/python tools/audio/music.py
```

Voices take about ten minutes, the rest a few minutes each. Every script
seeds its randomness, so the same code makes the same files.

## Changing a line of dialogue

1. Edit the words in `src/story/script.js` (or the Skyline's intercom in
   `src/levels/causeway/layout.js`, or the lift's radio in
   `src/elevators/quiet-ride.js`).
2. Export the lines and re-record just that speaker:
   `voices.py --model ... --lines lines.json --only "^okoro\|"` (`--only` is a
   regular expression on `who|text`).
3. Commit the new mp3 and `src/audio/voice-lines.js`.

Until a changed line is re-recorded the game shows it with the old voice
blip instead (a line is found by its exact words).

## The cast

| Who | Kokoro voice | The performance (`voices.py`) |
| --- | --- | --- |
| Dr. Okoro | `am_michael` | An ordinary man, terrified: pitch pushed up, a shaking voice (vibrato and tremor), breathy, gasping between sentences; whispering behind the desk, shouting in the lift and when he draws them off |
| Dr. Vale | `bm_george` + `bm_lewis` | Slow and deep: the throat and pitch dropped ~4.5 semitones, a sub-octave growl and a whispered double under the voice; the intercom's echo through the tower; laughter after his taunts and a long mad laugh in the helicopter |
| HALCYON | `bf_emma` | The building: calm, a little metallic, over the PA after a two-note chime |
| The pilot | Vale's voice, undisguised | Over a headset, and as "Kestrel One" on the radio in the lift (it is Vale: the reveal is heard as well as seen) |
| Subject 07 | `af_heart` / `am_echo` | By the character picked: exhausted, breathy |
| The patients | `am_onyx`, `bm_lewis`, `am_adam`, `bf_isabella`, `af_nicole`, `am_fenrir` | Bigger throats, lower pitch, a rattle (vocal fry), grit, a whisper of breath, and a wet gurgle as they die |

## Loudness

Everything is mastered to a loudness (a K-weighted measurement, as EBU R128)
rather than a peak, so files sit together: dialogue around -18 LUFS,
one-shots -15 to -21, the beds quieter, the scores -16 to -19. The game's
gains (`LEVEL1_SFX_VOLUME` in `src/audio/level1-audio.js`, `STAGE_MUSIC` in
`src/audio/music-manager.js`) then place them: the music sits about 4 dB
under the voices and steps back a further 6 dB while anyone speaks. Check a
file with:

```text
ffmpeg -i assets/audio/sfx/fire-alarm.mp3 -af ebur128 -f null -
```

## Intelligibility

Scary must not cost the words. `intelligibility.py` (PocketSphinx, `pip
install pocketsphinx`) reports how many of each line's words a speech
recogniser still finds in the finished file. It hears far worse than a
person - deep voices worst of all - so compare speakers and versions rather
than reading the numbers as absolute. Measured on the current files: Okoro
loses almost nothing to his processing (75% raw, 73% final); Vale's first
version, with a long PA echo and a strong throat shift, fell from 78% to 21%,
so the depth now comes mostly from pitch (formants kept) and the intercom is
one short slap and a short room (38%, most of what is left being how deep he
is); HALCYON's PA was thinned the same way.
