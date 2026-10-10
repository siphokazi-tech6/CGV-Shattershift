/**
 * Level 1 layout - where everything is, as data.
 *
 * The level is authored as three beats, each introduction -> escalation ->
 * finale in miniature, matching the project guide's environment plan
 * ("Level 1 begins on an open bridge, passes through a mirrored gallery, and
 * ends at a tall elevator atrium"), re-ordered for the story: the patient
 * wakes in a ward, flees across the skybridge, and reaches the lift through
 * the mirrored resonance atrium.
 *
 *   BEAT A  CONTAINMENT WARD    0 - 240   teaches: throw, lanes, sprinklers, vents
 *   BEAT B  SKYBRIDGE          240 - 540  combines: collapse chase, sculptures, smoke
 *   BEAT C  RESONANCE ATRIUM   540 - 784  finale: mirrors, fire walls, three-lock gate
 *
 * Every entry is { d, type, ...params } where d is metres along the route and
 * x is the lateral offset (lanes at -3.2, 0, 3.2). The level spawns entries
 * as the player approaches and disposes them once passed, so the same
 * streaming code runs the authored level and the endless one.
 */

export const LANES = [-3.2, 0, 3.2];
const [L, C, R] = LANES;

export const BEATS = [
  { key: "ward", name: "CONTAINMENT WARD", theme: "ward", start: -40, end: 240, ceiling: 5.2 },
  { key: "bridge", name: "SKYBRIDGE B", theme: "bridge", start: 240, end: 540, ceiling: 5.2 },
  { key: "atrium", name: "RESONANCE ATRIUM", theme: "atrium", start: 540, end: 900, ceiling: 10.6 },
];

export const ROUTE = {
  length: 784,
  gate: 768,
  stopLine: 760,
  lift: 781,
  chase: { start: 262, end: 528, gap: 34, speed: 9.6 },
};

/** Smoke zones: base density; each linked vent removes its share when broken. */
export const SMOKE_ZONES = [
  { from: 126, to: 204, density: 0.75, vents: ["v1", "v2"] },
  { from: 366, to: 462, density: 0.9, vents: ["v3", "v4"] },
  { from: 646, to: 724, density: 0.8, vents: ["v5", "v6"] },
];

export const RADIO = {
  halcyon: "HALCYON // FACILITY AI",
  vale: "DR. VALE // INTERCOM",
};

