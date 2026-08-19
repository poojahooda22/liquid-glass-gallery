import './style.css';
import { CARDS, IMAGE_POOL, VIDEO_POOL } from './content';
import { DISPERSION_SAMPLES, DPR_CAP, DRAG, GLASS, GRID, INTRO_GAP, INTRO_SPRING, VIDEO } from './config';
import { computeLayout, type Layout } from './layout';
import { clamp, composeTRS, lookAtOrigin, perspectiveMat, quatFromZ, rotateInverse, wrap } from './math';
import { Spring } from './spring';
import { buildPlane, spectralWeights, type Plane } from './gl/plane';
import { makeProgram, uniformMap } from './gl/program';
import { buildLabelCanvases, uploadLabels } from './gl/textures';
import { createSceneBank, generateEnvTexture, type SceneBank } from './gl/scenegen';
import { createImageBank, type ImageBank } from './gl/images';
import { createVideoBank, type VideoBank } from './gl/video';
import { assignCards } from './assign';
import { GLASS_FRAG, GLASS_VERT } from './shaders/glass';

/**
 * The frame loop.
 *
 * One program, one geometry, two draw calls per card. There is no render
 * target, no post pass and no second view of the scene — the "glass" is
 * entirely a fragment-stage construction, which is what lets the grid stay
 * cheap however many panes are on screen.
 *
 * The layout is a flat torus bent onto a sphere: grid coordinates wrap into
 * a fixed period, and the wrapped coordinate is then read as an arc length
 * and mapped onto a sphere of radius R whose front pole sits at the origin.
 * Dragging moves the wrap offset, so the gallery is infinite while the mesh
 * count stays constant.
 */

const el = document.getElementById('gl');
if (!(el instanceof HTMLCanvasElement)) throw new Error('#gl canvas not found');
const canvas = el;

const context = canvas.getContext('webgl2', {
  alpha: true,
  premultipliedAlpha: true,
  /* No MSAA: the card edge is an SDF cut with fwidth, so it is already
     antialiased at whatever scale the sphere puts it, and a multisampled
     default framebuffer would cost fill rate for nothing. */
  antialias: false,
  /* No depth buffer. Cards never intersect and are drawn strictly
     back-to-front, so a depth test could only ever reject fragments that are
     already drawn last — it would cost a buffer and reject nothing. */
  depth: false,
  powerPreference: 'high-performance',
});
if (!context) throw new Error('WebGL2 is required and is not available in this browser');
/* Re-bound after the guard so the narrowed type survives into every closure
   below; TypeScript will not carry a module-level narrowing into a callback. */
const gl = context;

const UNIFORMS = [
  'uProj', 'uView', 'uModel', 'uPlaneSize', 'uSphereR',
  'uTex', 'uEnv', 'uCoverScale', 'uCoverOffset', 'uCamLocal', 'uRot',
  'uCornerR', 'uBevelW', 'uBevelPow', 'uBevelMaxSlope', 'uThickness',
  'uIor', 'uRefractStrength', 'uDispersion', 'uFresnelF0',
  'uEnvIntensity', 'uEnvMaxMix', 'uEnvRot', 'uEnvRotX',
  'uRimWidth', 'uRimIntensity', 'uOpacity',
  'uRimColor', 'uRimColorTop', 'uTint', 'uSamples', 'uFlat', 'uSW', 'uSO', 'uEnvScale', 'uEnvSquare',
] as const;

const labelCanvases = buildLabelCanvases();
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let program!: WebGLProgram;
let u!: Record<string, WebGLUniformLocation | null>;
let plane!: Plane;
let sceneBank!: SceneBank;
let imageBank: ImageBank | null = null;
let labelTextures!: WebGLTexture[];
let envTexture!: WebGLTexture;
let videoBank: VideoBank | null = null;
let layout!: Layout;

