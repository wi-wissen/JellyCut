import { VERTEX_QUAD } from './shaders'

/** A render target. The default framebuffer is represented with fbo and tex null. */
export interface Target {
  fbo: WebGLFramebuffer | null
  tex: WebGLTexture | null
  w: number
  h: number
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`shader compile failed: ${log}`)
  }
  return shader
}

export class Program {
  readonly program: WebGLProgram
  private readonly locations = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    fragmentSource: string,
    vertexSource: string = VERTEX_QUAD
  ) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    if (!program) throw new Error('createProgram failed')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`program link failed: ${log}`)
    }
    this.program = program
  }

  use(): void {
    this.gl.useProgram(this.program)
  }

  uniform(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) {
      this.locations.set(name, this.gl.getUniformLocation(this.program, name))
    }
    return this.locations.get(name) ?? null
  }

  delete(): void {
    this.gl.deleteProgram(this.program)
  }
}

export function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

/** Framebuffer with an RGBA8 colour texture of the given size. */
export function createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = createTexture(gl)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  const fbo = gl.createFramebuffer()
  if (!fbo) throw new Error('createFramebuffer failed')
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: ${status}`)
  return { fbo, tex, w, h }
}