export function authoredLayout() {
  const e = [];
  const add = (d, type, params = {}) => e.push({ d, type, ...params });
  const pane = (d, x, extra = {}) => add(d, "pane", { x, ...extra });
  const fire = (d, x, width, extra = {}) => add(d, "fire", { x, width, ...extra });
  const radio = (d, who, text) => add(d, "event", { event: "radio", who, text });

  /* ---------------- BEAT A - CONTAINMENT WARD ---------------- */
  // Beat A's title is the level intro card, shown by the host at run start.
  add(-0.5, "pod", { x: C });
  add(-12, "sign", { x: C, y: 3.6, sign: "ward", facing: 1, width: 4.4, height: 1.1 });
  radio(4, "halcyon", "Subject 07 on Skybridge B. Containment breach logged.");
  add(8, "sign", { x: -5.75, y: 2.4, sign: "evac", side: -1 });
  add(10, "beacon", { x: 2.6 });
  radio(14, "vale", "Still running, Seven? Elias bought you a lift ride. That's all he could buy.");
  pane(20, C, { hint: "Throw at the glass" });
  pane(34, L); pane(34, R);
  add(42, "cache", { x: C, y: 2.3 });
  add(50, "file", { x: C, y: 1.7, index: 0 });
  add(56, "hazard", { x: L, kind: "cart" }); pane(58, R);
  radio(58, "halcyon", "Fire on Skybridge B. All personnel: sprinkler bulbs are glass. Break one to flood the zone.");
  add(64, "sprinkler", { x: -1.6 });
  fire(72, -1.6, 5.4, { height: 2.8 });
  add(70, "beacon", { x: -2.6 });
  add(84, "tank", { x: -4.4 }); add(84, "tank", { x: 4.4 });
  add(86, "sign", { x: 5.75, y: 3.9, sign: "biohazard", side: 1 });
  add(92, "tank", { x: -4.4 }); add(100, "tank", { x: 4.4 });
  add(94, "cache", { x: R, y: 2.6 });
  pane(100, C, { reinforced: true, hint: "Reinforced: two hits" }); add(100, "hazard", { x: R, kind: "cabinet" });
  add(112, "serum", { x: C, y: 1.7, serum: "prism" });
  pane(122, L); pane(122, C, { mirror: true });
  radio(124, "halcyon", "Smoke in the ward. All personnel: break the vent covers to clear the air.");
  add(130, "beacon", { x: 2.6 });
  add(136, "vent", { side: -1, id: "v1" });
  fire(140, R, 3.4); add(140, "cache", { x: L, y: 1.6 });
  add(152, "hazard", { x: C, kind: "rack" }); pane(152, L);
  add(164, "vent", { side: 1, id: "v2" });
  pane(164, R); add(166, "cache", { x: C, y: 3.3 });
  add(170, "sprinkler", { x: 0 }); fire(178, C, 3.6);
  add(186, "file", { x: L, y: 1.7, index: 1 });
  add(192, "hazard", { x: R, kind: "cart" }); pane(192, C);
  radio(198, "vale", "Every floor is wired, Seven. I signed the order myself.");
  add(210, "collapse", { x: C, kind: "beam" });
  pane(218, L); pane(218, R, { reinforced: true });
  add(228, "cache", { x: C, y: 2.0 });
  add(234, "sign", { x: C, y: 5.9, sign: "bridge", facing: 1, width: 4, height: 1 });
  add(238, "door", { x: C, hint: "Security door: break it" });

  /* ---------------- BEAT B - SKYBRIDGE ---------------- */
  add(242, "event", { event: "explosion", behind: 26, strength: 1 });
  add(246, "event", { event: "title", beat: 1 });
  radio(248, "halcyon", "Structural failure, Skybridge B. Evacuate the bridge.");
  add(256, "event", { event: "tower" });
  add(262, "event", { event: "chaseStart" });
  pane(272, C); add(272, "cache", { x: L, y: 2.2 });
  fire(286, L, 3.2); pane(286, R);
  add(296, "cache", { x: C, y: 3.0 });
  add(302, "collapse", { x: R, kind: "glass" });
  add(318, "sculpture", { x: C, speed: 1.0 });
  radio(322, "vale", "Run all you like. Everything you are, I made.");
  add(336, "sprinkler", { x: 1.6, gantry: true }); fire(344, 1.6, 5.0);
  add(352, "cache", { x: L, y: 2.8 });
  add(360, "serum", { x: C, y: 1.6, serum: "thermal" });
  add(368, "vent", { side: -1, id: "v3", gantry: true });
  pane(374, L); pane(374, R); add(376, "cache", { x: C, y: 2.4 });
  add(386, "hazard", { x: L, kind: "rubble" });
  add(400, "collapse", { x: R, kind: "beam" });
  add(406, "vent", { side: 1, id: "v4", gantry: true });
  add(410, "file", { x: C, y: 1.7, index: 2 });
  add(424, "sculpture", { x: C, speed: -1.25 });
  fire(440, L, 3.4); pane(440, C, { reinforced: true });
  pane(452, L); pane(452, R);
  add(466, "serum", { x: L, y: 1.6, serum: "shield" });
  add(478, "hazard", { x: R, kind: "cabinet" }); pane(478, L);
  radio(484, "halcyon", "Resonance atrium. Lift release requires the three-lock sequence.");
  add(490, "cache", { x: R, y: 2.2 });
  add(494, "sprinkler", { x: 0, gantry: true }); fire(502, C, 3.6);
  add(514, "collapse", { x: L, kind: "glass" });
  add(528, "event", { event: "chaseEnd" });
  add(534, "sign", { x: C, y: 6.0, sign: "atrium", facing: 1, width: 4, height: 1 });
  add(538, "door", { x: C });

  /* ---------------- BEAT C - RESONANCE ATRIUM ---------------- */
  add(546, "event", { event: "title", beat: 2 });
  pane(554, L, { mirror: true }); pane(554, R, { mirror: true });
  radio(558, "vale", "Break every lock you like, Seven. The charges don't care.");
  add(568, "sculpture", { x: C, speed: 1.4 });
  add(578, "sprinkler", { x: 0, ceiling: 6.0 });
  fire(586, L, 3.2, { height: 3.6 }); fire(586, R, 3.2, { height: 3.6 });
  add(596, "cache", { x: C, y: 3.0 });
  add(606, "serum", { x: R, y: 1.6, serum: "overdrive" });
  add(616, "hazard", { x: L, kind: "rack" }); pane(616, C); pane(616, R, { mirror: true });
  add(626, "cache", { x: R, y: 2.4 });
  add(632, "collapse", { x: L, kind: "beam" });
  add(642, "file", { x: R, y: 1.7, index: 3 });
  add(652, "vent", { side: -1, id: "v5", height: 3.0 });
  add(660, "sprinkler", { x: 0, ceiling: 6.0 }); fire(668, C, 3.6);
  pane(678, L); pane(678, C, { reinforced: true }); pane(678, R);
  add(688, "vent", { side: 1, id: "v6", height: 3.0 });
  add(692, "cache", { x: L, y: 2.0 }); add(692, "hazard", { x: R, kind: "cart" });
  add(704, "collapse", { x: C, kind: "glass" });
  add(714, "file", { x: C, y: 1.7, index: 4 });
  fire(722, R, 3.0); pane(722, L, { mirror: true });
  add(732, "cache", { x: C, y: 2.2 });
  radio(738, "halcyon", "Lift release: locks one, two, three. In order.");
  add(740, "event", { event: "finale" });
  add(ROUTE.gate, "gate", { x: C });
  add(ROUTE.gate - 1, "sign", { x: C, y: 8.2, sign: "lift", facing: 1, width: 4.4, height: 1.1 });
  add(ROUTE.lift, "lift", { x: C });

  // The building burning around the route: fires along the walls, outside
  // the lanes. They light the corridor, feed the smoke and the soot columns,
  // and can be put out, but never block the way.
  const decor = [[38, -1], [90, 1], [126, -1], [190, 1], [232, -1], [300, 1], [420, -1], [520, 1],
    [566, -1], [612, 1], [650, -1], [684, 1], [730, -1]];
  for (const [d, side] of decor) {
    add(d, "fire", { x: side * 5.15, width: 1.3, depth: 1.8, height: 1.5 + ((d * 7) % 10) / 12, decor: true });
  }
  // Sprinkler heads whose glass bulbs have already burst in the heat - showers
  // you run through. Kept 14 m or more from any fire they would put out.
  for (const d of [24, 104, 206, 262, 394, 470, 548, 626, 700, 745]) {
    add(d, "sprinkler", { x: ((d * 13) % 3 - 1) * 2.2, auto: true, ceiling: themeAt(d) === "atrium" ? 6.0 : 5.2 });
  }

  // Ward and atrium beacons, and ward signage cadence.
  for (let d = 30; d < 236; d += 40) add(d, "beacon", { x: d % 80 ? 2.6 : -2.6 });
  return e.sort((a, b) => a.d - b.d);
}

