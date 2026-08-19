/**
 * Card artwork and the studio environment, generated on the GPU.
 *
 * Two findings drove this out of Canvas2D and into shaders.
 *
 * First, refraction is only visible when there is something to bend. A soft
 * gradient bent through a lens is still a soft gradient, so painted blobs
 * made the glass read as a dark vignette. What the reference refracts is
 * photography — foliage, city windows, aircraft livery — all high frequency.
 * Procedural noise at pixel rate gives the same thing without shipping a
 * single licensed asset.
 *
 * Second, the specular highlights need real high dynamic range. The
 * environment is mixed in at a hard cap of 0.27, so an LDR map can never
 * exceed 0.27 and reads as grey haze; a softbox at 30.0 blows straight
 * through the cap to white. That is the entire difference between "a card
 * with a dark rim" and "a slab of glass with a light on it".
 */

export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Hashing and noise, shared by both generators. */
const NOISE = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p, int oct) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p = p * 2.02 + vec2(11.3, 7.7);
    a *= 0.5;
  }
  return s;
}

/* Ridged noise: the absolute value creases the field, which is what turns a
   smooth blob into a mountain crest rather than a hill. */
float ridged(vec2 p, int oct) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0));
    p = p * 2.03 + vec2(5.1, 9.2);
    a *= 0.5;
  }
  return s;
}
`;

/**
 * One program per scene, not one program with twelve branches.
 *
 * The combined shader measured 1.4fps against 59fps for the same pixels: the
 * driver has to allocate registers for the union of every branch, and twelve
 * inlined noise pipelines blow past what the hardware can keep resident, so
 * it spills. Selecting the branch at compile time lets the compiler strip the
 * other eleven entirely, and each program then fits.
 */
const SCENE_FRAG_TEMPLATE = /* glsl */ `#version 300 es
#define SCENE_KIND __KIND__
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform float uSeed;
/* Every card is live. The reference plays a video per card; these scenes are
   re-rendered from this clock instead, which costs one small pass and gives
   the same thing the glass needs — motion under the lens. */
uniform float uTime;
${NOISE}

vec2 so;

vec3 skyBase(vec3 top, vec3 horizon, float bias) {
  return mix(horizon, top, pow(clamp(vUv.y, 0.0, 1.0), bias));
}

/* Warped fbm. The second evaluation displaces the first, which is what stops
   noise looking like noise and starts it looking like weather. */
float warped(vec2 p, int oct, float amt) {
  vec2 q = vec2(fbm(p, 4), fbm(p + vec2(3.1, 1.7), 4));
  return fbm(p + q * amt, oct);
}

vec3 cloudScene(bool storm) {
  vec2 uv = vUv;
  vec2 p = uv * vec2(3.4, 2.1) + so + vec2(uTime * 0.020, uTime * 0.006);
  vec3 col = storm
    ? skyBase(vec3(0.025, 0.030, 0.040), vec3(0.30, 0.33, 0.39), 1.05)
    : skyBase(vec3(0.04, 0.18, 0.46), vec3(0.66, 0.81, 0.93), 0.8);

  vec2 sunP = vec2(0.70, 0.80);
  float sd = length((uv - sunP) * vec2(1.0, 0.8));
  col += (storm ? vec3(0.55, 0.58, 0.62) : vec3(1.0, 0.85, 0.58)) * exp(-sd * 6.0) * (storm ? 0.5 : 1.1);

  float d = warped(p, 7, 1.6);
  float cover = smoothstep(storm ? 0.40 : 0.46, storm ? 0.66 : 0.76, d);
  /* Lighting the cloud by a higher octave of the same field reads as
     self-shadowing without a second pass. */
  float lit = smoothstep(0.32, 0.86, warped(p * 2.3 + 4.0 + vec2(uTime * 0.014, 0.0), 6, 1.1));
  /* A steeper response keeps most of the cloud in shadow and makes the lit
     edges rare and hot. The gentler curve averaged everything to one flat
     mid-grey, which is what made the storm cards read as fog on a window. */
  vec3 cloud = storm
    ? mix(vec3(0.035, 0.042, 0.055), vec3(1.02, 1.03, 1.06), pow(lit, 2.6))
    : mix(vec3(0.34, 0.40, 0.50), vec3(1.15, 1.12, 1.06), pow(lit, 1.3));
  if (storm) {
    /* One more octave of relief across the mass, so the eye has structure to
       follow rather than a single tone. */
    float relief = fbm(p * 5.5 + 21.0, 5);
    cloud *= 0.62 + 0.85 * relief;
  }
  col = mix(col, cloud, cover);

  float haze = smoothstep(0.34, 0.0, uv.y);
  col = mix(col, storm ? vec3(0.30, 0.33, 0.37) : vec3(0.80, 0.86, 0.92), haze * (storm ? 0.45 : 0.7));
  return col;
}

