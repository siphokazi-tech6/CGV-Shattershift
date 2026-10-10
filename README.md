# CGV Shattershift - Fracture Run

This repository contains the working concept and playable Three.js prototype for our Computer Graphics and Visualisation group project.

**Working game title:** Fracture Run  
**Repository name:** CGV Shattershift  
**Primary inspiration:** Smash Hit  
**Secondary inspiration:** Temple Run 2

The player automatically travels through a failing glass tower, throws limited energy spheres, avoids obstacles, and uses elevator transitions to reach three distinct sectors:

The story climbs the building, riding a lift up between each stage:

1. **Sector 01 - The Shifting Foundry** (the basement) - third-person chase camera and moving machinery. *Playable.*
2. **Sector 02 - The Meltdown** (the labs) - out of a lift into labs being torched to destroy the evidence, a failed ball launcher as your only tool, a stretch where the power dies, and a glass lift up. *Playable.*
3. **Sector 03 - The Skyline** (the Glass Causeway module) - out of the glass lift, first-person aiming and resource management across the skybridge, until the tower behind you is demolished and the bridge tips into a ramp: sprint, jump, grab the ledge. *Playable.*
4. **The Roof** - the finale: hold out against the scientists and their test subjects until the helicopter comes; then the ride out, the pilot's reveal, and the credits. *Playable.*

Before it all, **the briefing** (from the menu) is a short silent film of how it came to this.

**Endless** (from the menu, separate from the story) runs any one of the four until you go down: the Foundry and the Labs come back as new, faster layouts every lap, the Skyline is randomised chunks, and the Roof is wave after wave with no helicopter. Best results are kept per environment.

## Story

