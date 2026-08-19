/**
 * The card source pass: writes a photograph or a decoded video frame into a
 * card's texture, cover-fitted, with an optional slow zoom and drift.
 *
 * It runs here rather than binding the source straight to the glass for one
 * concrete reason: the glass samples `clamp(uv + refraction, 0, 1) * uCover`,
 * so folding a cover-fit into those uniforms would scale the refraction with
 * it - a 16:9 clip in a 4:3 card would quietly lose a quarter of its lens
 * bend on one axis. Doing the fit here keeps the cover uniforms at identity
 * and the glass path untouched.
 */
export const IMAGE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uImage;
uniform float uTime;
uniform float uSeed;
/* 1 for a still, which needs all the motion it can get; near 0 for video,
   which already moves and only wants a touch of drift on top. */
uniform float uDrift;
/* cover-fit for a source whose aspect differs from the card's 4:3. */
uniform vec2 uCover, uCoverOff;

void main() {
  /* Ken Burns, at a rate that is actually visible. The first version ran the
     zoom on a 114-second period and the pan on 150, which moved the image
     about a pixel every two seconds - technically animated, indistinguishable
     from a still. These periods are roughly 24 and 35 seconds, which reads as
     drift without becoming a slideshow effect. The seed phase-offsets every
     card so they do not breathe in unison. */
  float amp = uDrift;
  float z = 1.0 + (0.09 + 0.06 * sin(uTime * 0.26 + uSeed * 2.3)) * amp;
  float margin = 0.5 - 0.5 / z;
  vec2 pan = vec2(sin(uTime * 0.19 + uSeed * 1.7),
                  cos(uTime * 0.155 + uSeed * 2.9)) * margin * 0.85;

  /* Stays clear of the edges at the extremes, so the clamp never smears a
     border pixel across the card. */
  vec2 s = clamp((vUv - 0.5) / z + 0.5 + pan, 0.0, 1.0);
  frag = vec4(texture(uImage, s * uCover + uCoverOff).rgb, 1.0);
}`;