vec3 planeScene() {
  vec2 uv = vUv;
  vec3 col = skyBase(vec3(0.02, 0.12, 0.38), vec3(0.58, 0.76, 0.90), 0.75);
  float deck = smoothstep(0.30, 0.02, uv.y);
  float d = warped(uv * vec2(4.0, 2.4) + so + vec2(uTime * 0.30, 0.0), 6, 1.4);
  col = mix(col, mix(vec3(0.62, 0.68, 0.76), vec3(1.1, 1.1, 1.08), smoothstep(0.35, 0.8, d)), deck * 0.92);

  /* Wing: a band in a sheared coordinate, so both long edges stay hard lines
     at any resolution. The crisp silhouette is the thing the bevel bends. */
  vec2 q = uv - vec2(0.44, 0.46);
  float k = q.y - q.x * 1.15;
  float wing = step(-0.03, k) * step(k, 0.19) * step(-0.56, q.x) * step(q.x, 0.34);
  vec3 body = mix(vec3(0.90, 0.91, 0.94), vec3(0.26, 0.29, 0.35), smoothstep(-0.03, 0.19, k));
  float stripe = step(0.055, k) * step(k, 0.098);
  body = mix(body, vec3(0.88, 0.17, 0.11), stripe);
  float rivets = step(0.72, hash21(floor(vec2(q.x * 190.0, k * 60.0))));
  body += rivets * 0.10;
  col = mix(col, body, wing);
  return col;
}

vec3 forestScene() {
  vec2 uv = vUv;
  vec3 col = mix(vec3(0.62, 0.70, 0.62), vec3(0.06, 0.13, 0.09), pow(uv.y, 0.6));
  /* Light shafts, before any foliage, so the leaves occlude them. */
  float shaft = pow(max(0.0, 1.0 - abs(uv.x - 0.62 - uv.y * 0.14) * 3.4), 3.0);
  col += vec3(0.85, 0.92, 0.62) * shaft * 0.35 * smoothstep(0.0, 0.8, uv.y);

  /* The domain warp is computed once and shared by every layer. Calling
     warped() per layer evaluated it four times over and made this the most
     expensive scene in the set by a factor of three, for a displacement so
     low-frequency that the layers cannot tell it apart. */
  vec2 warp = vec2(fbm(uv * 3.0 + so, 3), fbm(uv * 3.0 + so + 7.0, 3)) - 0.5;

  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    /* Canopy first at a large scale, twigs last at a small one. Running every
       layer at one frequency gave uniform green static with no read of depth
       or of individual masses. */
    vec2 q = (uv + vec2(fl * 0.20, fl * 0.07)) * (2.8 + fl * 4.6) + so * (1.0 + fl)
           + warp * 0.9
           + vec2(sin(uTime * 0.34 + fl * 1.3) * (0.05 + fl * 0.045),
                  cos(uTime * 0.27 + fl * 1.9) * (0.03 + fl * 0.026));
    float leaf = fbm(q, 5);
    float mask = smoothstep(0.50 - fl * 0.05, 0.60 - fl * 0.05, leaf);
    float shade = fbm(q * (3.4 + fl * 2.6) + 13.0, 4);
    vec3 lc = mix(vec3(0.010, 0.026, 0.016), vec3(0.115, 0.235, 0.095), smoothstep(0.26, 0.74, shade));
    /* Sunlit leaves are a small fraction of a canopy, not half of it: rarer
       and warmer, well short of pure green. */
    lc = mix(lc, vec3(0.62, 0.74, 0.36), pow(smoothstep(0.68, 0.97, shade), 4.0));
    /* Aerial perspective. Far layers lose contrast and shift toward the haze
       colour, which is what reads as depth instead of stacked green noise. */
    lc = mix(lc, vec3(0.40, 0.48, 0.44), (2.0 - fl) / 2.0 * 0.46);
    col = mix(col, lc, mask);
  }

  float trunk = smoothstep(0.030, 0.012, abs(fract(uv.x * 3.0 + fbm(uv * 1.6 + so, 3) * 0.4) - 0.5));
  col = mix(col, vec3(0.06, 0.05, 0.04), trunk * smoothstep(0.05, 0.5, uv.y) * 0.8);
  return col;
}

