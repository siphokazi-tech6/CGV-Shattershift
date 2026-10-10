/**
 * The briefing film (src/story/prologue.js, from the menu): it loads, plays
 * every chapter in order with its caption, renders each one without an
 * error, is narrated from recordings (not the browser's speech synthesis),
 * ends on the title and hands back to the menu; Esc skips it.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";

export const name = "briefing";
export const page = "game";

export async function run(page, { shots }) {
  const failures = [];
  const notes = {};
  const check = (label, ok, detail = "") => {
    if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ""}`);
  };
  const dir = path.join(shots, "briefing");
  await mkdir(dir, { recursive: true });

  const loaded = await page.evaluate(async () => {
    __dbg.manual = true;
    __dbg.startBriefing();
    const t0 = performance.now();
    while (!__dbg.prologue?.active && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 100));
    return { active: !!__dbg.prologue?.active, ms: Math.round(performance.now() - t0) };
  });
  check("the briefing loads and starts", loaded.active, JSON.stringify(loaded));
  notes.loadMs = loaded.ms;
  if (!loaded.active) return { failures, notes };

  const { CHAPTERS } = await page.evaluate(async () => ({ CHAPTERS: (await import("/src/story/prologue.js")).CHAPTERS.map((c) => ({ title: c.title, seconds: c.seconds, text: c.text })) }));

  // Play it through: the middle of each chapter, a screenshot each.
  let start = 0;
  for (const [i, c] of CHAPTERS.entries()) {
    const at = await page.evaluate((T) => {
      const p = __dbg.prologue;
      let error = null;
      while (p.t < T && p.active) {
        __dbg.step(1, 1 / 30);
        try { __dbg.render(); } catch (e) { error = e.message; break; }
      }
      return {
        chapter: p.chapter, error,
        title: p.ui.title.textContent,
        caption: p.ui.text.textContent,
      };
    }, start + c.seconds * 0.75);
    check(`chapter ${i + 1} "${c.title}" plays in order`, at.chapter === i && at.title === c.title, JSON.stringify({ chapter: at.chapter, title: at.title }));
    check(`chapter ${i + 1} renders`, !at.error, at.error ?? "");
    check(`chapter ${i + 1} types its caption`, at.caption.length > 10 && c.text.startsWith(at.caption), at.caption.slice(0, 40));
    await page.screenshot({ path: path.join(dir, `${String(i + 1).padStart(2, "0")}-${c.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`), type: "jpeg", quality: 70 });
    start += c.seconds;
  }

  const end = await page.evaluate(() => {
    const p = __dbg.prologue;
    let sawTitle = false;
    let guard = 0;
    // The narration is recorded audio: the browser's speech synthesis stays silent.
    const speaking = typeof speechSynthesis !== "undefined" && speechSynthesis.speaking;
    while (p.active && guard++ < 600) {
      __dbg.step(1, 1 / 30);
      if (p.ui.end.classList.contains("show")) sawTitle = true;
    }
    return { sawTitle, active: p.active, speaking, overlayHidden: p.ui.root.hidden };
  });
  check("it ends on the title", end.sawTitle, JSON.stringify(end));
  check("...then hands back (the overlay goes)", !end.active && end.overlayHidden, JSON.stringify(end));
  check("no browser speech synthesis (the narration is recorded)", !end.speaking);

  const skip = await page.evaluate(async () => {
    __dbg.startBriefing();
    const t0 = performance.now();
    while (!__dbg.prologue?.active && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 60; i += 1) __dbg.step(1, 1 / 30);
    dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape", bubbles: true }));
    dispatchEvent(new KeyboardEvent("keyup", { code: "Escape", key: "Escape", bubbles: true }));
    __dbg.step(2, 1 / 30);
    return { active: __dbg.prologue.active, t: +__dbg.prologue.t.toFixed(1) };
  });
  check("Esc skips it", !skip.active, JSON.stringify(skip));
  return { failures, notes };
}
