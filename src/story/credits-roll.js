/**
 * The end credits (Phase 6): the team, the cast, then every external asset
 * the game uses - the models from the Labs' credits data (the same list the
 * in-game K panel shows, CC-BY attribution included), and the music and
 * sound credited in docs/credits.md - then the libraries and the thanks.
 */

import { GAME_TITLE, STORY_CREDITS } from "./script.js";
import { MELTDOWN_CREDITS } from "../levels/meltdown/credits.js";

/** Music and sound effects (docs/credits.md §3). */
export const AUDIO_CREDITS = [
  ["Story briefing music", "Leberch - leberch-piano-story"],
  ["Main menu music", "Holizna - trap melody loop 5"],
  ["Sector 03 music", "GalacticTemple (source pending)"],
  ["Fire", "VanzetPictures"],
  ["Solid impact", "Sumaga123"],
  ["Sprinkler water", "(source pending)"],
  ["Glass shatter", "Eaglaxle"],
  ["Containment glass", "Universfield"],
  ["Falling object", "Dragon Studio"],
  ["Game over", "Universfield"],
  ["Broken glass underfoot", "JohanDeecke"],
  ["Lift", "(source pending)"],
  ["Lift machinery", "oneirophile - noisy old elevator (Freesound)"],
  ["Lift music", "kk - lift music (Freesound Community)"],
  ["Sphere throw, pickups", "Floraphonic"],
  ["Ricochet", "Freesound Community"],
  ["UI click", "JustSomeSounds"],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function creditsHTML() {
  const c = STORY_CREDITS;
  const parts = [`<div class="gap"></div><h1>${esc(GAME_TITLE)}</h1><p><small>${esc(c.team)}</small></p>`];
  for (const r of c.roles) parts.push(`<h2>${esc(r.role)}</h2><p>${r.names.length ? r.names.map(esc).join("<br>") : esc(c.team)}</p>`);
  parts.push(`<h2>Cast</h2>${c.cast.map(([who, as]) => `<p>${esc(who)}<small>${esc(as)}</small></p>`).join("")}`);
  parts.push(`<h2>Models</h2>${MELTDOWN_CREDITS.map((m) => `<p>${esc(m.title)}<small>${esc(m.author)} - ${esc(m.licence)}${m.url ? ` - ${esc(m.url.replace(/^https:\/\//, ""))}` : ""}<br>${esc(m.use)}</small></p>`).join("")}`);
  parts.push(`<h2>Music and sound</h2>${AUDIO_CREDITS.map(([what, who]) => `<p>${esc(what)}<small>${esc(who)}</small></p>`).join("")}`);
  parts.push(`<h2>Made with</h2><p>Three.js<small>MIT licence</small></p><p>Blender<small>asset conversion</small></p><p>Fire, smoke, sky, glass, the Labs' sound and most textures<small>generated in code</small></p>`);
  parts.push(`<div class="gap"></div><p>${esc(c.thanks)}</p><div class="gap"></div>`);
  return parts.join("");
}

/** Every asset key the credits cover (for the check that nothing loaded goes uncredited). */
export function creditedAssets() {
  return MELTDOWN_CREDITS.flatMap((m) => m.assets ?? []);
}