/** Everything that dies with the GL context, so a restore can rebuild it. */
function buildResources(): void {
  program = makeProgram(gl, GLASS_VERT, GLASS_FRAG);
  u = uniformMap(gl, program, UNIFORMS);
  plane = buildPlane(gl, program);
  /* Three tiers of card content, best available per card. Footage is what
     the reference actually shows and what makes a card read as alive; the
     stills cover the seconds while clips buffer, and the procedural painters
     cover the frames before even those arrive. */
  videoBank?.dispose();
  const clips = VIDEO.sources.length > 0
    ? VIDEO.sources
    : VIDEO_POOL.map((src) => ({ src }));
  videoBank = VIDEO.enabled && clips.length > 0
    ? createVideoBank(gl, clips, VIDEO.hlsUrl)
    : null;
  imageBank?.dispose();
  imageBank = createImageBank(gl, IMAGE_POOL);
  sceneBank = createSceneBank(gl, { videos: videoBank, images: imageBank });
  labelTextures = uploadLabels(gl, labelCanvases);
  const env = generateEnvTexture(gl);
  envTexture = env.texture;
  const envScale = env.scale;
  const envSquare = env.square;
  /* The generators render into their own framebuffers at their own sizes and
     leave the viewport behind them. Without this the whole grid draws into a
     1024x512 corner of the canvas. */
  gl.viewport(0, 0, canvas.width, canvas.height);

  gl.useProgram(program);
  gl.uniform1i(u.uTex ?? null, 0);
  gl.uniform1i(u.uEnv ?? null, 1);
  /* Cover-fit is uploaded per card in the draw loop when a video is bound;
     these are the identity defaults the procedural scenes use. */
  gl.uniform2f(u.uCoverScale ?? null, 1, 1);
  gl.uniform2f(u.uCoverOffset ?? null, 0, 0);
  gl.uniform1f(u.uBevelPow ?? null, GLASS.bevelPower);
  gl.uniform1f(u.uBevelMaxSlope ?? null, GLASS.bevelMaxSlope);
  gl.uniform1f(u.uIor ?? null, GLASS.ior);
  gl.uniform1f(u.uRefractStrength ?? null, GLASS.refractStrength);
  gl.uniform1f(u.uDispersion ?? null, GLASS.dispersion);
  gl.uniform1f(u.uFresnelF0 ?? null, GLASS.fresnelF0);
  gl.uniform1f(u.uEnvIntensity ?? null, GLASS.envIntensity);
  gl.uniform1f(u.uEnvMaxMix ?? null, GLASS.envMaxMix);
  gl.uniform1f(u.uEnvRot ?? null, GLASS.envRotation);
  gl.uniform1f(u.uEnvRotX ?? null, GLASS.envRotationX);
  /* The multiplier that turns the stored environment back into HDR. Without
     it this uniform stays at its GL default of 0, the env sample is black,
     and the fresnel mix can only ever DARKEN the bevel - which is the
     difference between a lit slab and a flat sticker. */
  gl.uniform1f(u.uEnvScale ?? null, envScale);
  gl.uniform1f(u.uEnvSquare ?? null, envSquare);
  gl.uniform1f(u.uRimIntensity ?? null, GLASS.rimIntensity);
  gl.uniform3fv(u.uRimColor ?? null, GLASS.rimColor as unknown as number[]);
  gl.uniform3fv(u.uRimColorTop ?? null, GLASS.rimColorTop as unknown as number[]);
  gl.uniform3fv(u.uTint ?? null, GLASS.tint as unknown as number[]);
  gl.uniform1i(u.uSamples ?? null, DISPERSION_SAMPLES);

  const spectral = spectralWeights(DISPERSION_SAMPLES);
  gl.uniform3fv(u.uSW ?? null, spectral.weights);
  gl.uniform1fv(u.uSO ?? null, spectral.offsets);

  gl.disable(gl.DEPTH_TEST);
  /* The material is single-sided, matching the reference. Everything past the
     sphere's limb is dropped on the CPU anyway, so this only guards the few
     cards tilted hard enough to turn away mid-frame. */
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.enable(gl.BLEND);
  /* Straight alpha in, premultiplied out — which is exactly what a canvas
     declared premultipliedAlpha:true expects to composite over the page. */
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, envTexture);
  gl.activeTexture(gl.TEXTURE0);

  applyLayoutUniforms();
}

let viewW = 0;
let viewH = 0;
let cardOf: Int32Array | null = null;
let assignedCols = -1;
let assignedRows = -1;

