/**
 * The game's master bus: music, voices and effects all go through one gentle
 * limiter on their way out, so a stack of loud moments (an explosion over a
 * line of dialogue over the score) is held instead of clipping.
 *
 *   source.connect(outputFor(ctx));   // instead of ctx.destination
 */

const OUTPUTS = new WeakMap();

export function outputFor(ctx) {
  let out = OUTPUTS.get(ctx);
  if (!out) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    out = ctx.createGain();
    out.connect(limiter);
    OUTPUTS.set(ctx, out);
  }
  return out;
}
