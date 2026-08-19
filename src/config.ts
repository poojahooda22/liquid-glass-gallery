/**
 * Shipped constants from the teardown of infinite-liquid-glass.shader.se.
 *
 * Every value here is the reference implementation's own default, not a
 * guess. Two groups are dimensionless on purpose: GLASS ratios multiply the
 * card's pixel width, GLASS pixel values multiply `cardScale`. Both
 * conversions happen once per frame in main.ts, so this file stays a plain
 * declaration of the design.
 */

/** Ratios are of planeW; pixel values are multiplied by cardScale. */
export const GLASS = {
  cornerRadius: 0.163, // x planeW
  bevelWidth: 0.192, // x planeW
  bevelPower: 3.9, // superellipse exponent of the bevel profile
  bevelMaxSlope: 1.74,
  thickness: 155, // x cardScale, virtual glass depth in px
  ior: 2.3,
  refractStrength: 0.7,
  dispersion: 0.32,
  dispersionSamples: 5, // 3 on low-tier devices
  fresnelF0: 0.045,
  envIntensity: 1.93,
  /* The cap that keeps content readable at grazing angles. Without it the
     fresnel term drives the env reflection to 1.0 around the whole bevel and
     the card's own image disappears behind the studio HDR. */
  envMaxMix: 0.27,
  envRotation: -2, // radians about Y
  envRotationX: 0,
  rimWidth: 10, // x cardScale
  rimIntensity: 0.11,
  rimColor: [1, 1, 1] as const,
  rimColorTop: [1, 1, 1] as const,
  tint: [1, 1, 1] as const,
};

export const GRID = {
  perspective: 1200, // CSS-px focal length at the reference width
  sphereRadius: 5000, // the grid is bent onto a sphere of this radius
  planeAspect: 4 / 3,
  planeWidthRatio: 0.38, // card width as a fraction of viewport width
  planeWidthRatioPortrait: 0.72,
  gapRatio: 0.045,
  referenceWidth: 1728, // design reference; all sizes scale by max(w,h)/this
  coverageMargin: 1.15,
  minCols: 4,
  maxCols: 16,
  minRows: 4,
  maxRows: 16,
};

export const DRAG = {
  spring: { stiffness: 100, damping: 16, mass: 0.5 }, // scroll smoothing
  magnitudeSpring: { stiffness: 140, damping: 24, mass: 0.6 }, // velocity -> dolly
  fling: 0.1,
  multiplier: 1.5,
};

/** The intro: cell gap starts at 3 (cards scattered) and springs to gapRatio. */
export const INTRO_SPRING = { stiffness: 100, damping: 18, mass: 0.7 };
export const INTRO_GAP = 3;

/* Device tiering, per the reference: fewer spectral taps and a lower DPR
   ceiling on weak hardware. The tap count is the expensive axis - each one is
   a full texture fetch per fragment. */
export const LOW_TIER =
  (navigator.hardwareConcurrency ?? 8) <= 6 ||
  // deviceMemory is Chromium-only; absent elsewhere, which reads as high tier.
  ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

export const DPR_CAP = LOW_TIER ? 1.5 : 2;
export const DISPERSION_SAMPLES = LOW_TIER ? 3 : GLASS.dispersionSamples;
