/**
 * Wall-clock fixed-step accumulator.
 *
 * Drives a fixed-timestep loop from a monotonic time source the room owns,
 * rather than from a caller-supplied delta.
 *
 * Why not use the delta Colyseus passes to `setSimulationInterval`?
 * Colyseus passes `clock.deltaTime`. When `patchRate = 0` (Schema patching
 * disabled — we broadcast our own snapshots), Colyseus also installs a
 * competing 60Hz `clock.tick()` interval that is never cleared. Both that
 * interval and our 30Hz simulation interval tick the *shared* clock, so the
 * `deltaTime` our callback observes only reflects the gap since the last
 * internal tick (~13ms on average), not the real time since our previous
 * callback (~33ms). Feeding that undercounted delta into the accumulator made
 * the simulation advance at ~12Hz instead of 30Hz, so client inputs backed up
 * and latency grew without bound.
 *
 * Owning the clock here makes the loop immune to that quirk: we measure real
 * elapsed time ourselves and run as many fixed steps as it warrants.
 */
// Boundary epsilon: 1000/30 = 33.3333…336 is not exactly representable, so an
// accumulator that lands a hair below the step would silently drop one step per
// second (29Hz instead of 30Hz — a slow drift). Treat values within this
// tolerance of the step as having reached it.
const EPSILON = 1e-9;

export class FixedStepAccumulator {
  private acc = 0;
  private last: number | null = null;

  constructor(
    private readonly stepMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /**
   * Advance using real elapsed wall-clock time since the previous call.
   * Returns how many fixed steps should run this tick. The first call only
   * primes the clock (returns 0). Fractional remainders are carried so no
   * time is lost across calls.
   */
  pump(): number {
    const t = this.now();
    if (this.last === null) {
      this.last = t;
      return 0;
    }
    this.acc += t - this.last;
    this.last = t;
    let steps = 0;
    while (this.acc >= this.stepMs - EPSILON) {
      this.acc -= this.stepMs;
      steps++;
    }
    return steps;
  }
}
