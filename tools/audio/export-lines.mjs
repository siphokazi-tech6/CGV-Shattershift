/**
 * Every line the game speaks, as JSON for the voice generator (voices.py).
 *
 *   node tools/audio/export-lines.mjs > lines.json
 *
 * Sources: the story script (src/story/script.js), the Skyline's intercom
 * (src/levels/causeway/layout.js) and the radio in the quiet ride
 * (src/elevators/quiet-ride.js - read as text, it imports Three.js).
 * Stage directions ([square brackets]) and "..." are not voiced here: they
 * are sound cues (src/story/voice.js).
 */

import { readFile } from "node:fs/promises";
import { SCENES, readTime } from "../../src/story/script.js";
import { authoredLayout } from "../../src/levels/causeway/layout.js";

const lines = [];
const seen = new Set();
const add = (who, text, scene, hold = null) => {
  const key = `${who}|${text}`;
  if (seen.has(key) || /^\[.*\]$/.test(text.trim()) || /^[.\s]*$/.test(text)) return;
  seen.add(key);
  lines.push({ key, who, text, scene, hold: hold ?? readTime(text) });
};

for (const [scene, list] of Object.entries(SCENES)) {
  for (const line of list) if (line.who !== "sfx") add(line.who, line.text, scene, line.hold);
}
for (const entry of authoredLayout()) {
  if (entry.event === "radio") add(entry.who, entry.text, "skylineRadio", 3 + entry.text.length * 0.045);
}
// The Skyline's own two intercom lines outside the layout (causeway/index.js).
add("halcyon", "Tower C has lost its core. Brace.", "skylineRadio");
add("vale", "The atrium's gone. Keep climbing, Seven - all the way to the roof.", "skylineRadio");

// The quiet ride's radio: Kestrel One (the pilot) calling.
const ride = await readFile(new URL("../../src/elevators/quiet-ride.js", import.meta.url), "utf8");
const block = ride.match(/export const LINES = \{([\s\S]*?)\n\};/)[1];
for (const [, , , text] of block.matchAll(/(\w+): \["(\w+)", "((?:[^"\\]|\\.)*)"\]/g)) {
  add("pilot", text.replace(/\\"/g, '"'), "quietRideRadio", 3.6);
}

process.stdout.write(JSON.stringify(lines, null, 2));