vec3 cityScene() {
  vec2 uv = vUv;
  vec3 col = mix(vec3(0.09, 0.12, 0.24), vec3(0.010, 0.012, 0.035), pow(uv.y, 0.7));
  col += vec3(0.95, 0.48, 0.22) * exp(-abs(uv.y - 0.16) * 7.5) * 0.45;

  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float scale = 13.0 + fl * 8.0;
    float x = uv.x * scale + so.x * 3.0 + fl * 4.7 + uTime * (0.020 + fl * 0.013);
    float cell = floor(x);
    float fx = fract(x);
    float hgt = 0.18 + hash11(cell * 1.71 + fl * 31.0) * 0.40 - fl * 0.035;
    float gap = 0.14;
    if (uv.y < hgt && fx > gap * 0.5 && fx < 1.0 - gap * 0.5) {
      col = mix(vec3(0.055, 0.062, 0.10), vec3(0.012, 0.014, 0.030), fl / 2.0);
      /* Thousands of hard-edged window rectangles. This is the highest
         frequency content in the set and the clearest read of dispersion. */
      vec2 wg = vec2((fx - gap * 0.5) / (1.0 - gap) * 7.0, uv.y * scale * 2.6);
      vec2 wi = floor(wg);
      vec2 wf = fract(wg);
      /* Each window carries its own switching schedule, so the skyline
         changes the way a real one does rather than blinking in unison. */
      float phase = floor(uTime * 0.16 + hash21(wi + 3.1) * 40.0);
      float on = step(0.42, hash21(wi + cell * 13.0 + fl * 77.0 + phase * 0.021));
      float lit = step(0.18, wf.x) * step(wf.x, 0.62) * step(0.22, wf.y) * step(wf.y, 0.66);
      vec3 wc = mix(vec3(1.25, 0.98, 0.58), vec3(0.55, 0.85, 1.25), hash21(wi + 7.3));
      col += wc * on * lit * (1.35 - fl * 0.32);
    }
  }
  return col;
}