Ascension Tower, level 212. A resonance experiment failed at dawn and its subject did not die. You are **Subject 07**: glass shatters at your touch, and you can throw that resonance as spheres of energy. Dr. Adrian Vale has armed the tower's demolition charges to bury what he made. Climb out with Dr. Elias Okoro, the anaesthetist who leaked it all: the basement foundry, the burning labs, the glass causeway across the skyline, and the helicopter on the roof, before the tower comes down. The story is told in cutscenes with reaction prompts (`src/story/`).

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim - the crosshair follows the mouse; aim assist (Settings) helps with small targets |
| Left mouse | Throw a sphere |
| Right mouse (hold) | Focus - slow time to aim |
| `A` / `D` or left / right | Change lane |
| `W` / `S` or up / down | Sprint / brake (the Skyline); jump / slide (the Foundry, the Labs) |
| `Q` / `E` or mouse wheel | Sphere type: glass, cryo, shock (picked in the main menu's loadout and the pause menu too) |
| `Space` / `Shift` | Jump / slide |
| `C` | First-person / chase camera |
| `M` | Minimap |
| `V` / VIEW button | Choose which HUD panels show |
| `H` | Hide the whole HUD |
| `P` | Photo mode (filters, save photo, save 360° panorama) |
| `Esc` | Pause and settings |
| `R` | Run again from the end screen |
| `1` `2` `3` `4` | Demo: jump to Sector 01 (Foundry), 02 (Labs), 03 (Skyline), the Roof - with that stage's story and cutscenes |
| `5` | Demo: ride the Gravity Fault lift (Sector 01 to 02); left mouse fires at the brake clamps |
| `6` | Demo: the quiet ride from the Labs up to the Skyline |
| The Labs and the Roof | Hold left mouse to fire; jump onto fallen ducts (running into one hurts); on the roof `WASD` moves (the open ledges are a long drop) and `Space` dodges or jumps for the ladder; `B` bloom, `K` credits. Photo mode is not available there |
| Cutscenes | Hold `Esc` to skip the talking; reaction prompts show the keys to press |

A run that uses a demo key (`1`-`6`) still plays on, but it no longer counts for the records: the fastest story run (from Sector 01 to the helicopter, in h:mm:ss) and each Endless level's best (distance and the time it took).

## Spheres and power-ups (every level)

One set of rules and one look everywhere - the Skyline's (`src/systems/arsenal.js`, `src/systems/spheres.js`):

- **Spheres:** glass (1), cryo (2) and shock (3) spheres are the same glowing orbs in every level, on the same arcs. They ricochet cleanly off a corridor's walls and ceiling, bounce off hazards and the floor, and a glass sphere punches through a pane it breaks. Ammunition comes from the floating cyan **sphere caches**.
- **Serums (power-ups):** prism split (gold), thermal sight (orange), kinetic shield (green) and overdrive (pink) - each its own colour, never a sphere type's. The pickup is the Skyline's glass capsule with the serum alive inside it; shoot it or run into it.
- **What you see:** a banner across the top names the serum, says what it does and how long it lasts, then shrinks into a countdown chip; the screen's edges glow in its colour, and each has its own look - a prism fringe, a heat grade with scan lines, a honeycomb shield rim (that ripples when it takes a hit), overdrive's speed lines and wider view. The last three seconds blink (`src/ui/serum-fx.js`).

## Sector 03 - The Skyline (the Glass Causeway module)

A research wing 212 floors up, burning at 03:47 in the morning, in three beats: the **containment ward**, the **skybridge** (which collapses behind you), and the mirrored **resonance atrium**, ending with a three-lock gate and the Calibration Lift. It was built as the game's first level, before the story order was settled; in the story it is the last sector, and its lift goes up to the Roof.

- **Glass everywhere, and all of it real:** ray-traced glass with Fresnel reflection, dispersion and Beer-Lambert absorption; cracks form around the exact point you hit; panes fracture into GPU-simulated shards.
- **Fire, water, smoke:** ray-marched volumetric fire; shoot the glass bulb of a sprinkler to flood it; smoke veils the screen and burns your lungs until you break a smoke vent (the round covers with a glowing cyan ring on the walls).
- **Five case files:** gold holograms standing in columns of light - run through one or shoot it to piece together what happened.
- **From sedated to running for your life:** the run starts slow and blurred as Subject 07 staggers out of the pod, and builds to full pace as the adrenaline kicks in; explosions scare you into a sprint.
- **The building coming down:** telegraphed ceiling collapses, a distant tower falling, the skybridge collapsing behind you, the atrium detonating below the lift.
- **Tools:** three sphere types, four serum power-ups (prism split, thermal sight, kinetic shield, overdrive), sprint/brake, bullet-time focus.
- **Extras:** orthographic minimap, field manual, three missions per run, five collectible case files, photo mode with 360° export, and an endless mode of randomised chunks (Endless -> The Skyline).
- **The hardest sector:** it comes after the Labs, so it runs faster (11.4 m/s), hits, fire and smoke hurt more, the collapse behind you is quicker (9.6 m/s) and the sealed gate gives you seven seconds.
- **In the story** it is Sector 03: you arrive by the glass lift (no pod, no sedated start) and its lift goes up to the Roof.
- **Graphics pipeline:** custom multi-pass post-processing (screen-space refraction, bloom, FXAA, heat haze, thermal vision, power-up looks), dynamic ray-marched sky, reflection probe, sun shadows, wet reflective floors, and Auto quality with dynamic resolution for lab machines.

See [`docs/level-1-causeway.md`](./docs/level-1-causeway.md) and [`docs/shaders-explained.md`](./docs/shaders-explained.md).

## Menus and settings

The title screen offers the briefing film or goes straight to the menu. The main menu's buttons: **Start story** (the wake-up in the ward, then the Foundry), **Chapters** (start the story from the briefing, the Foundry, the Gravity Fault lift, the Labs, the Skyline or the Roof, cutscenes and all), **Endless**, **Field manual**, **Settings** and **Replay the briefing**.

Beside it, the **Loadout** card: who you play as (female or male), skin tone, and the sphere you start with - all remembered.

The **pause menu** has the same buttons (resume, settings, restart, quit) and a guide with three tabs: the **moves** for the sector you are in (highlighted) and everywhere, the **spheres** (change type mid-run), and the **power-ups**, each with a picture of its capsule, what it does and how long it lasts.

**Settings** (also the pause menu) has **Interface** (which HUD panels show - also the VIEW button), aim sensitivity, **graphics quality** (Auto, High, Medium, Low), and **Reduced motion & camera shake**. Choices persist locally.

## Sound

Every line is **voice acted**, every stage has **its own score**, and the tower sounds like it is burning and falling down. All of it is made by the scripts in `tools/audio/` (an open text-to-speech model and synthesis in code - see [`tools/audio/README.md`](./tools/audio/README.md)), so there is nothing to license and a changed line can be re-recorded in a minute.

- **Dr. Okoro** is a Nigerian doctor, terrified: he speaks Nigerian English, breathes hard in his pauses and pants as he runs through the Foundry explaining things to Seven, whispers behind the desk and shouts in the lift.
- **Dr. Vale** is deep, slow and wrong - a growl under his voice and a whisper beside it - over the tower's intercom (the Labs when the lights die, the Skyline, the roof as he lets them out), with laughter after his taunts and a mad laugh in the helicopter. The pilot on the radio is his own voice, undisguised.
- **HALCYON**, the building's automatic system, makes its announcements to all personnel after a chime - it is on nobody's side - and the same voice **narrates the briefing film**; the **patients** growl, shriek, moan and beg ("help me", "it hurts") from wherever they are, and gurgle as they go down.
- **Subject 07** speaks in the voice of the character picked (female or male), and cries out without words when hit.
- **The tower:** the fire alarm (it dies with the power in the Labs), your own huffing and puffing as you run (harder as you tire - the character you picked), pain when you're hit, demolition charges and the whole tower coming down on the Skyline, explosions, steel groaning, sprinklers bursting, glass everywhere.
- **Music:** the Foundry is industrial (a press, an anvil, the countdown ticking), the Labs are horror (drone, heartbeat, a music box), the Skyline is the escape, the Roof the last stand; the wake-up and the failing lift are suspense, the quiet ride after Okoro is grief. The briefing keeps its piano under the narration, and the ending the main theme. Inside the lifts their own music plays (except in the story's two scored rides). The music steps back whenever someone speaks.
- Stage directions in the subtitles are heard too: `[a pistol shot]`, `[breathing hard]`, `[laughs]`.

## Play locally

The game uses JavaScript modules, so serve the folder over HTTP rather than double-clicking `index.html`.

### Python

Open a terminal in this folder and run:

```text
python tools/serve.py
```

and open http://localhost:4173. It works like `python -m http.server 4173`, but it tells the browser not to cache anything - with the plain server, after an update the browser can mix new and old files (the menus lose their styling and buttons stop working) until you hard-refresh with Ctrl+Shift+R.

Then open `http://localhost:4173/` in Chrome.

If `python` is not recognised on Windows, try:

```text
py -m http.server 4173
```

Stop the server with `Ctrl+C`.

## Demo shortcuts

During a run, press `1`, `2`, `3`, `4` or `5` (see Controls). These shortcuts are included for project demonstrations and development testing.

## Project documents

- [`docs/project-brief.md`](./docs/project-brief.md) - editable concept, level plan, rubric mapping, architecture, risks, and Sprint 1 backlog.
- [`docs/project-guide.pdf`](./docs/project-guide.pdf) - formatted PDF version of the project guide.
- [`docs/level-1-causeway.md`](./docs/level-1-causeway.md) - Level 1 design sheet: story, map, mechanics, cameras, integration contract, performance budget.
- [`docs/shaders-explained.md`](./docs/shaders-explained.md) - every Level 1 shader explained stage by stage, with a demonstration script.
- [`docs/level-transition.md`](./docs/level-transition.md) - how the Calibration Lift hands over to Level 2 and what changed in `main.js`.
- [`docs/test-plan-level-1.md`](./docs/test-plan-level-1.md) - automated checks, bug log, manual test checklist.
- [`docs/level-2-foundry.md`](./docs/level-2-foundry.md) and [`docs/test-plan-level-2.md`](./docs/test-plan-level-2.md) - Level 2.
- [`docs/elevators.md`](./docs/elevators.md) - the elevators: the Gravity Fault lift (Level 2 to 3), how it plugs into `main.js`, and the plan for Level 3's lifts.
- [`docs/figure-wear-shader.md`](./docs/figure-wear-shader.md) - the player figure (lab subject: scrubs, wristband, IV port) and its wear shader - clean, dusty, bloodied, geared up - block by block.
- [`docs/credits.md`](./docs/credits.md) - credits and asset register.
- [`docs/pull-request-level-1.md`](./docs/pull-request-level-1.md) - pull request description and push steps for Level 1.

## Automated checks

```text
npm install --no-save playwright
npx playwright install chromium
node tests/causeway/run.js
node tests/foundry/run.js
node tests/elevators/run.js
```

## Team workflow

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before making changes. In short: create a small branch for each task, commit focused changes, and open a pull request for another teammate to review.

## Sharing and deployment

### Quickest method

1. Download the repository as a ZIP or clone it with Git.
2. Each teammate extracts the archive.
3. They open a terminal in the extracted folder and use the local-server command above.
4. They open `http://localhost:4173/` in Chrome.

### GitHub Pages

1. In GitHub, open **Settings > Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`, then save.
4. Share the Pages URL after GitHub finishes publishing.

### Department LAMP server

Deployment is a zip uploaded to the Moodle submission (no SSH); the server only serves files, from a subfolder, and is case-sensitive (Linux). There is no bundler, so the build is a clean copy of what the browser loads:

```text
python tools/build-deploy.py
```

This writes `dist/fracture-run/` (only `index.html`, `main.js`, `styles.css`, `src/`, `lib/`, `assets/` - no tests, docs or node_modules) and `dist/fracture-run.zip` with `index.html` at the top level, after checking for absolute paths (`/...`), spaces in filenames and filenames whose case does not match the code. Play the build before uploading, from a subfolder and case-sensitive like the real server:

```text
python tools/serve.py 4173 dist
```

then open `http://localhost:4173/fracture-run/` and play it through (check the console for 404s). Upload `dist/fracture-run.zip` following Moodle's naming convention, then open the published URL in Chrome and play it again.

Three.js r160 is kept in the repository (`lib/three/`) rather than loaded from a CDN, so the game runs offline and on networks that block jsDelivr (the lab machines do).

## Current status

The whole story is playable from start to finish: the briefing film, the wake-up and the Foundry with Dr. Okoro, the Gravity Fault lift (its brake clamps as reaction prompts), the Labs with the breach, the bend attack and Okoro's sacrifice, the quiet ride up, the Skyline's demolition and bridge jump, the Roof, and the ending in the helicopter with the credits - over the main theme. A death restarts the sector you were in. The character and skin tone picked on the start screen are the player in every level. Endless runs each environment on its own. Music is managed by `src/audio/music-manager.js` (a score per stage), the voices by `src/story/voice.js`, and the recorded and rendered effects - the patients, the alarm, your breath, the building coming down - by `src/audio/level1-audio.js`, in every level; the Foundry adds a synthesized machinery bed (`src/audio/foundry-ambience.js`), and the Labs their own synthesized effects. Everything goes through one limiter (`src/audio/output.js`). Each module has its own checks (`node tests/<story|meltdown|causeway|foundry|elevators>/run.js`). Frame rates still need to be measured on lab hardware (Chrome DevTools > Rendering > FPS meter).

## Technology

- Three.js and WebGL for rendering
- JavaScript for gameplay and state
- HTML/CSS for the interface
- Custom GLSL vertex and fragment shaders: ray-traced glass, ray-marched fire, clouds and SDF serums, GPU shard physics and particles, and a custom post-processing pipeline

No Unity or other game engine is used.

## Soundtracks and sound effects references

- [Pixabay game-over sound effects](https://pixabay.com/sound-effects/search/game%20over%20sound/)
- [Freesound glass-shatter search](https://freesound.org/search/?q=glass+shatters&page=3#sound)
- [OpenGameArt flame audio search](https://opengameart.org/art-search-advanced?keys=flame&title=&field_art_tags_tid_op=or&field_art_tags_tid=&name=&field_art_type_tid%5B%5D=13&sort_by=count&sort_order=DESC&items_per_page=24&Collection=)
