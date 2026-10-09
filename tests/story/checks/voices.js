/**
 * The voices: every line the game speaks has a recording (so a line whose
 * words changed is caught until it is re-recorded - tools/audio/README.md),
 * every recording is there and decodes, every stage direction in the script
 * has a sound cue, and no subtitle leaves before its line is finished.
 */

export const name = "voices";

export async function run(page) {
  const result = await page.evaluate(async () => {
    const out = [];
    const check = (label, ok, detail = "") => out.push([label, !!ok, detail]);
    const { SCENES, timeLines } = await import("/src/story/script.js");
    const { VOICE_LINES } = await import("/src/audio/voice-lines.js");
    const { CUES } = await import("/src/story/voice.js");
    const { authoredLayout } = await import("/src/levels/causeway/layout.js");
    const { LINES: RADIO } = await import("/src/elevators/quiet-ride.js");

    const direction = (text) => /^\[.*\]$/.test(text.trim()) || text.trim() === "...";
    const spoken = [];
    for (const [scene, lines] of Object.entries(SCENES)) {
      for (const line of lines) if (line.who !== "sfx" && !direction(line.text)) spoken.push([scene, `${line.who}|${line.text}`]);
    }
    for (const e of authoredLayout()) if (e.event === "radio") spoken.push(["skyline intercom", `${e.who}|${e.text}`]);
    for (const [, text] of Object.values(RADIO)) spoken.push(["lift radio", `pilot|${text}`]);

    const missing = spoken.filter(([, key]) => !VOICE_LINES[key]).map(([scene, key]) => `${scene}: ${key}`);
    check("every line has a recording (re-run tools/audio/voices.py after changing words)", !missing.length, missing.slice(0, 4).join(" / "));

    const directions = new Set();
    for (const lines of Object.values(SCENES)) for (const line of lines) if (direction(line.text)) directions.add(line.text.trim());
    const uncued = [...directions].filter((d) => !(d in CUES));
    check("every stage direction has a sound cue (or is silent on purpose)", !uncued.length, uncued.join(" / "));

    // The files: there, and real audio.
    const ctx = new OfflineAudioContext(1, 1, 24000);
    const files = [];
    for (const [file, , , gendered] of Object.values(VOICE_LINES)) files.push(...(gendered ? [`${file}-f`, `${file}-m`] : [file]));
    const broken = [];
    for (const file of files) {
      try {
        const response = await fetch(`/assets/audio/voice/${file}.mp3`);
        if (!response.ok) throw new Error(response.status);
        const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (buffer.duration < 0.3) throw new Error("too short");
      } catch (error) {
        broken.push(`${file} (${error.message})`);
      }
    }
    check(`all ${files.length} recordings load and decode`, !broken.length, broken.slice(0, 4).join(" / "));

    // A subtitle stays up while its line is spoken.
    const short = [];
    for (const [scene, lines] of Object.entries(SCENES)) {
      for (const line of timeLines(lines)) {
        const entry = VOICE_LINES[`${line.who}|${line.text}`];
        if (entry && line.hold < entry[1]) short.push(`${scene}: ${line.text.slice(0, 30)} (${line.hold.toFixed(2)} < ${entry[1]})`);
      }
    }
    check("no subtitle leaves before its line is finished", !short.length, short.slice(0, 3).join(" / "));
    check("Dr. Vale has his laugh", !!VOICE_LINES["#laugh-maniac"]);
    return { out, lines: spoken.length, files: files.length };
  });
  const failures = result.out.filter(([, ok]) => !ok).map(([label, , detail]) => `${label}${detail !== "" ? ` (${detail})` : ""}`);
  return { failures, notes: { lines: result.lines, recordings: result.files } };
}