vec3 mountainScene(bool warm) {
  vec2 uv = vUv;
  vec3 col = warm
    ? mix(vec3(0.95, 0.62, 0.32), vec3(0.16, 0.10, 0.24), pow(uv.y, 0.55))
    : mix(vec3(0.88, 0.92, 0.96), vec3(0.42, 0.55, 0.68), pow(uv.y, 0.7));
  if (warm) {
    float sd = length((uv - vec2(0.34, 0.30)) * vec2(1.0, 1.6));
    col += vec3(1.4, 0.85, 0.42) * exp(-sd * 7.0);
  }
  float haze = fbm(vec2(uv.x * 3.0 + uTime * 0.03, uv.y * 2.2) + so, 5);
  col = mix(col, col * (warm ? vec3(1.18, 0.94, 0.86) : vec3(1.12, 1.14, 1.18)),
            smoothstep(0.42, 0.78, haze) * 0.5);

  for (int L = 0; L < 5; L++) {
    float fl = float(L);
    float base = 0.16 + fl * 0.105;
    float amp = 0.30 - fl * 0.045;
    vec2 q = vec2(uv.x * (2.2 + fl * 1.4) + so.x + fl * 9.0, fl * 3.0);
    float crest = base + (ridged(q, 4) - 0.5) * amp;
    if (uv.y < crest) {
      float t = (5.0 - fl) / 5.0;
      /* Rock detail only survives on the near layers; the far ones are haze,
         which is what sells the depth. */
      float rock = fbm(uv * vec2(26.0, 34.0) + fl * 17.0 + so, 4);
      vec3 face = warm
        ? mix(vec3(0.06, 0.04, 0.10), vec3(0.30, 0.16, 0.16), rock)
        : mix(vec3(0.10, 0.15, 0.22), vec3(0.42, 0.50, 0.60), rock);
      float sun = smoothstep(0.0, 0.5, crest - uv.y) * smoothstep(0.55, 0.0, abs(uv.x - 0.36));
      face += (warm ? vec3(0.95, 0.55, 0.28) : vec3(0.32, 0.36, 0.42)) * sun * 0.35;
      col = mix(col, face, 1.0 - t * 0.55);
    }
  }
  return col;
}

vec3 waterScene(bool sunsetLight) {
  vec2 uv = vUv;
  float horizon = 0.62;
  vec3 col;
  if (uv.y > horizon) {
    float t = (uv.y - horizon) / (1.0 - horizon);
    col = sunsetLight
      ? mix(vec3(1.35, 0.62, 0.30), vec3(0.32, 0.10, 0.26), pow(t, 0.7))
      : mix(vec3(0.55, 0.80, 0.88), vec3(0.05, 0.28, 0.44), pow(t, 0.8));
    float band = smoothstep(0.35, 0.75, warped(vec2(uv.x * 3.0 + uTime * 0.035, t * 5.0) + so, 5, 1.2));
    col = mix(col, col * (sunsetLight ? vec3(1.5, 0.9, 0.6) : vec3(1.25)), band * 0.5);
    if (sunsetLight) {
      float sd = length((uv - vec2(0.5, horizon + 0.04)) * vec2(1.0, 1.9));
      col += vec3(2.2, 1.3, 0.6) * exp(-sd * 16.0);
    }
  } else {
    float t = (horizon - uv.y) / horizon;
    /* Six interfering sinusoids plus noise: the crossings are what glint, and
       the glints are the detail the lens picks up. */
    float w = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      w += sin(uv.x * (11.0 + fi * 15.0) + t * (34.0 + fi * 21.0) + so.x * 4.0 + fi * 2.3
               + uTime * (0.95 + fi * 0.42)) / (1.0 + fi * 0.7);
    }
    float ripple = w * 0.16 + fbm(vec2(uv.x * 14.0, t * 40.0 - uTime * 0.9) + so, 5) * 0.55;
    col = sunsetLight
      ? mix(vec3(0.28, 0.09, 0.16), vec3(0.06, 0.03, 0.09), t)
      : mix(vec3(0.05, 0.24, 0.34), vec3(0.01, 0.07, 0.13), t);
    float glint = pow(smoothstep(0.52, 0.86, ripple), 5.0);
    float column = sunsetLight ? exp(-abs(uv.x - 0.5) * (3.0 + t * 14.0)) : 0.55;
    col += (sunsetLight ? vec3(2.4, 1.5, 0.7) : vec3(0.85, 1.25, 1.35)) * glint * column * (1.0 - t * 0.5);
  }
  return col;
}