function resize(): void {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  viewW = w;
  viewH = h;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  layout = computeLayout(w, h);
  /* The assignment is a pure function of the torus shape, so it only needs
     recomputing when the solver changes it. */
  if (cardOf === null || assignedCols !== layout.cols || assignedRows !== layout.rows) {
    assignedCols = layout.cols;
    assignedRows = layout.rows;
    cardOf = assignCards(layout.cols, layout.rows, CARDS.length);
  }
  if (program) applyLayoutUniforms();
}

/** Shader constants denominated in card pixels; they move when the card does. */
function applyLayoutUniforms(): void {
  gl.useProgram(program);
  gl.uniform2f(u.uPlaneSize ?? null, layout.planeW, layout.planeH);
  gl.uniform1f(u.uSphereR ?? null, layout.R);
  gl.uniform1f(u.uCornerR ?? null, GLASS.cornerRadius * layout.planeW);
  gl.uniform1f(u.uBevelW ?? null, GLASS.bevelWidth * layout.planeW);
  gl.uniform1f(u.uThickness ?? null, GLASS.thickness * layout.cardScale);
  gl.uniform1f(u.uRimWidth ?? null, GLASS.rimWidth * layout.cardScale);
}

/* ---- input ------------------------------------------------------------ */

/* Both axes. The layout is a flat TORUS bent onto a sphere, so it already
   wraps in y as well as x - the grid was one-directional only because nothing
   drove the second offset. Feeding a y offset through the same wrap gives
   free panning in any direction, diagonals included, with no extra meshes and
   no special case at the seam. It stays seamless because roundEven() forces
   an even row count: odd rows carry the half-cell brick stagger, so wrapping
   row 0 above row rows-1 only lines up when that count is even. */
const scrollX = new Spring(0, DRAG.spring);
const scrollY = new Spring(0, DRAG.spring);
/** Drag speed in px/s, smoothed, driving the camera dolly. */
const magnitude = new Spring(0, DRAG.magnitudeSpring);
/** Cell gap: starts scattered, springs closed. This is the whole intro. */
const gap = new Spring(reduced ? GRID.gapRatio : INTRO_GAP, INTRO_SPRING);
gap.target = GRID.gapRatio;

/** Pointer parallax, softer and heavier than the drag springs. */
const PARALLAX_SPRING = { stiffness: 80, damping: 18, mass: 0.8 };
const parallaxX = new Spring(0, PARALLAX_SPRING);
const parallaxY = new Spring(0, PARALLAX_SPRING);

let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let flingX = 0;
let flingY = 0;

window.addEventListener('pointermove', (e) => {
  if (reduced) return;
  parallaxX.target = clamp((e.clientX / window.innerWidth) * 2 - 1, -1, 1);
  parallaxY.target = clamp((e.clientY / window.innerHeight) * 2 - 1, -1, 1);
});

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  flingX = 0;
  flingY = 0;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPointerX;
  const dy = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  scrollX.target += dx * DRAG.multiplier;
  /* +dy here, and the row term subtracts it below: world y points up, screen
     y points down, so the two sign flips cancel and the grid tracks the
     finger instead of running away from it. */
  scrollY.target += dy * DRAG.multiplier;
  /* Exponential carry rather than a raw last-delta: a single 120Hz sample is
     mostly noise, and the release would fling on whichever frame happened to
     be last. */
  flingX = flingX * 0.7 + dx * 0.3;
  flingY = flingY * 0.7 + dy * 0.3;
});

function endDrag(e: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (reduced) return;
  /* Inertia as extra target distance, not as a velocity injection: the spring
     stays the only thing deciding how the grid gets there, so a fling lands
     with the same easing as a drag. */
  scrollX.target += flingX * DRAG.fling * 60;
  scrollY.target += flingY * DRAG.fling * 60;
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* Both trackpad axes map straight through, so a two-finger scroll pans the
   gallery exactly like a drag. Signs are negated relative to the drag: a
   wheel reports the direction the CONTENT should travel, a pointer reports
   the direction the HAND travelled. */
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    /* DOM_DELTA_LINE (1) and DOM_DELTA_PAGE (2) arrive from mouse wheels and
       some Firefox configurations in units that are not pixels; without this
       a single notch jumps the grid by a couple of cards. */
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    scrollX.target -= e.deltaX * unit * DRAG.multiplier * 0.6;
    scrollY.target -= e.deltaY * unit * DRAG.multiplier * 0.6;
  },
  { passive: false },
);

