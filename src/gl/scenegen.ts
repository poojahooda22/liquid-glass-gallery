import { CARDS, type SceneKind } from '../content';
import { GRID, LOW_TIER } from '../config';
import { makeProgram, uniformMap } from './program';
import { ENV_FRAG, FULLSCREEN_VERT, sceneFragSource } from '../shaders/scenes';
import { IMAGE_FRAG } from '../shaders/image';
import type { ImageBank } from './images';
import type { VideoBank } from './video';

/**
 * Anything that can hand the card pass a texture per slot. Photographs and
 * video expose the same shape, which is what lets a card upgrade from one to
 * the other without the renderer knowing the difference.
 */
export type Sources = {
  /** Moving footage. Preferred whenever a slot has decoded a frame. */
  videos: VideoBank | null;
  /** Stills, used while a clip is still buffering. */
  images: ImageBank | null;
};

/**
 * Card artwork and the studio environment, rendered on the GPU.
 *
 * The bank stays alive after boot because the cards are not stills. Each
 * frame the renderer hands back the set of cards actually on screen and a
 * budget, and that many get re-rendered with a fresh clock — so the gallery
 * is full of moving scenes for the cost of a few small passes, with no video
 * decoding, no network, and nothing to license.
 *
 * These textures deliberately carry NO mipmaps. Refraction displaces the
 * fetch, so the UV derivative spikes across the bevel and a mipped sample
 * drops to a coarse level exactly where the compressed detail should be
 * sharpest. That was why the rim read as a soft smear instead of a lens.
 */

const KIND_INDEX: Record<SceneKind, number> = {
  clouds: 0,
  clouds2: 1,
  plane: 2,
  forest: 3,
  city: 4,
  dusk: 5,
  ridge: 6,
  water: 7,
  sunset: 8,
  night: 9,
  stars: 10,
  neon: 11,
};

const SCENE_W = LOW_TIER ? 512 : 896;
const SCENE_H = Math.round((SCENE_W * 3) / 4);
const ENV_W = 1024;
const ENV_H = 512;

/**
 * How many PROCEDURAL cards may be repainted in a single frame.
 *
 * Photographic cards are not budgeted: their pass is one textured quad, where
 * a procedural scene is up to eighty octaves of noise per pixel. Holding both
 * to the same cap would make the photo drift update every third frame for no
 * reason, which reads as stutter rather than motion.
 */
export const ANIM_BUDGET = LOW_TIER ? 2 : 5;

/** Single triangle covering clip space; a quad would rasterise the diagonal twice. */
function fullscreenVAO(gl: WebGL2RenderingContext, program: WebGLProgram): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray returned null');
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export type SceneBank = {
  textures: WebGLTexture[];
  /** Re-render the given cards at `time`. Leaves the viewport to the caller. */
  render(cards: readonly number[], time: number): void;
  dispose(): void;
};

type KindProgram = {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  vao: WebGLVertexArrayObject;
};

