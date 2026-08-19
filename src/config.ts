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

/**
 * Video-backed cards, off by default.
 *
 * The reference streams one HLS rendition per card into a detached <video>
 * and uploads it as a texture; gl/video.ts has the mechanics. Point `sources`
 * at your own .m3u8 or .mp4 URLs and set `enabled` to true. Any card without
 * a video keeps its procedural scene, so a short list is fine - the reference
 * itself ships 19 clips across 100 meshes.
 *
 * HLS needs hls.js everywhere except Safari, which plays .m3u8 natively:
 *   npm i hls.js
 * Plain .mp4 needs nothing. Cross-origin sources must send CORS headers or
 * the texture upload taints the context and the draw fails.
 */
export const VIDEO = {
  enabled: true,
  sources: [] as { src: string; poster?: string }[],
  /* Only fetched when an .m3u8 source is present, no global Hls exists, and
     the browser cannot play HLS natively. Set to '' to disable the fetch, or
     import hls.js yourself and assign it to globalThis.Hls. */
  hlsUrl: 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.mjs',
};
