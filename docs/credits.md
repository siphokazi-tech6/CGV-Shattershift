# Credits and asset register

Documentation set item 6, per `CONTRIBUTING.md`: every external resource,
library, technique, and tool used in the project, with its source, licence,
modifications, and where it is used. Add to this file whenever anything
external enters the repository.

Levels 1 and 2 use no external assets - all geometry is Three.js primitives
and all textures are drawn at runtime. Level 3 is the exception: it uses
external models, converted and listed below (`assets/meltdown/`; conversion
steps in `tools/assets/README.md`).

> **Sources found by the team:** the four Level 3 downloads that carried no
> source (the ventilation kit, the launcher, the alarm light, the geothermal
> plant) are credited below from their pages. The Poly Haven rows
> should also be confirmed against the actual download pages.
>
> **Free3D's Personal Use License** (the ventilation kit, the launcher and
> the geothermal plant) allows free personal,
> non-commercial use, which covers a university project. It is not a
> Creative Commons licence: it generally does not allow passing the model
> files on, which a public repository does. Keep the repository private,
> or check the licence text on each model's page.
>
> **How the game is shared:** the repository is private, and the game is
> uploaded to the department's LAMP server where only the lecturer can open
> it (through the lecturer's own link) - no public access to the game or its
> files. The team is confirming with the PO and the lecturer that these
> licences are acceptable for the submission; if not, the four models under
> Free3D Personal Use and Sketchfab Standard get replaced with CC0 / CC BY
> ones.

---

## 1. Libraries

| Asset | Creator | Source | Licence | Modifications | Used in |
| --- | --- | --- | --- | --- | --- |
| Three.js r160 | Three.js authors | https://threejs.org - r160 copied from the `three@0.160.0` npm package into `lib/three/` (with its LICENSE) | MIT | None | Whole game, imported only through `src/three.js` (core) and `src/three-addons.js` (GLTFLoader, EffectComposer, UnrealBloomPass, OutputPass, ShaderPass, RoomEnvironment, BufferGeometryUtils, SkeletonUtils) |
| Playwright (dev only, not shipped) | Microsoft | https://playwright.dev | Apache 2.0 | None | `tests/` harnesses |

## 2. Level 3 models

Every external resource used by Level 3, per `CONTRIBUTING.md`: creator,
source, licence, modifications, and where it is used. Lives in
`assets/meltdown/`; conversion steps are in `tools/assets/README.md`.

| Asset (file) | Creator / source | Licence | Modifications | Used in |
| --- | --- | --- | --- | --- |
| Security camera (`security_camera.glb`) | Poly Haven - polyhaven.com/a/security_camera_01 (confirm) | CC0 | Converted .blend -> .glb, textures 4K -> 512 px, decimated to 4k tris | Wall cameras in corridors and halls |
| Utility box (`utility_box.glb`) | Poly Haven - polyhaven.com/a/utility_box_02 (confirm) | CC0 | .glb, 512 px, 4k tris | Corridor walls, boiler hall |
| Concrete road barrier (`concrete_barrier.glb`) | Poly Haven - polyhaven.com/a/concrete_road_barrier_02 (confirm) | CC0 | LOD2 only, .glb, 1024 px | Low barriers (jump obstacles) |
| Metal office desk (`office_desk.glb`) | Poly Haven - polyhaven.com/a/metal_office_desk (confirm) | CC0 | .glb, 1024 px, meshes merged at load | Lab benches, sliding-desk obstacle |
| Steel frame shelves (`steel_shelves.glb`) | Poly Haven - polyhaven.com/a/steel_frame_shelves_01 (confirm) | CC0 | .glb, 1024 px | Shelving, archive hall, toppling-shelf obstacle |
| Modular chain-link fence (`chainlink_fence.glb`) | Poly Haven - polyhaven.com/a/modular_chainlink_fence (confirm) | CC0 | Double panel only, .glb, 1024 px | Containment pens, boiler hall cages |
| Ceiling fan (`ceiling_fan.glb`) | Poly Haven - polyhaven.com/a/ceiling_fan (confirm) | CC0 | .glb, 512 px | Ward and archive hall ceilings |
| Industrial microscope (`microscope.glb`) | Poly Haven - polyhaven.com/a/industrial_microscope (confirm) | CC0 | .glb, 512 px | Lab benches, sliding desk |
| Ventilation system - straight duct, grille (`duct_straight.glb`, `vent_grille.glb`) and fan (`vent_fan.glb`) | "Ventilation System V 1.0" by **tinchoz77** (free3d.com/user/tinchoz77) - https://free3d.com/3d-model/ventilation-system-v10-61631.html (`4n9j8dkxxi0w-VentilationSystem.rar`) | **Free3D Personal Use License** | Individual kit pieces exported separately, .glb | Falling/bridge ducts, ceiling duct runs, boiler hall fans |
| Javelin launcher (`launcher.glb`) | "Javeline Rocket Launcher" by **bushra_khalid** (free3d.com/user/bushra_khalid) - https://free3d.com/3d-model/javeline-rocket-launcher-85065.html (`6ygizg34zqps-JavelineFinal.rar`) | **Free3D Personal Use License** - not CC; see the note above | FBX -> .glb, materials rewired to supplied textures, decimated | The player's ball launcher |
| Alarm light (`alarm_light.glb`) | "Alarm Light" by **5CNG5** - Sketchfab, https://skfb.ly/oE9CF (`alarm-light.zip`, `Bec-Alarma-Rosu-High-Poly.fbx`) | **CC BY 4.0** (creativecommons.org/licenses/by/4.0/) | FBX -> .glb, decimated to 3k tris | Rotating alarm beacons |
| Geothermal steam factory - pipes and ring (`industrial_pipes.glb`, `experiment_ring.glb`) | "Geothermal Steam Factory (Blender 2.8 Eevee)" by **3dhaupt** (free3d.com/user/3dhaupt) - https://free3d.com/3d-model/geothermal-steam-factory-blender-28-eevee-882230.html (`46-geothermal-steam-factory_blender.zip`) | **Free3D Personal Use License** | Two objects extracted from the scene; pipe emission disabled at load | Hall pipe walls; the experiment ring |

### Characters, weapons, and vehicles (Sketchfab, CC-BY-4.0)

Author, source and licence below were read from each file's embedded glTF
metadata. **CC-BY-4.0 requires attribution** (author, link, licence, and a note
of changes) wherever the work is shown - so these must also appear in the
game's credits screen, not only here. All were converted with
`tools/assets/convert.py` (textures cut to 1024 px; rigs preserved) and renamed as shown.

| File (renamed from) | Title / author / source | Modifications | Planned use |
| --- | --- | --- | --- |
| `player_female.glb` (scp_scientist_female_2) | "SCP Scientist Female 2" by Maxime66410 - sketchfab.com/3d-models/scp-scientist-female-2-276e685db9fc4dfe9c9e35b855d05731 | Textures 1024 px; at load: atlased, clothing recoloured to patient scrubs, animated by a vertex-shader rig | **Player (female, default)** |
| `player_male.glb` (scp_scientist_male_2) | "SCP Scientist Male 2" by Maxime66410 - sketchfab.com/3d-models/scp-scientist-male-2-c281bdc259ae46ba88e65ddb81e6a10a | Textures 1024 px; at load: as above | **Player (male)** |
| `scientist_radioman.glb` (scientist_radiomanskibidi_toilet) | "Scientist_radioman(skibidi_toilet)" by SwRasKyy - sketchfab.com/3d-models/scientist-radiomanskibidi-toilet-5aa19de185a0423c9f453b3fc7fb607b | Textures 1024 px, rig kept; at load: atlased into one mesh, procedurally animated | Phase B scientist (wave 1) |
| `scientist_rust.glb` (rust_scientist_blue) | "Rust Scientist (Blue)" by Homless_Models - sketchfab.com/3d-models/rust-scientist-blue-8040c84dc0194e47b9be7f73db6ffdcb | Textures 1024 px, rig kept; at load: atlased, procedurally animated | Phase B scientist (wave 2) |
| `patient.glb` (patient_-_silent_hill_4) | "Patient - Silent Hill 4" by many-bees - sketchfab.com/3d-models/patient-silent-hill-4-5064bde886544cb18bba4da196ee080c | Textures 1024 px, rig kept; at load: hand bones repaired (unit error), atlased into one mesh, procedurally animated | Specimen tanks and cells, lurching obstacles, watchers in the dark, roof rushers |
| `helicopter.glb` (hind_attack_helicopter) | "Hind Attack Helicopter" by Ashley Aslett - sketchfab.com/3d-models/hind-attack-helicopter-bb65bdfde2c54007a52dfbe1d91d930d | Textures 1024 px (from 44 MB); at load: weapons removed, airframe merged, rotors separated to spin, the red star markings painted out of the texture | The helicopter on the roof and in the ending |
| `weapon.glb` | "Weapon" by Panoramma32 - sketchfab.com/3d-models/weapon-d418f1404556408fb065d075ffd2c1c4 | Textures 1024 px (from 106 MB); meshes merged at load | Wave 2 scientist's gadget |
| `steampunk_weapon.glb` | "Steampunk weapon" by MakakaObami - sketchfab.com/3d-models/steampunk-weapon-696c79424c1d4b3a84112838d9091dd1 | Re-exported; meshes merged, brass material at load (it ships untextured) | Wave 1 scientist's gadget |
| `dead_end_weapons.glb` | "Dead end weapons" by Professor E12^2 - sketchfab.com/3d-models/dead-end-weapons-255e81ecd8f8407696c0ecc243823adc | Textures 1024 px, rigs kept | Enemy gadget candidate |
| `weapon_set.glb` | "Weapon set" by rudolfs - sketchfab.com/3d-models/weapon-set-cb2e607fc7734e6fbf84211b6a65912f | Re-exported | Enemy gadget candidate |
| `dragon_flail.glb` | "Dragon Flail" by Roeland Van Sichem De Combe - sketchfab.com/3d-models/dragon-flail-a1ddde08ead04e3aa271f0a9c8bc0088 | Re-exported | Melee enemy weapon candidate |
| `scientist_good.glb` (good_scientist) | "scientist" by Geont (Sketchfab user Fungler) - sketchfab.com/3d-models/scientist-ed65738d0ed44e0ba8493af2d1a5112b | Textures 1024 px, rig kept (82 bones) | Dr. Okoro, the ally scientist (`src/story/`) |
| `scientist_evil.glb` (evil_scientist) | "Scientist" by Scientist Broken (Sketchfab user ultra700cybercam) - sketchfab.com/3d-models/scientist-4d3ce8401dd74121b691c6a82a486f3c | Textures 1024 px, rig kept (81 bones); 428 facial morph targets and a 4-channel morph-weight clip ("MorphBake") stripped | Dr. Vale, the villain / pilot (`src/story/`) |

### Third batch: models for the story's later changes (Sketchfab)

Supplied by the team; author, source and licence read from each file's glTF
metadata. Converted with `tools/assets/convert_heavy.py`,
`extract_kit.py` and `heightmap.py` (see `tools/assets/README.md`). The rooftop
kit, the brute and the rooftop scan were tried for a bigger roof and then
dropped with it (the team went back to the original roof); they are not in
the repository.

| File | Title / author / source | Licence | Modifications | Used in |
| --- | --- | --- | --- | --- |
| `backpack.glb` | "Military Backpack" by Neslihan Çakmak - sketchfab.com/3d-models/military-backpack-06be5c0f15aa4aa3af8ebcc4c83d02a3 | CC BY 4.0 | Decimated, textures resized | Dr. Okoro's bag of spheres (the Foundry; worn by the player) |
| `duffel_bag.glb` | "Military Duffel bag" by Sousinho - sketchfab.com/3d-models/military-duffel-bag-d69478f0c5334e189e98f99e84bbe3e6 | CC BY 4.0 | Textures resized | Beside the sphere caches (the Labs, the Roof) |
| `police_helicopter.glb` | "Dolphin Helicopter (AS-365/Harbin Z-9)" by Martini-SF - sketchfab.com/3d-models/dolphin-helicopter-as-365harbin-z-9-d27aaf297dc94a3abb31571217179612 | **CC BY-NC 4.0** | Skin baked to static parts, police livery, rotor blades rebuilt in code, textures resized | Police helicopters (Skyline, roof, briefing) |
| `city_night.glb` | "city at night low poly skyscrapers" by dasy444 - sketchfab.com/3d-models/city-at-night-low-poly-skyscrapers-dc1294de66194054961c16aa74fda2cb | **Sketchfab Standard** | Textures resized; its sky dome hidden | The city (briefing) |
| `operating_room.glb` | "Charité University Hospital - Operating Room" by ChrisRE - sketchfab.com/3d-models/charite-university-hospital-operating-room-9ec46c4d615a4581a235eebfb162f574 | **CC BY-NC 4.0** | Decimated, textures resized | The operating theatre (briefing) |

> **Licences worth a team decision:** CC BY-NC 4.0 (the police helicopter,
> the operating room) allows a non-commercial university project but not a
> commercial release. The city's **Sketchfab Standard** licence permits use
> in a project but not redistributing the model file itself - which a public
> repository does. Keep the repo private, or swap the city out before
> publishing. Not used: the two explosion downloads (`.rar` archives of
> Cinema 4D `.c4d` scenes, which no web pipeline can read - the explosions
> are made in code) and `sci-fi_rooftops.glb`'s pipe walkways.

All licensed **CC-BY-4.0** (creativecommons.org/licenses/by/4.0/) unless the
third batch's table says otherwise. The ones
the game uses are credited in game (press `K` in the preview; the data is
`src/levels/meltdown/credits.js` - keep it in step with this table).
`dead_end_weapons.glb`, `weapon_set.glb` and `dragon_flail.glb` are not used
yet - when one is wired in, add its entry to `credits.js` so the in-game
credits stay in step.

> **Worth a team decision:** three of these are fan recreations of commercial
> games/franchises (Silent Hill 4, Rust,
> Skibidi Toilet). The uploader's CC-BY licence covers *their* model, not the
> original character designs. Usually fine for a non-commercial university
> project, but if the game is ever published, swap these for original or
> generic models.

### Photo textures (the Foundry, the Labs and the Roof)

Downloaded from Poly Haven (polyhaven.com) at 1K, colour + OpenGL normal +
roughness maps, into `assets/meltdown/textures/`. All **CC0** (public
domain; credited here as good practice). Applied at load by
`src/levels/meltdown/photo-textures.js`, tiled at each set's real-world size;
the drawn textures stay as the fallback.

| Set | Source | Used on |
| --- | --- | --- |
| Long White Tiles | polyhaven.com/a/long_white_tiles | The ward's and the labs' tiled walls |
| Metal Plate | polyhaven.com/a/metal_plate | Steel-panel walls (containment, substation); the Foundry's wall and ceiling plating |
| Painted Concrete | polyhaven.com/a/painted_concrete | Concrete walls (archive, boiler hall, stairwell) |
| Concrete Floor Painted | polyhaven.com/a/concrete_floor_painted | The Labs' floor |
| Tarred Gravel | polyhaven.com/a/tarred_gravel | The roof slab |

### Not external (Level 3)

- Fire and smoke: custom GLSL shaders (`src/levels/meltdown/fire.js`).
- Audio: the Labs' own cues are synthesized live with the Web Audio API (`src/audio/meltdown-audio.js`), and so is the Foundry's machinery bed (`src/audio/foundry-ambience.js`) - no sample files; the recorded sounds every level shares are listed below.
- The city round the roof (`city.js`), the story's furniture and set dressing (`src/story/stages/props.js`), the power-up looks (`src/ui/serum-fx.js`) and the menus' capsule pictures: built in code.
- Signage, hazard stripes, decals and the fallback wall/floor textures: generated on canvas at runtime (`src/levels/meltdown/textures.js`).
- Sky, smoke bank, launcher beam, grading pass: custom GLSL (`src/levels/meltdown/roof.js`, `smoke.js`, `flashlight.js`, `post.js`).

## 3. Models, textures, sounds (Levels 1 and 2)

All geometry is built from Three.js primitives, and all textures are drawn at runtime (`src/levels/causeway/textures.js`, `src/levels/foundry/textures.js`).

Background music supplied to the project:

- Story briefing: `leberch-piano-story-601906.mp3` — Leberch.
- Main menu: `852268__holizna__trap-melody-loop-5-ebmin-165-bpm.wav` — Holizna.
- Level 1: `GalacticTemple.ogg` — source and licence details must be added by the asset supplier before release.

Level 1 sound effects supplied to the project:

- Fire: `vanzetpictures-fire-457848.mp3` — VanzetPictures.
- Solid impact: `sumaga123-wood-hit-432148.mp3` — Sumaga123.
- Sprinkler water: `fire_sprinkler_water_flow_splash.wav` — source and licence details pending.
- Glass shatter: `eaglaxle-glass-shattering-461637.mp3` — Eaglaxle.
- Opening containment-pod glass: `universfield-glass-bottle-breaking-351297.mp3` — Universfield.
- Falling object: `dragon-studio-falling-tree-356127.mp3` — Dragon Studio.
- Game over: `universfield-marimba-game-over-250960.mp3` — Universfield.
- Broken-glass footstep: `368343__johandeecke__glass-hit-32.wav` — JohanDeecke.
- Elevator, and the wind on the roof: `wind1.wav` — source and licence details pending.
- Sphere throw: `floraphonic-swing-whoosh-9-198502.mp3` — Floraphonic.
- Sphere cache / serum collected: `floraphonic-arcade-ui-6-229503.mp3` — Floraphonic.
- Side-wall / ceiling ricochet: `freesound_community-wall-hit-1-100717.mp3` — Freesound Community.
- UI click: `justsomesounds-click-sound-432501.mp3` — JustSomeSounds.

Exact source URLs and licence terms for the supplied SFX must be recorded before release.

`GalacticTemple.ogg` no longer plays (each stage has its own score now, below); it is kept in the repository.

### Voices, creatures, effects and music made for the project

Made offline by the scripts in `tools/audio/` (how, and how to re-record a line: `tools/audio/README.md`). No recordings or music by anyone else are in them, except where noted.

| Asset | Made with | Licence of what was used | Used in |
| --- | --- | --- | --- |
| Voice acting for every line (`assets/audio/voice/`, listed in `src/audio/voice-lines.js`): Dr. Okoro, Dr. Vale and his laugh, HALCYON, the pilot, Subject 07 | Kokoro-82M text-to-speech (hexgrad, https://huggingface.co/hexgrad/Kokoro-82M) run through kokoro-onnx (thewh1teagle, https://github.com/thewh1teagle/kokoro-onnx); voices `am_michael`, `bm_george`, `bm_lewis`, `bf_emma`, `af_heart`, `am_echo`; then each character's processing (`tools/audio/voices.py`) | Kokoro-82M: Apache-2.0; kokoro-onnx: MIT. The model's output is ours to use | Every cutscene, Okoro's talk in the Foundry and the lift, the Skyline's intercom, Vale on the Labs' and the roof's PA, the lift's radio |
| The patients (`assets/audio/creatures/`): growls, moans, broken speech, shrieks, pain, death, roar, horde | Kokoro-82M (voices `am_onyx`, `bm_lewis`, `am_adam`, `bf_isabella`, `af_nicole`, `am_fenrir`), processed into creature sounds (`tools/audio/creatures.py`) | As above | The Labs and the Roof |
| Effects (`assets/audio/sfx/`): fire alarm, the player's breathing, grunts, pain and fall scream, demolition charges, building collapse, explosions, distant collapses, steel groaning, debris, sprinkler burst, monitor beep, pistol, clatter, brakes, cable snap, lift chime and doors, clank, spark | Synthesized from first principles in numpy/scipy (`tools/audio/sfx.py`); the player's grunts and scream from Kokoro (`af_heart`, `am_echo`) | Our own | Every level and the lifts |
| `glass-cascade.mp3` | Mixed from the team's supplied glass recordings above (Eaglaxle's shattering, Universfield's bottle), re-pitched, layered and spread | As those recordings | The breach's "glass, everywhere" |
| Stage scores (`assets/audio/music/`): foundry, labs, skyline, roof, tension, grief | Composed and synthesized in code (`tools/audio/music.py`): wavetable oscillators, filters, drums, convolution reverb | Our own | The Foundry, the Labs, the Skyline, the Roof, the wake-up and the Gravity Fault lift, the quiet ride |

Tools used only to make the files (not shipped with the game): espeak-ng through phonemizer (GPL-3.0, Kokoro's pronunciation), ffmpeg with the Rubber Band library (GPL, pitch and time), numpy and scipy (BSD).

## 4. Published techniques

These are well-known graphics techniques, implemented in our own code. They are credited because the maths or the approach comes from published work.

| Technique | Source | Where |
| --- | --- | --- |
| Fresnel approximation | C. Schlick, "An Inexpensive BRDF Model for Physically-based Rendering", 1994 | Glass, shards |
| Snell's law refraction, Beer-Lambert absorption | Standard optics | Glass |
| Ray/box intersection (slab method) | T. Kay and J. Kajiya, "Ray Tracing Complex Scenes", SIGGRAPH 1986 | Fire |
| Smooth minimum, SDF normals by tetrahedral differences, 3D value noise from a 2D texture | Inigo Quilez, articles at https://iquilezles.org | Serum capsule, noise lattice |
| FXAA | T. Lottes, NVIDIA, 2009 | Composite pass |
| ACES filmic tone-mapping curve (fitted) | K. Narkowicz, 2016 | 360° capture |
| Gaussian blur with linear sampling | D. Rákos, 2010 | Bloom |
| Rodrigues' rotation formula | Standard mathematics | GPU shard physics |
| Sobel filter for normal maps | Standard image processing | Both levels' textures |

## 5. Tools and assistance

| Tool | Use | Note |
| --- | --- | --- |
| Claude (Anthropic AI assistant) | Helped write Level 1's and Level 3's code, shaders, tests and documentation, and the audio tools (`tools/audio/`) that made the voices, creatures, effects and music | **Declare this according to the course's policy on AI assistance.** Every team member presenting a level should be able to explain the code; `docs/shaders-explained.md` and `docs/level-3-handoff.md` are written for that purpose |

## 6. Reference games (inspiration only, no assets used)

| Game | Developer | What we took |
| --- | --- | --- |
| Smash Hit | Mediocre AB | Throwing spheres, glass destruction, limited ammunition |
| Temple Run 2 | Imangi Studios | Chase camera, lanes, obstacle anticipation |