vec3 starScene(bool moon) {
  vec2 uv = vUv;
  vec3 col = moon
    ? mix(vec3(0.06, 0.10, 0.20), vec3(0.005, 0.010, 0.030), pow(uv.y, 0.6))
    : vec3(0.004, 0.006, 0.018);

  /* Milky band: a sheared, softly masked fbm rather than a drawn shape. */
  float band = exp(-pow(abs((uv.y - 0.5) - (uv.x - 0.5) * 0.42) * 5.2, 2.0));
  col += mix(vec3(0.30, 0.32, 0.52), vec3(0.62, 0.55, 0.60), fbm(uv * 6.0 + so, 5))
       * band * fbm(uv * vec2(9.0, 5.0) + so * 2.0, 6) * (moon ? 0.35 : 0.95);

  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    vec2 g = uv * (90.0 + fl * 130.0) + so * 30.0 + fl * 41.0;
    vec2 gi = floor(g);
    vec2 gf = fract(g) - 0.5;
    float r = hash21(gi);
    if (r > 0.955 - fl * 0.012) {
      float mag = pow(hash21(gi + 3.7), 3.0);
      float star = exp(-dot(gf, gf) * (260.0 - mag * 180.0));
      vec3 tint = mix(vec3(1.0, 0.82, 0.60), vec3(0.72, 0.85, 1.25), hash21(gi + 11.1));
      float twinkle = 0.72 + 0.28 * sin(uTime * (1.3 + mag * 3.4) + hash21(gi + 5.5) * 6.2832);
      col += tint * star * (0.7 + mag * 3.4) * twinkle;
    }
  }

  if (moon) {
    vec2 mp = vec2(0.74, 0.76);
    float md = length((uv - mp) * vec2(1.0, 0.75));
    col += vec3(0.75, 0.84, 1.05) * exp(-md * 13.0) * 0.9;
    col += vec3(3.4, 3.5, 3.6) * smoothstep(0.052, 0.045, md);
    float cloud = smoothstep(0.48, 0.72, warped(uv * vec2(3.6, 2.0) + so + vec2(uTime * 0.024, 0.0), 6, 1.3));
    col = mix(col, vec3(0.10, 0.14, 0.24), cloud * 0.6 * smoothstep(0.7, 0.1, uv.y));
  }
  return col;
}

vec3 neonScene() {
  vec2 uv = vUv;
  vec3 col = mix(vec3(0.10, 0.03, 0.16), vec3(0.010, 0.008, 0.030), pow(uv.y, 0.8));
  /* Wet-street reflection: the same lines again, mirrored and smeared. */
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float h = hash11(fi * 7.31 + so.x * 13.0);
    float y = 0.12 + h * 0.80;
    float x0 = hash11(fi * 3.17 + 5.0) * 0.7 - 0.2;
    float len = 0.30 + hash11(fi * 11.7) * 0.65;
    float th = 0.0035 + hash11(fi * 5.3) * 0.006;
    /* Soft ends. A hard step here clipped the glow into visible rectangles,
       which read as a rendering artefact rather than a light. */
    float inX = smoothstep(0.0, 0.035, uv.x - x0) * smoothstep(0.0, 0.035, x0 + len - uv.x);
    float d = abs(uv.y - y);
    vec3 hue = mix(mix(vec3(1.6, 0.22, 0.85), vec3(0.25, 1.25, 1.7), step(0.33, h)),
                   vec3(1.5, 0.85, 0.30), step(0.72, h));
    /* Smooth breathing with an occasional dropped beat: a pure sine reads
       as a pulse animation, a tube reads as an unreliable one. */
    float flick = 0.80 + 0.20 * sin(uTime * (2.4 + h * 7.0) + fi * 2.1);
    flick *= mix(0.35, 1.0, step(0.055, hash11(floor(uTime * 7.0) + fi * 31.0)));
    col += hue * inX * flick * (exp(-d / (th * 9.0)) * 0.28 + smoothstep(th, th * 0.4, d) * 1.7);
    float ry = 0.22 - (y - 0.22) * 0.55;
    float rd = abs(uv.y - ry + fbm(vec2(uv.x * 30.0, 0.0) + so, 3) * 0.02);
    col += hue * inX * flick * exp(-rd / (th * 16.0)) * 0.22 * step(uv.y, 0.30);
  }
  for (int i = 0; i < 34; i++) {
    float fi = float(i);
    vec2 c = vec2(hash11(fi * 2.13 + so.x), hash11(fi * 4.77 + 9.0));
    float r = 0.012 + hash11(fi * 8.9) * 0.05;
    float d = length(uv - c);
    vec3 hue = mix(vec3(1.3, 0.3, 0.9), vec3(0.35, 1.0, 1.4), hash11(fi * 1.9));
    col += hue * smoothstep(r, r * 0.2, d) * 0.28 * (0.75 + 0.25 * sin(uTime * (1.1 + fi * 0.37)));
  }
  return col;
}

