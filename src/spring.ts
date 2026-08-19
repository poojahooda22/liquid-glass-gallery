/**
 * Damped spring, matching framer-motion's stiffness/damping/mass model.
 *
 * Substepped at a fixed 8ms rather than integrated at the frame's dt: a
 * stiffness of 140 against a 50ms hitch diverges under plain semi-implicit
 * Euler, and the visible failure is the grid snapping past its target and
 * oscillating. Substepping costs a handful of multiplies and makes the
 * motion identical at 60Hz and 144Hz.
 */
export class Spring {
  x: number;
  target: number;
  v = 0;
  private readonly k: number;
  private readonly c: number;
  private readonly m: number;

  constructor(value: number, cfg: { stiffness: number; damping: number; mass: number }) {
    this.x = value;
    this.target = value;
    this.k = cfg.stiffness;
    this.c = cfg.damping;
    this.m = cfg.mass;
  }

  step(dt: number): number {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.k * (this.x - this.target) - this.c * this.v) / this.m;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}