export function themeAt(d, mode = "story") {
  if (mode === "endless") {
    const cycle = ["ward", "bridge", "atrium"];
    return cycle[Math.floor(Math.max(0, d) / 240) % 3];
  }
  for (const beat of BEATS) if (d < beat.end) return beat.theme;
  return "atrium";
}

export function beatAt(d) {
  return BEATS.find((b) => d >= b.start && d < b.end) ?? BEATS[BEATS.length - 1];
}

export function ceilingAt(d, mode = "story") {
  const theme = themeAt(d, mode);
  return theme === "atrium" ? 10.6 : 5.2;
}

/* ------------------------------------------------------------------ */
/* Endless mode                                                         */
/* ------------------------------------------------------------------ */

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Endless generator: stitches randomised chunks together forever.
 *
 * Each chunk is a small authored pattern (a pane gauntlet, a fire lane with
 * its sprinkler, a collapse, a sculpture...) placed at a random lane. The
 * generator guarantees the two rules the authored level follows by hand:
 * never block all three lanes with solids, and keep a sphere cache coming
 * often enough that a careful player cannot run dry. Density rises with
 * distance; `difficulty` goes 0 -> 1 over the first 1.5 km.
 */
export class EndlessGenerator {
  constructor(seed = Date.now()) {
    this.rand = mulberry(seed);
    this.cursor = 18;
    this.sinceCache = 0;
    this.chunk = 0;
  }

