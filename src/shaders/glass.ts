/**
 * The liquid-glass material, ported from the reference's TSL node graph to
 * plain GLSL ES 3.00.
 *
 * The whole effect is one material on one subdivided plane. There is no
 * transmission material, no backdrop read, no post-processing pass and no
 * second render of the scene — which is exactly why a hundred glass panes
 * cost about a hundred draw calls of a single shared program. Each card
 * refracts its OWN texture through a virtual slab whose shape is described
 * analytically by a signed-distance field.
 *
 * Pipeline, in the order the fragment shader runs it:
 *   rounded-rect SDF  ->  superellipse bevel height field
 *                     ->  numeric-gradient normal (+ spherical dish tilt)
 *                     ->  per-channel refract() with spectral taps
 *                     ->  Schlick fresnel reflection of an equirect env
 *                     ->  rim ring, composite, antialiased cutout
 */

export const GLASS_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec3 position;
in vec2 uv;

uniform mat4 uProj, uView, uModel;
uniform vec2 uPlaneSize;
uniform float uSphereR;

out vec2 vUv;
out vec2 vLocal;

float chordZ(vec2 p) { return sqrt(max(uSphereR * uSphereR - dot(p, p), 1.0)); }

void main() {
  vUv = uv;
  vLocal = position.xy;
  vec2 e = position.xy * uPlaneSize;
  /* The slab sags onto the same sphere the grid is bent around, so a card's
     surface continues its neighbours' curvature instead of sitting flat on
     a curved layout. The plane is subdivided 16x12 precisely so this
     displacement is smooth - at 1x1 it would fold into two flat triangles
     and every card would crease down its diagonal. */
  float dish = chordZ(e) - uSphereR;
  gl_Position = uProj * uView * uModel * vec4(position.xy, dish, 1.0);
}`;

export const GLASS_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vLocal;
out vec4 frag;

uniform sampler2D uTex, uEnv;
uniform vec2 uPlaneSize, uCoverScale, uCoverOffset;
uniform vec3 uCamLocal;   // xy in plane units, z in px
uniform mat3 uRot;        // model rotation only
uniform float uSphereR, uCornerR, uBevelW, uBevelPow, uBevelMaxSlope,
              uThickness, uIor, uRefractStrength, uDispersion,
              uFresnelF0, uEnvIntensity, uEnvMaxMix, uEnvRot, uEnvRotX,
              uEnvScale, uEnvSquare,
              uRimWidth, uRimIntensity, uOpacity;
uniform vec3 uRimColor, uRimColorTop, uTint;
uniform int uSamples;
uniform int uFlat;        // 1 = crisp overlay pass, mirroring the DOM text layer
uniform vec3 uSW[5];      // spectral weights, per channel
uniform float uSO[5];     // spectral offsets

float sdRoundRect(vec2 p, vec2 half_, float r) {
  vec2 q = abs(p) - half_ + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

/* Superellipse bevel: t runs 0 at (edge - bevelWidth) to 1 at the edge, and
   height = (1 - t^k)^(1/k). At k = 3.9 that is a flat top with a steep
   shoulder - a rounded chamfer, not a sphere. The flat top is what leaves
   the card's centre almost unrefracted while the rim bends hard. */
float bevelHeight(float d, float bevelW, float bevelPow, float thickness) {
  float t = clamp(1.0 + d / max(bevelW, 0.001), 0.0, 1.0);
  float k = max(bevelPow, 1.0);
  return pow(max(1.0 - pow(t, k), 0.0), 1.0 / k) * thickness;
}

vec2 halfSize() { return uPlaneSize * 0.5; }

float sdf(vec2 p) {
  vec2 hs = halfSize();
  return sdRoundRect(p, hs, min(uCornerR, min(hs.x, hs.y)));
}

float height(vec2 p) { return bevelHeight(sdf(p), uBevelW, uBevelPow, uThickness); }

float chordZ(vec2 p) { return sqrt(max(uSphereR * uSphereR - dot(p, p), 1.0)); }

/* Composite in LINEAR light. The reference is three.js, which decodes the
   sRGB card texture on sample, mixes against a linear HDR environment, then
   encodes once on output. Doing that arithmetic on sRGB-encoded values makes
   a bright reflection clip against the content flatly instead of rolling into
   it, which reads as plastic even when every other term is right. Rim and
   tint are (1,1,1) here; linearise them on the CPU if they ever change. */
vec3 srgbToLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

vec2 equirectUV(vec3 d) {
  return vec2(atan(d.z, d.x) * 0.1591549, asin(clamp(d.y, -1.0, 1.0)) * 0.3183099) + 0.5;
}

void main() {
  vec2 p = vLocal * uPlaneSize;   // plane px, origin at the card centre
  float sd = sdf(p);

  if (uFlat == 1) {
    /* Overlay pass. The reference keeps titles in the DOM and syncs them
       with matrix3d so type never touches the shader and stays crisp at any
       DPR. This is the same idea inside WebGL: sample the label atlas with
       no refraction at all, so glyph edges keep their own antialiasing. */
    float fwf = max(fwidth(sd) * 0.5, 1e-4);
    float mask = 1.0 - smoothstep(-fwf, fwf, sd);
    vec4 t = texture(uTex, vUv);
    float aa = t.a * mask * uOpacity;
    if (aa < 0.004) discard;
    frag = vec4(t.rgb, aa);
    return;
  }

  /* Normal by central differences of the height field. Numerical rather
     than analytic on purpose: the superellipse has no cheap closed-form
     gradient, and differencing it means the profile can be retuned by
     changing one exponent without deriving anything. The slope clamp stops
     the near-vertical shoulder from bending rays past grazing, which
     otherwise samples far outside the texture and smears the corners. */
  float e = max(uBevelW * 0.06, 0.35);
  vec2 grad = vec2(
    height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0)),
    height(p + vec2(0.0, e)) - height(p - vec2(0.0, e))
  ) / (2.0 * e);
  float gm = length(grad);
  grad *= min(gm, uBevelMaxSlope) / max(gm, 1e-4);

  vec2 dishGrad = p / chordZ(p);
  float face = gl_FrontFacing ? 1.0 : -1.0;
  vec3 N = normalize(vec3(dishGrad - grad, 1.0)) * face;

  vec3 surf = vec3(vLocal, chordZ(p) - uSphereR);
  vec3 toCam = uCamLocal - surf;
  vec3 V = normalize(vec3(toCam.xy * uPlaneSize, toCam.z));

  /* Spectral refraction of the card's own texture. Each tap gets its own
     IOR, so red bends least and blue most; the triangle weights recombine
     them into RGB. Five taps is enough to read as smooth dispersion because
     the fringe only appears where the normal tilts - the flat centre
     refracts almost straight through and all five taps land together. */
  vec3 col = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    if (i >= uSamples) break;
    float eta = 1.0 / max(uIor + uDispersion * uSO[i], 1.0001);
    vec3 rr = refract(-V, N, eta);
    float len = uThickness / max(abs(rr.z), 0.05);
    vec2 duv = rr.xy * len * uRefractStrength / uPlaneSize;
    vec2 uv2 = clamp(vUv + duv, 0.0, 1.0) * uCoverScale + uCoverOffset;
    col += srgbToLinear(texture(uTex, uv2).rgb) * uSW[i];
  }

  /* Fresnel reflection of the studio environment. The .xy/.z split feeds the
     rotation matrix a vector already in card space; scale cancels out of a
     reflection so only rotation is applied. */
  vec3 Nw = normalize(uRot * N);
  vec3 Vw = normalize(uRot * V);
  vec3 Rr = reflect(-Vw, Nw);

  float cy = cos(uEnvRot), sy = sin(uEnvRot);
  Rr = vec3(Rr.x * cy - Rr.z * sy, Rr.y, Rr.x * sy + Rr.z * cy);
  float cx = cos(uEnvRotX), sx = sin(uEnvRotX);
  Rr = vec3(Rr.x, Rr.y * cx - Rr.z * sx, Rr.y * sx + Rr.z * cx);

  /* The environment carries real high dynamic range — softboxes sit around
     30, not 1. That is load-bearing: envMix is hard-capped at uEnvMaxMix
     (0.27), so a source has to exceed ~3.7 before the reflection can reach
     white. Cap an LDR map at 1.0 and the same maths can only ever return a
     grey haze, which is the difference between a lit slab and a flat card. */
  /* uEnvSquare is 0 on an RGBA16F environment, where the texel already IS the
     radiance, and 1 on the byte fallback, where the map was square-root
     encoded to fit 0..1 without crushing the dark half of the room. uEnvScale
     is the range that encoding was normalised against.

     Uploading this uniform at all is the load-bearing part: left at the GL
     default of 0 the sample is pure black, the fresnel term can then only
     DARKEN the bevel, and every specular highlight in the scene disappears. */
  vec3 env = texture(uEnv, equirectUV(Rr)).rgb;
  env = mix(env, env * env, uEnvSquare) * uEnvScale;

  float fres = uFresnelF0 + (1.0 - uFresnelF0) * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 5.0);
  float envMix = min(clamp(fres * uEnvIntensity, 0.0, 1.0), uEnvMaxMix);

  float rim = smoothstep(-uRimWidth, 0.0, sd) * uRimIntensity;
  vec3 rimC = mix(uRimColor, uRimColorTop, clamp(p.y / max(halfSize().y, 1e-4) * 0.5 + 0.5, 0.0, 1.0));

  vec3 outCol = mix(col * uTint, env, envMix) + rimC * rim;

  /* Antialiased rounded-rect cutout. fwidth gives the SDF's screen-space
     rate of change, so the edge stays one pixel wide however the card is
     tilted or scaled by the sphere. */
  float fw = max(fwidth(sd) * 0.5, 1e-4);
  float a = (1.0 - smoothstep(-fw, fw, sd)) * uOpacity;
  if (a < 0.001) discard;
  frag = vec4(linearToSrgb(outCol), a);
}`;