/* SCENE_KIND values are fixed by KIND_INDEX in gl/scenegen.ts. */
void main() {
  so = vec2(uSeed * 37.13, uSeed * 11.77);
  vec3 c;
#if SCENE_KIND == 0
  c = cloudScene(false);
#elif SCENE_KIND == 1
  c = cloudScene(true);
#elif SCENE_KIND == 2
  c = planeScene();
#elif SCENE_KIND == 3
  c = forestScene();
#elif SCENE_KIND == 4
  c = cityScene();
#elif SCENE_KIND == 5
  c = mountainScene(true);
#elif SCENE_KIND == 6
  c = mountainScene(false);
#elif SCENE_KIND == 7
  c = waterScene(false);
#elif SCENE_KIND == 8
  c = waterScene(true);
#elif SCENE_KIND == 9
  c = starScene(true);
#elif SCENE_KIND == 10
  c = starScene(false);
#else
  c = neonScene();
#endif

  /* Pixel-rate grain. Photographs have it, and without it the smoothest
     regions band once the bevel stretches them across the rim. */
  c += (hash21(vUv * 2048.0 + uSeed * 17.0) - 0.5) * 0.014;
  frag = vec4(max(c, 0.0), 1.0);
}`;

export function sceneFragSource(kind: number): string {
  return SCENE_FRAG_TEMPLATE.replace('__KIND__', String(kind));
}

export const ENV_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
/* Encoding control. On an RGBA16F target uOutScale is 1 and uOutSqrt is 0, so
   true radiance is written straight out. On the byte fallback the map is
   normalised by a range and square-root encoded: a plain divide would crush
   the room's dark half (around 0.008) to zero, where sqrt keeps rough
   relative precision from 0.001 up to the top of the range. */
uniform float uOutScale;
uniform float uOutSqrt;
${NOISE}

/* --------------------------------------------------------------------------
   The reference's own environment, reconstructed from measurement: Poly
   Haven's "Studio Small 03" 1k HDR, which the site serves from
   /hdri/studio_small_03_1k.hdr. It is CC0, so the real file can be dropped in
   instead - this is the no-asset version of the same room.

   Read back off the live page as a 32x12 grid of mean radiance, the room is
   almost entirely BLACK with three discrete features:

     v>0.90  ceiling ......... 0.01 everywhere
     u~0.23  v~0.73  KEY ..... cell mean 437, true peak 3363
     u~0.67  v~0.50  strip ... cell mean 32, narrow and vertical
     u~0.23  v~0.46  panel ... 0.25, a large dim diffuser
     v<0.25  floor ........... flat 0.33 rising to 0.60 straight down
     everything else ......... 0.00 - 0.01

   That distribution is the whole trick, and it is the opposite of what a
   hand-authored map looks like. My previous version spread six softboxes at
   14-34 evenly around the sphere, which puts a small reflection in EVERY
   direction - and a constant reflection reads as haze lying on the card
   rather than as light. Because the real room is black nearly everywhere, a
   card facing the viewer reflects 0.002 and stays clean; the specular only
   ignites where a bevel normal sweeps past one of the three sources. Clean
   glass plus a travelling highlight is what the eye reads as glass.
-------------------------------------------------------------------------- */

/* Measured chromaticity: the room is cool, b/r about 1.33, at every latitude. */
const vec3 ROOM_TINT = vec3(1.00, 1.19, 1.33);
const vec3 KEY_TINT  = vec3(0.87, 0.96, 1.00);
const vec3 FILL_TINT = vec3(0.96, 1.00, 0.99);

/* Longitude is periodic, so distance has to wrap or every light grows a seam. */
float lonDist(float a, float b) { return abs(fract(a - b + 0.5) - 0.5); }

/* A rectangular source with a soft shoulder. Sources are stacked from several
   of these because the measured falloff is not one smoothstep: 3363 at the
   core, 173 a few percent of longitude out, then 12, then black. */
float source(vec2 p, vec2 c, vec2 halfSize, float soft) {
  float dx = lonDist(p.x, c.x) - halfSize.x;
  float dy = abs(p.y - c.y) - halfSize.y;
  return 1.0 - smoothstep(-soft, soft, max(dx, dy));
}

void main() {
  vec2 p = vUv;                    // x = longitude, y = latitude, 1 is straight up

  /* The room. Measured 0.00-0.01 in every direction that is not a source, and
     that near-black floor is what lets a card facing the viewer stay clean. */
  vec3 col = ROOM_TINT * (0.002 + 0.002 * smoothstep(0.95, 0.35, p.y));

  /* FLOOR. Flat 0.33 at v=0.21 rising to 0.60 straight down - a lit
     cyclorama, and the only large bright area. It fills the underside of
     every bevel. */
  col += ROOM_TINT * (0.55 * smoothstep(0.28, 0.05, p.y) + 0.12 * smoothstep(0.38, 0.14, p.y));

  /* KEY. Centre u=0.227, v=0.734, peak 3363. Three tiers so the core stays
     small and hard while the spill still reaches a few percent out. */
  const vec2 KEY = vec2(0.227, 0.734);
  col += KEY_TINT * source(p, KEY, vec2(0.008, 0.011), 0.003) * 2400.0;
  col += KEY_TINT * source(p, KEY, vec2(0.018, 0.024), 0.010) * 260.0;
  col += KEY_TINT * source(p, KEY, vec2(0.038, 0.050), 0.035) * 9.0;

  /* STRIP. A narrow vertical source at u=0.672 straddling the horizon from
     v=0.38 to v=0.63. The second, much dimmer specular. */
  const vec2 FILL = vec2(0.672, 0.500);
  col += FILL_TINT * source(p, FILL, vec2(0.010, 0.070), 0.010) * 55.0;
  col += FILL_TINT * source(p, FILL, vec2(0.040, 0.120), 0.045) * 4.0;

  /* PANEL. The large dim diffuser at u 0.14-0.36, v 0.29-0.63. Across
     longitude the measurement is a bump, not a box - 0.07, 0.18, 0.22, 0.28,
     0.31, 0.26, 0.21, 0.06 - so it is a gaussian with its tail subtracted.
     The subtraction matters: an un-truncated gaussian leaves about 0.02
     everywhere, and 0.02 in every direction is exactly the haze this map
     exists to avoid. Too dim to make a highlight, but it is the soft sheen
     that crosses the flat middle of a card as it turns. */
  float panelU = max(exp(-pow(lonDist(p.x, 0.262) / 0.105, 2.0)) - 0.09, 0.0) * 0.34;
  /* And it is asymmetric: the measurement falls 0.22 -> 0.06 -> 0.00 over two
     cells on the right while trailing off gently on the left, so the right
     edge gets an explicit cut. Signed, wrapped longitude, because a symmetric
     distance cannot express "this side only". */
  float du = fract(p.x - 0.262 + 0.5) - 0.5;
  panelU *= 1.0 - smoothstep(0.085, 0.120, du);
  float panelV = 1.0 - smoothstep(0.10, 0.20, abs(p.y - 0.460) - 0.09);
  col += ROOM_TINT * panelU * panelV;

  /* Large-scale unevenness only: enough to give the reflection something to
     slide over, not enough to lift the black. */
  col *= 0.88 + fbm(vec2(p.x * 7.0, p.y * 3.5), 4) * 0.24;

  vec3 o = col * uOutScale;
  frag = vec4(mix(o, sqrt(clamp(o, 0.0, 1.0)), uOutSqrt), 1.0);
}`;