  pick(list) { return list[Math.floor(this.rand() * list.length)]; }

  /** Generate entries until `until` metres. */
  generate(until) {
    const out = [];
    while (this.cursor < until) {
      const d = this.cursor;
      const difficulty = Math.min(1, d / 1500);
      const theme = themeAt(d, "endless");
      const gantry = theme === "bridge";
      const ceiling = theme === "atrium" ? 6.0 : 5.2;
      const lane = this.pick(LANES);
      const others = LANES.filter((x) => x !== lane);
      const r = this.rand();
      let length = 16;

      if (this.sinceCache > 34 - difficulty * 8) {
        out.push({ d, type: "cache", x: lane, y: 1.8 + this.rand() * 1.4 });
        this.sinceCache = 0;
        length = 10;
      } else if (r < 0.26) {
        // Pane gauntlet: glass in two lanes, sometimes all three.
        for (const x of this.rand() < 0.3 + difficulty * 0.4 ? LANES : others) {
          out.push({ d, type: "pane", x, reinforced: this.rand() < difficulty * 0.35, mirror: theme === "atrium" && this.rand() < 0.4 });
        }
      } else if (r < 0.42) {
        // Fire lane with its sprinkler just before it.
        out.push({ d, type: "sprinkler", x: lane * 0.5, gantry, ceiling });
        out.push({ d: d + 8, type: "fire", x: lane, width: 3.2 + this.rand() * 2 });
        length = 20;
      } else if (r < 0.56) {
        // Solid hazard in one lane, glass in another.
        out.push({ d, type: "hazard", x: lane, kind: this.pick(["cart", "cabinet", "rack", "rubble"]) });
        out.push({ d: d + 1, type: "pane", x: this.pick(others) });
      } else if (r < 0.66) {
        out.push({ d: d + 6, type: "collapse", x: lane, kind: this.rand() < 0.5 ? "beam" : "glass" });
        length = 22;
      } else if (r < 0.74) {
        out.push({ d: d + 4, type: "sculpture", x: 0, speed: (this.rand() < 0.5 ? -1 : 1) * (0.9 + difficulty * 0.8) });
        length = 22;
      } else if (r < 0.82) {
        out.push({ d, type: "tank", x: -4.4 }, { d: d + 6, type: "tank", x: 4.4 });
        out.push({ d: d + 3, type: "pane", x: lane });
      } else if (r < 0.88) {
        out.push({ d, type: "serum", x: lane, y: 1.6, serum: this.pick(["prism", "thermal", "shield", "overdrive"]) });
        length = 12;
      } else if (r < 0.94) {
        out.push({ d, type: "fire", x: lane, width: 3.2 }, { d: d + 1, type: "fire", x: this.pick(others), width: 3.2 });
        out.push({ d: d - 7, type: "sprinkler", x: 0, gantry, ceiling });
        length = 20;
      } else {
        out.push({ d, type: "hazard", x: lane, kind: "cart" }, { d: d + 8, type: "hazard", x: this.pick(others), kind: "cabinet" });
        length = 20;
      }
      // Walls keep burning in endless mode too.
      if (this.rand() < 0.35) out.push({ d: d + length * 0.5, type: "fire", x: (this.rand() < 0.5 ? -1 : 1) * 5.15, width: 1.3, depth: 1.8, height: 1.7, decor: true });
      this.sinceCache += length;
      this.chunk += 1;
      // Gaps tighten with difficulty but never below a readable spacing.
      this.cursor += length + 6 + (1 - difficulty) * 10 + this.rand() * 6;
    }
    return out.sort((a, b) => a.d - b.d);
  }
}
