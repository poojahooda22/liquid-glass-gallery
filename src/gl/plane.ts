/**
 * A unit plane subdivided 16x12, matching the reference's PlaneGeometry.
 *
 * The subdivision is not decoration. The vertex stage displaces every vertex
 * by the spherical dish, and a 1x1 quad has no interior vertices to displace
 * — the sag would collapse to a linear interpolation across two triangles
 * and each card would show a hard crease along its diagonal. 16x12 is the
 * point where the curvature reads as smooth at card size.
 */

export type Plane = { vao: WebGLVertexArrayObject; indexCount: number };

export function buildPlane(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  segX = 16,
  segY = 12,
): Plane {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= segY; y++) {
    for (let x = 0; x <= segX; x++) {
      positions.push(x / segX - 0.5, y / segY - 0.5, 0);
      uvs.push(x / segX, y / segY);
    }
  }
  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const a = y * (segX + 1) + x;
      const b = a + 1;
      const c = a + segX + 1;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const vao = gl.createVertexArray();
  if (!vao) throw new Error('createVertexArray returned null');
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  const locPos = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  const locUv = gl.getAttribLocation(program, 'uv');
  gl.enableVertexAttribArray(locUv);
  gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  return { vao, indexCount: indices.length };
}

/**
 * Spectral tap weights: triangle kernels centred at R=0, G=0.5, B=1 across
 * the sample range, each channel normalised so its weights sum to 1.
 *
 * Normalising per channel rather than globally is what keeps the card's
 * colour neutral. Without it the middle taps dominate green and the whole
 * grid takes on a cast that looks like a white-balance bug.
 */
export function spectralWeights(n: number): { weights: Float32Array; offsets: Float32Array } {
  const tri = (x: number, c: number) => Math.max(0, 1 - Math.abs(x - c) / 0.5);
  const weights = new Float32Array(15);
  const offsets = new Float32Array(5);
  const sum = [0, 0, 0];
  const raw: number[][] = [];

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = [tri(t, 0), tri(t, 0.5), tri(t, 1)];
    sum[0] += a[0]!;
    sum[1] += a[1]!;
    sum[2] += a[2]!;
    raw.push(a);
    offsets[i] = t - 0.5;
  }
  for (let i = 0; i < n; i++) {
    weights[i * 3] = raw[i]![0]! / sum[0]!;
    weights[i * 3 + 1] = raw[i]![1]! / sum[1]!;
    weights[i * 3 + 2] = raw[i]![2]! / sum[2]!;
  }
  return { weights, offsets };
}