/* ---- frame ------------------------------------------------------------ */

const proj = new Float32Array(16);
const view = new Float32Array(16);
const model = new Float32Array(16);
const rot3 = new Float32Array(9);
const quat = new Float32Array(4);
const camLocal = new Float32Array(3);

const MAX_MESH = GRID.maxCols * GRID.maxRows;
const mPx = new Float32Array(MAX_MESH);
const mPy = new Float32Array(MAX_MESH);
const mPz = new Float32Array(MAX_MESH);
const mDx = new Float32Array(MAX_MESH);
const mDy = new Float32Array(MAX_MESH);
const mDz = new Float32Array(MAX_MESH);
const mDepth = new Float32Array(MAX_MESH);
const mCard = new Int32Array(MAX_MESH);
const order: number[] = [];

/* Which cards are on screen this frame. The repaint budget itself lives in
   the scene bank, which can tell a cheap pass from an expensive one. */
const cardSeen = new Int32Array(CARDS.length).fill(-1);
const visibleCards: number[] = [];
let frameId = 0;

/**
 * Drag speed to camera pull-back. The tanh saturates, so a hard fling dollies
 * out decisively but never launches the camera into the next county.
 */
function dollyFor(speed: number, maxZoomZ: number): number {
  if (maxZoomZ <= 0) return 0;
  const range = 3 * maxZoomZ;
  return range * Math.tanh((0.04 * speed) / range);
}

let running = true;
let lastTime = performance.now();

