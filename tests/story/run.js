/**
 * Story checks: the Phase 1 systems on preview/story.html, and the story as
 * the real game plays it (index.html, through window.__dbg.story).
 *
 *   node tests/story/run.js            # every check
 *   node tests/story/run.js opening    # just the named check(s)
 *
 * Uses the Level 3 harness's server and browser setup (tests/meltdown/lib.js).
 * A check module exports `name`, `run(page)` and optionally `page` - "game"
 * for index.html (default: the story preview).
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { serve, launch, openPage } from "../meltdown/lib.js";
import * as reactions from "./checks/reactions.js";
import * as cutscene from "./checks/cutscene.js";
import * as companion from "./checks/companion.js";
import * as opening from "./checks/opening.js";
import * as lift from "./checks/lift.js";
import * as labs from "./checks/labs.js";
import * as skyline from "./checks/skyline.js";
import * as ending from "./checks/ending.js";
import * as restart from "./checks/restart.js";
import * as briefing from "./checks/briefing.js";
import * as voices from "./checks/voices.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ALL = [reactions, cutscene, companion, voices, briefing, opening, lift, labs, skyline, ending, restart];

const PAGES = {
  preview: {
    path: "/preview/story.html",
    ready: () => globalThis.__story?.ready,
    setup: () => { __story.manual = true; },
  },
  game: {
    path: "/index.html",
    ready: () => globalThis.__dbg?.story,
    // The game's own frame loop keeps running; checks step it with __dbg.step
    // and only read state between steps.
    setup: async () => { await __dbg.story.ready; },
  },
};

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("playwright is not installed.\n  npm install --no-save playwright\n  npx playwright install chromium");
    process.exit(2);
  }
  const only = process.argv.slice(2);
  const CHECKS = only.length ? ALL.filter((c) => only.includes(c.name)) : ALL;
  const server = await serve(ROOT);
  console.log(`serving ${ROOT}\n`);
  const browser = await launch(chromium);
  const errors = [];
  let failed = 0;

  for (const check of CHECKS) {
    const target = PAGES[check.page ?? "preview"];
    process.stdout.write(`${check.name} (${target.path}) ... `);
    // The game renders its whole post chain in software GL: a smaller frame
    // keeps each rendered frame (and so each screenshot) affordable.
    const tab = await openPage(browser, check.page === "game" ? { width: 960, height: 540 } : undefined);
    const page = tab.page;
    page.setDefaultTimeout(180000);
    try {
      await page.goto(`${server.origin}${target.path}`, { waitUntil: "load", timeout: 180000 });
      await page.waitForFunction(target.ready, null, { timeout: 180000 });
      await page.evaluate(target.setup);
      const { failures, notes } = await check.run(page, { shots: path.join(ROOT, "tests/story/shots") });
      if (failures.length) {
        failed += failures.length;
        console.log(`FAIL (${failures.length})`);
        for (const f of failures) console.log(`  x ${f}`);
      } else console.log("ok");
      for (const [key, value] of Object.entries(notes ?? {})) console.log(`  · ${key}: ${JSON.stringify(value)}`);
    } catch (error) {
      failed += 1;
      console.log("ERROR");
      console.log(`  x ${error.message}`);
    }
    errors.push(...tab.errors);
    await page.close();
    console.log();
  }

  await browser.close();
  await server.close();
  const real = errors.filter((e) => !/toNonIndexed/.test(e));
  if (real.length) {
    console.log(`page errors (${real.length}):`);
    for (const e of real.slice(0, 10)) console.log(`  ${e}`);
    failed += real.length;
  }
  console.log(failed ? `\n${failed} problem(s).` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
