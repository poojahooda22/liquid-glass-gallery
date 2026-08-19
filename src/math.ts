/**
 * The small amount of linear algebra this scene needs, written out rather
 * than pulled from a matrix library: four functions, no allocation in the
 * frame loop, and every one of them readable next to the teardown it came
 * from.
 */

export const clamp = (v: number, a: number, b: number): number =>
  Math.min(b, Math.max(a, v));

/**
 * Fold a coordinate into [-period/2, period/2). This one line is the whole
 * "infinite" grid: the same 100 meshes are recycled around a flat torus, so
 * dragging forever costs nothing and nothing is ever created or destroyed.
 * The double modulo is deliberate - JavaScript's % keeps the sign of the
 * dividend, so a single one leaves negative coordinates on the wrong side.
 */
export const wrap = (v: number, period: number): number =>
  ((v + period / 2) % period + period) % period - period / 2;

export function perspectiveMat(
  out: Float32Array,
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/**
 * Quaternion rotating +Z onto a unit direction — three.js's
 * setFromUnitVectors with `from` fixed at (0,0,1), which is all this scene
 * ever asks for. cross((0,0,1), d) = (-d.y, d.x, 0) and dot = d.z, hence the
 * collapsed form. The w < epsilon branch catches the antipode, where the
 * rotation axis is undefined and any perpendicular axis is correct.
 */
export function quatFromZ(out: Float32Array, dx: number, dy: number, dz: number): Float32Array {
  let w = 1 + dz;
  let x = -dy;
  let y = dx;
  let z = 0;
  if (w < 1e-8) {
    w = 0;
    x = 1;
    y = 0;
    z = 0;
  }
  const n = 1 / Math.hypot(w, x, y, z);
  out[0] = x * n;
  out[1] = y * n;
  out[2] = z * n;
  out[3] = w * n;
  return out;
}

/** Column-major TRS compose, plus the bare rotation as a mat3 for the shader. */
export function composeTRS(
  out: Float32Array,
  rot3: Float32Array,
  px: number,
  py: number,
  pz: number,
  q: Float32Array,
  sx: number,
  sy: number,
  sz: number,
): void {
  const x = q[0]!;
  const y = q[1]!;
  const z = q[2]!;
  const w = q[3]!;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  const r0 = 1 - (yy + zz);
  const r1 = xy + wz;
  const r2 = xz - wy;
  const r3 = xy - wz;
  const r4 = 1 - (xx + zz);
  const r5 = yz + wx;
  const r6 = xz + wy;
  const r7 = yz - wx;
  const r8 = 1 - (xx + yy);

  out[0] = r0 * sx; out[1] = r1 * sx; out[2] = r2 * sx; out[3] = 0;
  out[4] = r3 * sy; out[5] = r4 * sy; out[6] = r5 * sy; out[7] = 0;
  out[8] = r6 * sz; out[9] = r7 * sz; out[10] = r8 * sz; out[11] = 0;
  out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;

  /* Rotation only. The fragment shader reflects the view vector in world
     space, and feeding it the full model matrix would bake the card's
     427x320 scale into the normal — the reflection would smear along the
     wider axis. Scale cancels out of a reflection; rotation does not. */
  rot3[0] = r0; rot3[1] = r1; rot3[2] = r2;
  rot3[3] = r3; rot3[4] = r4; rot3[5] = r5;
  rot3[6] = r6; rot3[7] = r7; rot3[8] = r8;
}

/**
 * Rotate a world-space vector INTO card space: R transposed, applied to
 * (dx,dy,dz). Used to place the camera in the card's own frame without
 * inverting a 4x4 per mesh per frame.
 */
export function rotateInverse(
  out: Float32Array,
  rot3: Float32Array,
  dx: number,
  dy: number,
  dz: number,
): void {
  out[0] = rot3[0]! * dx + rot3[1]! * dy + rot3[2]! * dz;
  out[1] = rot3[3]! * dx + rot3[4]! * dy + rot3[5]! * dz;
  out[2] = rot3[6]! * dx + rot3[7]! * dy + rot3[8]! * dz;
}

/**
 * View matrix for a camera at `eye` looking at the origin with +Y up.
 *
 * Needed because the camera no longer sits on the +Z axis: pointer parallax
 * walks it around a sphere of radius F while it keeps facing the grid's
 * centre, so the view is a real orientation rather than a translation.
 */
export function lookAtOrigin(out: Float32Array, ex: number, ey: number, ez: number): void {
  const zl = Math.hypot(ex, ey, ez) || 1;
  const zx = ex / zl;
  const zy = ey / zl;
  const zz = ez / zl;
  /* cross((0,1,0), z) collapses to (z.z, 0, -z.x). The degenerate case needs
     the camera directly overhead, which +/-0.05 rad of pitch cannot reach. */
  const xl = Math.hypot(zz, 0, -zx) || 1;
  const xx = zz / xl;
  const xy = 0;
  const xz = -zx / xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
}
