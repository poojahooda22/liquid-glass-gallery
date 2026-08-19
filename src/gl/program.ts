/**
 * Shader compile/link with errors that actually name the problem.
 *
 * A silently-failing shader is the single most expensive bug class in WebGL:
 * the canvas goes black and nothing in the console explains why. Throwing
 * with the info log at the boundary turns a debugging session into a stack
 * trace.
 */

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader returned null (context lost?)');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown';
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    gl.deleteShader(shader);
    throw new Error(`${kind} shader failed to compile:\n${log}`);
  }
  return shader;
}

export function makeProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram returned null (context lost?)');
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  /* Shaders are reference-counted by the program; flagging them for delete
     here means they go away with it and nothing leaks on context loss. */
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown';
    gl.deleteProgram(program);
    throw new Error(`program failed to link:\n${log}`);
  }
  return program;
}

/** Resolve every uniform once at startup; getUniformLocation is not free. */
export function uniformMap(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): Record<string, WebGLUniformLocation | null> {
  const out: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}