function frame(now: number): void {
  if (!running) return;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  frameId++;

  const g = gap.step(dt);
  const sx = scrollX.step(dt);
  const sy = scrollY.step(dt);
  /* The spring's own velocity is the honest measure of how fast the grid is
     moving: it covers the drag, the fling and the settle with one number,
     where a pointer-derived speed reads zero the instant a finger lifts. */
  /* Magnitude over both axes, so a purely vertical fling dollies the camera
     exactly as much as a horizontal one. */
  magnitude.target = Math.hypot(scrollX.v, scrollY.v);
  const speed = magnitude.step(dt);
  const px = parallaxX.step(dt);
  const py = parallaxY.step(dt);

  const { F, R, planeW, planeH, cols, rows, maxZoomZ } = layout;
  const cards = cardOf;
  if (!cards) return;

  /* Parallax orbits the camera on a sphere of radius F, always facing the
     grid's centre. Moving the camera rather than shifting the layers is what
     makes it real parallax: near cards separate from far ones because they
     genuinely are at different depths on the sphere. */
  const yaw = -0.05 * px;
  const pitch = 0.05 * py;
  const cosPitch = Math.cos(pitch);
  const camX = Math.sin(yaw) * cosPitch * F;
  const camY = Math.sin(pitch) * F;
  const camZ = Math.cos(yaw) * cosPitch * F + dollyFor(speed, maxZoomZ);

  const near = Math.max(1, F * 0.01);
  const far = Math.hypot(camX, camY, camZ) + 2 * R + planeW * 2;
  perspectiveMat(proj, 2 * Math.atan(viewH / 2 / F), viewW / viewH, near, far);
  lookAtOrigin(view, camX, camY, camZ);

  const cellW = planeW * (1 + g);
  const cellH = planeH * (1 + g);
  const periodX = cols * cellW;
  const periodY = rows * cellH;
  /* A point on the sphere faces the camera while its outward normal projects
     past R onto the camera offset. The half-diagonal keeps a card whose
     centre has just crossed, but whose near edge has not. */
  const limb = R - Math.hypot(planeW, planeH) * 0.5;
  const dCamX = camX;
  const dCamY = camY;
  const dCamZ = camZ + R;

  let count = 0;
  visibleCards.length = 0;

  for (let row = 0; row < rows; row++) {
    const stagger = (row & 1) * cellW * 0.5;
    for (let col = 0; col < cols; col++) {
      const x = wrap((col - (cols - 1) / 2) * cellW + sx + stagger, periodX);
      const y = wrap(-(row - (rows - 1) / 2) * cellH - sy, periodY);
      const ax = x / R;
      const ay = y / R;
      const cay = Math.cos(ay);
      const dx = Math.sin(ax) * cay;
      const dy = Math.sin(ay);
      const dz = Math.cos(ax) * cay;
      if (dx * dCamX + dy * dCamY + dz * dCamZ < limb) continue;

      const wx = dx * R;
      const wy = dy * R;
      const wz = dz * R - R;
      const depth = -(view[2] * wx + view[6] * wy + view[10] * wz + view[14]);
      if (depth <= near) continue;

      const vx = view[0] * wx + view[4] * wy + view[8] * wz + view[12];
      const vy = view[1] * wx + view[5] * wy + view[9] * wz + view[13];
      if (Math.abs(proj[0] * vx) > depth + proj[0] * planeW * 0.7) continue;
      if (Math.abs(proj[5] * vy) > depth + proj[5] * planeH * 0.7) continue;

      const card = cards[row * cols + col];
      mPx[count] = wx;
      mPy[count] = wy;
      mPz[count] = wz;
      mDx[count] = dx;
      mDy[count] = dy;
      mDz[count] = dz;
      mDepth[count] = depth;
      mCard[count] = card;
      count++;

      if (cardSeen[card] !== frameId) {
        cardSeen[card] = frameId;
        visibleCards.push(card);
      }
    }
  }

  /* Decoded video frames go up FIRST. The card pass reads these textures a
     few lines below, so uploading afterwards would show every clip one frame
     behind for no reason. */
  videoBank?.update();

  /* Hand the bank everything on screen and let it decide what to repaint:
     it knows which cards are cheap source blits and which are expensive
     painters, and only the painters need rationing. */
  if (visibleCards.length > 0) {
    sceneBank.render(visibleCards, now / 1000);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  order.length = count;
  for (let i = 0; i < count; i++) order[i] = i;
  order.sort((a, b) => mDepth[b] - mDepth[a]);

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);
  gl.bindVertexArray(plane.vao);
  gl.uniformMatrix4fv(u.uProj, false, proj);
  gl.uniformMatrix4fv(u.uView, false, view);

  const settled = clamp((INTRO_GAP - g) / (INTRO_GAP - GRID.gapRatio), 0, 1);
  const dollyNorm = maxZoomZ > 0 ? clamp(dollyFor(speed, maxZoomZ) / (3 * maxZoomZ), 0, 1) : 0;
  /* Type arrives late and steps back while the grid is moving fast: a label
     smearing past at fling speed is noise, not information. */
  const labelAlpha = settled * settled * settled * (1 - 0.7 * dollyNorm);

  for (let i = 0; i < count; i++) {
    const k = order[i];
    quatFromZ(quat, mDx[k], mDy[k], mDz[k]);
    composeTRS(model, rot3, mPx[k], mPy[k], mPz[k], quat, planeW, planeH, 1);
    rotateInverse(camLocal, rot3, camX - mPx[k], camY - mPy[k], camZ - mPz[k]);

    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniformMatrix3fv(u.uRot, false, rot3);
    gl.uniform3f(u.uCamLocal, camLocal[0] / planeW, camLocal[1] / planeH, camLocal[2]);

    const card = mCard[k];
    gl.uniform1i(u.uFlat, 0);
    gl.uniform1f(u.uOpacity, 1);

    /* Every card samples its own texture, whatever fed it. Cover-fit was
       handled upstream in the card pass, so these uniforms stay at identity
       and the refraction is never scaled by a source's aspect. */
    gl.bindTexture(gl.TEXTURE_2D, sceneBank.textures[card]);
    gl.drawElements(gl.TRIANGLES, plane.indexCount, gl.UNSIGNED_SHORT, 0);

    if (labelAlpha > 0.004) {
      gl.uniform1i(u.uFlat, 1);
      gl.uniform1f(u.uOpacity, labelAlpha);
      gl.bindTexture(gl.TEXTURE_2D, labelTextures[card]);
      gl.drawElements(gl.TRIANGLES, plane.indexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  gl.bindVertexArray(null);
  requestAnimationFrame(frame);
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  running = false;
});

canvas.addEventListener('webglcontextrestored', () => {
  /* The label canvases survive context loss, so a restore is a relink plus a
     re-upload and a repaint of the scene bank. Nothing the user waits for. */
  buildResources();
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(frame);
});

window.addEventListener('resize', resize);

resize();
buildResources();
requestAnimationFrame(frame);