export function createSceneBank(
  gl: WebGL2RenderingContext,
  sources: Sources = { videos: null, images: null },
): SceneBank {
  /* One program per scene kind actually in use. Compiling all twelve costs a
     handful of milliseconds once; leaving them fused into a single shader
     cost forty-five frames a second, every frame. */
  const kinds = new Map<number, KindProgram>();
  const kindOf = CARDS.map((c) => KIND_INDEX[c.scene]);
  for (const kind of new Set(kindOf)) {
    const program = makeProgram(gl, FULLSCREEN_VERT, sceneFragSource(kind));
    kinds.set(kind, {
      program,
      u: uniformMap(gl, program, ['uSeed', 'uTime']),
      vao: fullscreenVAO(gl, program),
    });
  }
  /* The photographic path. Same target textures, different source: a card
     with a loaded image renders through Ken Burns instead of its painter. */
  const imageProgram = makeProgram(gl, FULLSCREEN_VERT, IMAGE_FRAG);
  const imageU = uniformMap(gl, imageProgram, [
    'uImage', 'uTime', 'uSeed', 'uCover', 'uCoverOff', 'uDrift',
  ]);
  const imageVAO = fullscreenVAO(gl, imageProgram);

  /* Reused per frame so grouping by kind allocates nothing. */
  const batches = new Map<number, number[]>();
  for (const kind of kinds.keys()) batches.set(kind, []);
  const photoBatch: number[] = [];
  const procBatch: number[] = [];
  /* Resolved source per photo card, so the split does the lookup once. */
  const photoTex = new Map<number, { tex: WebGLTexture; aspect: number; drift: number }>();
  /* Round-robin position, so every procedural card takes its turn. */
  let procCursor = 0;
  const fbo = gl.createFramebuffer();

  const textures = CARDS.map(() => {
    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SCENE_W, SCENE_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  });

  function render(cards: readonly number[], time: number): void {
    if (cards.length === 0) return;
    for (const list of batches.values()) list.length = 0;
    photoBatch.length = 0;
    procBatch.length = 0;
    photoTex.clear();
    for (const i of cards) {
      /* Three tiers, best available wins: moving footage, then a still while
         the clip buffers, then the procedural painter before either has
         arrived. The grid is therefore complete on frame one and upgrades
         itself as the network delivers, rather than showing holes. */
      const v = sources.videos;
      const im = sources.images;
      const vTex = v && v.count > 0 ? v.textureFor(i % v.count) : null;
      if (vTex && v) {
        /* Footage already moves; a little drift on top keeps neighbouring
           cards from looking locked to the same frame, but a full Ken Burns
           on top of video reads as a wobble. */
        photoTex.set(i, { tex: vTex, aspect: v.aspect(i % v.count), drift: 0.25 });
        photoBatch.push(i);
        continue;
      }
      const iTex = im && im.count > 0 ? im.textureFor(i % im.count) : null;
      if (iTex && im) {
        photoTex.set(i, { tex: iTex, aspect: im.aspect(i % im.count), drift: 1 });
        photoBatch.push(i);
        continue;
      }
      procBatch.push(i);
    }

    /* Every photo card repaints; the expensive painters take turns. */
    if (procBatch.length > ANIM_BUDGET) {
      procCursor %= procBatch.length;
      for (let n = 0; n < ANIM_BUDGET; n++) {
        const i = procBatch[(procCursor + n) % procBatch.length];
        batches.get(kindOf[i])?.push(i);
      }
      procCursor = (procCursor + ANIM_BUDGET) % procBatch.length;
    } else {
      for (const i of procBatch) batches.get(kindOf[i])?.push(i);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.viewport(0, 0, SCENE_W, SCENE_H);

    if (photoBatch.length > 0) {
      gl.useProgram(imageProgram);
      gl.bindVertexArray(imageVAO);
      gl.uniform1i(imageU.uImage, 0);
      gl.uniform1f(imageU.uTime, time);
      gl.activeTexture(gl.TEXTURE0);
      for (const i of photoBatch) {
        const src = photoTex.get(i);
        if (!src) continue;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i], 0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1f(imageU.uDrift, src.drift);
        /* object-fit: cover against the card's aspect. Stills are cropped to
           4:3 at the CDN so this is the identity for them; 16:9 footage is
           genuinely cropped here, which is why the fit lives in this pass and
           not in the glass uniforms. */
        const a = src.aspect;
        const pa = GRID.planeAspect;
        if (a > pa) {
          const sx = pa / a;
          gl.uniform2f(imageU.uCover, sx, 1);
          gl.uniform2f(imageU.uCoverOff, (1 - sx) / 2, 0);
        } else {
          const sy = a / pa;
          gl.uniform2f(imageU.uCover, 1, sy);
          gl.uniform2f(imageU.uCoverOff, 0, (1 - sy) / 2);
        }
        gl.uniform1f(imageU.uSeed, i * 1.618 + 0.37);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    for (const [kind, list] of batches) {
      if (list.length === 0) continue;
      const kp = kinds.get(kind);
      if (!kp) continue;
      gl.useProgram(kp.program);
      gl.bindVertexArray(kp.vao);
      gl.uniform1f(kp.u.uTime, time);
      for (const i of list) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i], 0);
        /* Two cards can share a painter; only the seed keeps them apart. */
        gl.uniform1f(kp.u.uSeed, i * 1.618 + 0.37);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  function dispose(): void {
    gl.deleteFramebuffer(fbo);
    gl.deleteVertexArray(imageVAO);
    gl.deleteProgram(imageProgram);
    for (const kp of kinds.values()) {
      gl.deleteVertexArray(kp.vao);
      gl.deleteProgram(kp.program);
    }
    for (const t of textures) gl.deleteTexture(t);
  }

  /* Paint every card once so nothing shows an empty texture on frame one. */
  render(textures.map((_, i) => i), 0);
  return { textures, render, dispose };
}

/**
 * The studio map. Returns the texture plus how the glass shader must decode
 * it: `scale` is the multiplier and `square` is 1 when the map was
 * square-root encoded to survive an 8-bit target.
 */
export function generateEnvTexture(
  gl: WebGL2RenderingContext,
): { texture: WebGLTexture; scale: number; square: number } {
  const float = gl.getExtension('EXT_color_buffer_float') !== null;
  /* On a float target the texel IS the radiance. On the byte fallback the map
     is normalised by this range and square-root encoded. A plain divide
     crushes the room's dark half - the floor sits around 0.006 - straight to
     zero; sqrt keeps roughly even relative precision from 0.001 upward. */
  const scale = float ? 1 : 64;
  const square = float ? 0 : 1;

  const program = makeProgram(gl, FULLSCREEN_VERT, ENV_FRAG);
  const u = uniformMap(gl, program, ['uOutScale', 'uOutSqrt']);
  const vao = fullscreenVAO(gl, program);
  const fbo = gl.createFramebuffer();

  const texture = gl.createTexture();
  if (!texture) throw new Error('createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (float) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, ENV_W, ENV_H, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ENV_W, ENV_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  /* Longitude is periodic; CLAMP would freeze a seam at one edge as the
     reflection sweeps past 180 degrees. */
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('environment framebuffer incomplete');
  }
  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, ENV_W, ENV_H);
  gl.uniform1f(u.uOutScale, 1 / scale);
  gl.uniform1f(u.uOutSqrt, square);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  gl.deleteFramebuffer(fbo);
  gl.deleteVertexArray(vao);
  gl.deleteProgram(program);
  return { texture, scale, square };
}
