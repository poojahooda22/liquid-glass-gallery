import { GRID } from './config';
import { clamp } from './math';

/**
 * The grid solver: how many cards are needed to cover the viewport once the
 * flat torus is bent onto a sphere, and how big each one is.
 *
 * The subtlety is that a card's screen position is NOT linear in its grid
 * position. Cards further around the sphere are also further away, so their
 * projected offset saturates toward the horizon. Counting cells with plain
 * division under-fills the edges; the bisection below asks the real
 * projection how far around the sphere the viewport can actually see.
 */

export type Layout = {
  /** Focal length in px; camera sits at this z, so world units == CSS px. */
  F: number;
  /** Sphere radius the grid is bent onto. */
  R: number;
  planeW: number;
  planeH: number;
  cols: number;
  rows: number;
  maxZoomZ: number;
  /** Scales the shader's px-denominated constants with the card. */
  cardScale: number;
};

/**
 * Screen-projected offset of a point at arc-length `s` along the sphere,
 * minus the half-card that hangs back toward the viewport at that depth.
 */
function projectedReach(s: number, halfPlane: number, F: number, R: number): number {
  const depth = F + R * (1 - Math.cos(s / R));
  return (F * R * Math.sin(s / R)) / depth - (halfPlane * F) / depth;
}

/**
 * Smallest arc whose projection covers `halfExtent`, by bisection.
 *
 * The upper bound is the sphere's silhouette — the arc at which the surface
 * turns away from the camera entirely. Past it there is nothing more to
 * reveal, so if even the horizon fails to cover the viewport we return it
 * rather than searching a range that cannot contain an answer.
 */
function arcToCover(halfExtent: number, halfPlane: number, F: number, R: number): number {
  let hi = R * Math.acos(R / (F + R));
  if (projectedReach(hi, halfPlane, F, R) < halfExtent) return hi;
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (projectedReach(mid, halfPlane, F, R) < halfExtent) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Round up to an EVEN count inside [lo, hi].
 *
 * Even matters: odd rows are offset half a cell for the brick stagger, so an
 * odd column count leaves the wrap seam misaligned against itself and a
 * visible discontinuity walks across the grid as you drag.
 */
function roundEven(v: number, lo: number, hi: number): number {
  const i = clamp(Math.ceil(v), lo, hi);
  if (i % 2 === 0) return i;
  if (i + 1 <= hi) return i + 1;
  return i - 1 >= lo ? i - 1 : i;
}

export function computeLayout(w: number, h: number): Layout {
  const g = GRID;
  const scale = Math.max(w, h) / g.referenceWidth;
  const F = g.perspective * scale;
  const R = g.sphereRadius * scale;

  const ratio = h > w ? g.planeWidthRatioPortrait : g.planeWidthRatio;
  const planeW = w * ratio;
  const planeH = planeW / g.planeAspect;
  const cellW = planeW * (1 + g.gapRatio);
  const cellH = planeH * (1 + g.gapRatio);
  const maxZoomZ = 0.1 * F;

  /* Coverage margin, parallax slack and the dolly-out are all added before
     solving, so the grid stays full during a hard fling instead of showing
     its edge exactly when the camera pulls back to reveal one. */
  const slack = Math.tan(0.05) * F + maxZoomZ;
  const extX = 0.5 * w * g.coverageMargin + slack;
  const extY = 0.5 * h * g.coverageMargin + slack;

  /* The +4 is the reference's own margin on top of the solved coverage. It
     does two jobs: nothing can pop in at the edge during a hard fling, and
     the wrap period grows by four cells in each axis, so you drag a lot
     further before the gallery repeats itself. */
  const cols = roundEven((2 * arcToCover(extX, planeW / 2, F, R)) / cellW + 4, g.minCols, g.maxCols);
  const rows = roundEven((2 * arcToCover(extY, planeH / 2, F, R)) / cellH + 4, g.minRows, g.maxRows);

  return {
    F,
    R,
    planeW,
    planeH,
    cols,
    rows,
    maxZoomZ,
    cardScale: planeW / (g.referenceWidth * g.planeWidthRatio),
  };
}
