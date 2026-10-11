import { TRANSITION_TYPES } from '../../core/render/types'
import type { LayerTransition, OverlayLayer, Scene, TextLayer, VideoLayer } from '../../core/render/types'
import type { MediaOverlay, ProjectFormat, RegionOverlay, TextStyle, Transform } from '../../core/project/types'
import { rectCorners } from '../../core/render/layout'
import { DEFAULT_REGION_RADIUS } from '../../core/timeline/overlayCatalog'
import { isDrawnOverlay, overlayBox, regionBlurSigma, regionCellSize } from '../../core/render/overlayLayout'
import { isIdentity, type Grade } from '../../core/filters/filters'
import { FRAGMENT_BLUR, FRAGMENT_COPY, FRAGMENT_FRAME, FRAGMENT_GRADED_FRAME, FRAGMENT_MEDIA, FRAGMENT_MIX, FRAGMENT_REGION, FRAGMENT_TEXT } from './shaders'
import { Program, createTarget, createTexture, type Target } from './gl'
import { createCanvas, parseCssColor, rasterizeText, textPixelSize, type Rgb } from './text'
import { overlayRasterKey, rasterizeOverlay, type DrawnOverlay } from './overlays'
import { animatedSheetBitmap } from './stickerAnimations'
import { animatedSticker, sheetCell, type AnimatedSticker } from '../../core/render/stickerAnimations'

/** Anything texImage2D accepts that also reports its size. */
export type FrameSource = CanvasImageSource & { width?: number; height?: number }

const BLUR_DOWNSCALE = 8
/** Blur sigma as a fraction of the output height. */
const BLUR_SIGMA = 0.05
const BLUR_GAIN = 0.88
const MAX_BLUR_RADIUS = 64
const MAX_OUTPUT_SIDE = 8192
const TEXT_CACHE_LIMIT = 96
const OVERLAY_CACHE_LIMIT = 64
/** About 64 MB of RGBA textures for overlays. */
const OVERLAY_PIXEL_BUDGET = 16_000_000
/** Sprite sheets of animated stickers: about 48 MB of RGBA textures (a sheet is up to 896 x 896 pixels). */
const SHEET_PIXEL_BUDGET = 12_000_000

type Vec2 = readonly [number, number]
type Quad = readonly [Vec2, Vec2, Vec2, Vec2]

/** Clip-space corners TL, TR, BR, BL of the full output. */
const FULL_QUAD: Quad = [[-1, 1], [1, 1], [1, -1], [-1, -1]]
/** Texture coordinates for an upright texture (UNPACK_FLIP_Y and FBO sampling both use this). */
const UV_UPRIGHT: Quad = [[0, 1], [1, 1], [1, 0], [0, 0]]
const UV_MIRRORED: Quad = [[1, 1], [0, 1], [0, 0], [1, 0]]

interface FrameTexture {
  tex: WebGLTexture
  w: number
  h: number
}

interface Programs {
  frame: Program
  /** FRAGMENT_FRAME with a colour grade; only used for graded clips. */
  graded: Program
  copy: Program
  text: Program
  blur: Program
  mix: Program
  region: Program
  media: Program
}

interface BlurTargets {
  cover: Target
  tmp: Target
  out: Target
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeSide(value: unknown, fallback: number): number {
  return Math.min(MAX_OUTPUT_SIDE, Math.max(1, Math.round(finiteOr(value, fallback))))
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Reads the picture size of any supported source; null when it has no pixels yet. */
function sourceSize(source: FrameSource): { w: number; h: number } | null {
  try {
    const s = source as unknown as Record<string, unknown>
    if (typeof s.readyState === 'number' && s.readyState < 2) return null
    let w: unknown
    let h: unknown
    if ('videoWidth' in s) {
      w = s.videoWidth
      h = s.videoHeight
    } else if ('displayWidth' in s) {
      w = s.displayWidth
      h = s.displayHeight
    } else if ('naturalWidth' in s) {
      if (s.naturalWidth === 0) return null
      w = s.naturalWidth
      h = s.naturalHeight
    } else {
      w = s.width
      h = s.height
    }
    if (typeof w !== 'number' || typeof h !== 'number') return null
    if (!(w >= 1 && h >= 1) || !Number.isFinite(w) || !Number.isFinite(h)) return null
    return { w: Math.round(w), h: Math.round(h) }
  } catch {
    return null
  }
}

/** Texture rectangle [u0, u1, v0, v1] that covers a target of tw x th without distortion. */
function coverUv(fw: number, fh: number, tw: number, th: number): [number, number, number, number] {
  const frameAspect = fw / fh
  const targetAspect = tw / th
  if (frameAspect > targetAspect) {
    const w = targetAspect / frameAspect
    return [0.5 - w / 2, 0.5 + w / 2, 0, 1]
  }
  const h = frameAspect / targetAspect
  return [0, 1, 0.5 - h / 2, 0.5 + h / 2]
}

interface PictureTransform {
  fill: boolean
  scale: number
  x: number
  y: number
  radians: number
  flipX: boolean
}

function sanitizeTransform(t: Partial<Transform> | undefined): PictureTransform {
  const scale = finiteOr(t?.scale, 1)
  return {
    fill: t?.fit === 'fill',
    scale: scale > 0 ? Math.min(scale, 1000) : 1,
    x: finiteOr(t?.x, 0),
    y: finiteOr(t?.y, 0),
    radians: (finiteOr(t?.rotation, 0) * Math.PI) / 180,
    flipX: t?.flipX === true
  }
}

function transitionIndex(type: string): number {
  const index = (TRANSITION_TYPES as readonly string[]).indexOf(type)
  return index < 0 ? 0 : index
}

export class Compositor {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas
  private readonly gl: WebGL2RenderingContext
  private programs: Programs | null = null
  private vao: WebGLVertexArrayObject | null = null
  private vbo: WebGLBuffer | null = null
  /** 0 and 1: the two sides of a transition. 2 and 3: the picture while blur / pixelate regions are applied. */
  private pages: (Target | null)[] = [null, null, null, null]
  private blurTargets: BlurTargets | null = null
  private readonly frameTextures = new Map<string, FrameTexture>()
  /** Insertion order doubles as LRU order. */
  private readonly textTextures = new Map<string, FrameTexture>()
  private readonly overlayTextures = new Map<string, FrameTexture>()
  private overlayPixels = 0
  /** One texture per animated sticker's sprite sheet (insertion order is LRU order); uploaded once, a frame is a sub-rectangle. */
  private readonly sheetTextures = new Map<string, FrameTexture>()
  private sheetPixels = 0
  private explicitSize: { w: number; h: number } | null = null
  private outW = 1
  private outH = 1
  private lastError = 0
  private lost = false
  private disposed = false

  private readonly onContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault()
    this.lost = true
  }

  private readonly onContextRestored = (): void => {
    // The old GL objects are gone with the context; drop our references without deleting them.
    this.frameTextures.clear()
    this.textTextures.clear()
    this.overlayTextures.clear()
    this.overlayPixels = 0
    this.sheetTextures.clear()
    this.sheetPixels = 0
    this.pages = [null, null, null, null]
    this.blurTargets = null
    this.lost = false
    this.initGl()
  }

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true
    }) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    this.initGl()
    const target = canvas as unknown as EventTarget
    target.addEventListener('webglcontextlost', this.onContextLost)
    target.addEventListener('webglcontextrestored', this.onContextRestored)
  }

  /** Output size in pixels. Overrides the scene format until called again. */
  resize(width: number, height: number): void {
    if (this.disposed) return
    this.explicitSize = { w: sanitizeSide(width, this.outW), h: sanitizeSide(height, this.outH) }
    this.setOutputSize(this.explicitSize.w, this.explicitSize.h)
  }

  draw(scene: Scene, frames: ReadonlyMap<string, FrameSource>): void {
    const gl = this.gl
    if (this.disposed || this.lost || gl.isContextLost() || !this.programs) return

    const format = scene.format
    const w = this.explicitSize?.w ?? sanitizeSide(format.width, 1920)
    const h = this.explicitSize?.h ?? sanitizeSide(format.height, 1080)
    this.setOutputSize(w, h)

    const pictures = scene.overlays.filter((l) => l.item.kind === 'media').map((l) => l.item.id)
    this.pruneFrameTextures(new Set([...scene.videos.map((v) => v.clipId), ...pictures]))
    const screen: Target = { fbo: null, tex: null, w, h }
    // A region reads everything composed below it, so with any region the picture is built off screen first.
    const hasRegion = scene.overlays.some((l) => l.item.kind === 'region')
    const picture = hasRegion ? this.pageTarget(2) : screen
    const layers = scene.videos.slice(-2)
    const top = layers.at(-1)

    if (layers.length === 2 && layers[0] && layers[1] && (layers[0].transition || layers[1].transition)) {
      const [a, b] = layers
      const transition = (b.transition ?? a.transition) as LayerTransition
      const swap = a.transition?.role === 'to' || b.transition?.role === 'from'
      const from = swap ? b : a
      const to = swap ? a : b
      const pageA = this.pageTarget(0)
      const pageB = this.pageTarget(1)
      this.drawPage(pageA, from, format, frames.get(from.clipId))
      this.drawPage(pageB, to, format, frames.get(to.clipId))
      this.mix(picture, pageA, pageB, transitionIndex(transition.type), clamp01(finiteOr(transition.progress, 0)))
    } else if (top) {
      // A single layer, or two layers without a transition: the top layer alone.
      this.drawPage(picture, top, format, frames.get(top.clipId))
    } else {
      this.clear(picture, this.backgroundRgb(format))
    }

    this.drawOverlayStack(scene.overlays, picture, screen, frames)
    this.drawTexts(scene.texts, screen)
    this.lastError = this.readGlError()
  }

  /** Last draw's first GL error, 0 when clean. */
  lastGlError(): number {
    return this.lastError
  }

  /** RGBA of the last draw, top row first. */
  readPixels(): Uint8ClampedArray {
    const w = this.outW
    const h = this.outH
    const out = new Uint8ClampedArray(w * h * 4)
    const gl = this.gl
    if (this.disposed || this.lost || gl.isContextLost()) return out
    const raw = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    const row = w * 4
    for (let y = 0; y < h; y++) {
      out.set(raw.subarray((h - 1 - y) * row, (h - y) * row), y * row)
    }
    return out
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const target = this.canvas as unknown as EventTarget
    target.removeEventListener('webglcontextlost', this.onContextLost)
    target.removeEventListener('webglcontextrestored', this.onContextRestored)
    if (!this.lost && !this.gl.isContextLost()) {
      this.releaseOutputTargets()
      for (const entry of this.frameTextures.values()) this.gl.deleteTexture(entry.tex)
      for (const entry of this.textTextures.values()) this.gl.deleteTexture(entry.tex)
      for (const entry of this.overlayTextures.values()) this.gl.deleteTexture(entry.tex)
      for (const entry of this.sheetTextures.values()) this.gl.deleteTexture(entry.tex)
      if (this.programs) for (const p of Object.values(this.programs)) p.delete()
      if (this.vbo) this.gl.deleteBuffer(this.vbo)
      if (this.vao) this.gl.deleteVertexArray(this.vao)
    }
    this.frameTextures.clear()
    this.textTextures.clear()
    this.sheetTextures.clear()
    this.programs = null
    this.vbo = null
    this.vao = null
  }

  // --- setup ---

  private initGl(): void {
    const gl = this.gl
    this.programs = {
      frame: new Program(gl, FRAGMENT_FRAME),
      graded: new Program(gl, FRAGMENT_GRADED_FRAME),
      copy: new Program(gl, FRAGMENT_COPY),
      text: new Program(gl, FRAGMENT_TEXT),
      blur: new Program(gl, FRAGMENT_BLUR),
      mix: new Program(gl, FRAGMENT_MIX),
      region: new Program(gl, FRAGMENT_REGION),
      media: new Program(gl, FRAGMENT_MEDIA)
    }
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    this.vbo = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
  }

  private setOutputSize(w: number, h: number): void {
    if (w !== this.outW || h !== this.outH) {
      this.releaseOutputTargets()
      this.outW = w
      this.outH = h
    }
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
  }

  private get glAlive(): boolean {
    return !this.lost && !this.gl.isContextLost()
  }

  private releaseOutputTargets(): void {
    if (this.glAlive) {
      for (const page of this.pages) this.deleteTarget(page)
      if (this.blurTargets) {
        this.deleteTarget(this.blurTargets.cover)
        this.deleteTarget(this.blurTargets.tmp)
        this.deleteTarget(this.blurTargets.out)
      }
    }
    this.pages = [null, null, null, null]
    this.blurTargets = null
  }

  private deleteTarget(target: Target | null): void {
    if (!target) return
    if (target.tex) this.gl.deleteTexture(target.tex)
    if (target.fbo) this.gl.deleteFramebuffer(target.fbo)
  }

  private pruneFrameTextures(used: ReadonlySet<string>): void {
    for (const [clipId, entry] of this.frameTextures) {
      if (used.has(clipId)) continue
      if (this.glAlive) this.gl.deleteTexture(entry.tex)
      this.frameTextures.delete(clipId)
    }
  }

  private pageTarget(index: 0 | 1 | 2 | 3): Target {
    let page = this.pages[index]
    if (!page) {
      page = createTarget(this.gl, this.outW, this.outH)
      this.pages[index] = page
    }
    return page
  }

  private ensureBlurTargets(): BlurTargets {
    if (!this.blurTargets) {
      const w = Math.max(1, Math.round(this.outW / BLUR_DOWNSCALE))
      const h = Math.max(1, Math.round(this.outH / BLUR_DOWNSCALE))
      this.blurTargets = {
        cover: createTarget(this.gl, w, h),
        tmp: createTarget(this.gl, w, h),
        out: createTarget(this.gl, w, h)
      }
    }
    return this.blurTargets
  }

  // --- drawing primitives ---

  private bindTarget(target: Target): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    gl.viewport(0, 0, target.w, target.h)
  }

  private setBlend(on: boolean): void {
    const gl = this.gl
    if (on) {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    } else {
      gl.disable(gl.BLEND)
    }
  }

  private bindTexture(tex: WebGLTexture): void {
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex)
  }

  private clear(target: Target, [r, g, b]: Rgb): void {
    const gl = this.gl
    this.bindTarget(target)
    this.setBlend(false)
    gl.clearColor(r, g, b, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /** Draws a quad given clip-space corners (TL, TR, BR, BL) and matching texture coordinates. */
  private drawQuad(corners: Quad, uvs: Quad): void {
    const [c0, c1, c2, c3] = corners
    const [t0, t1, t2, t3] = uvs
    const verts = new Float32Array([
      c0[0], c0[1], t0[0], t0[1],
      c1[0], c1[1], t1[0], t1[1],
      c2[0], c2[1], t2[0], t2[1],
      c0[0], c0[1], t0[0], t0[1],
      c2[0], c2[1], t2[0], t2[1],
      c3[0], c3[1], t3[0], t3[1]
    ])
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private toClip(x: number, y: number, target: Target): Vec2 {
    return [(x / target.w) * 2 - 1, 1 - (y / target.h) * 2]
  }

  private uploadFrame(clipId: string, source: FrameSource): FrameTexture | null {
    const size = sourceSize(source)
    if (!size) return null
    const gl = this.gl
    let entry = this.frameTextures.get(clipId)
    if (!entry) {
      entry = { tex: createTexture(gl), w: 0, h: 0 }
      this.frameTextures.set(clipId, entry)
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    try {
      // SVG images are part of CanvasImageSource but WebGL rejects them; the caller only passes raster sources.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
    } catch {
      return null
    }
    entry.w = size.w
    entry.h = size.h
    return entry
  }

  private backgroundRgb(format: ProjectFormat): Rgb {
    const bg = format.background
    return bg?.type === 'color' ? parseCssColor(bg.color) : [0, 0, 0]
  }

  // --- pages ---

  private drawPage(target: Target, layer: VideoLayer, format: ProjectFormat, source: FrameSource | undefined): void {
    const frame = source ? this.uploadFrame(layer.clipId, source) : null
    const isColor = format.background?.type === 'color'
    this.clear(target, isColor ? this.backgroundRgb(format) : [0, 0, 0])
    if (!frame) return
    // Ungraded clips (and identity grades) take the plain path: no extra work.
    const grade = layer.grade && !isIdentity(layer.grade) ? layer.grade : null
    if (!isColor) this.drawBlurBackground(target, frame, grade)
    this.drawPicture(target, frame, sanitizeTransform(layer.transform), grade)
  }

  /** Binds the picture program, with the grade when there is one. Null when the compositor is not ready. */
  private useFrameProgram(grade: Grade | null): Program | null {
    const programs = this.programs
    if (!programs) return null
    if (!grade) {
      programs.frame.use()
      return programs.frame
    }
    const p = programs.graded
    const gl = this.gl
    p.use()
    const [r0, r1, r2] = [grade.matrix.slice(0, 3), grade.matrix.slice(3, 6), grade.matrix.slice(6, 9)]
    gl.uniform3f(p.uniform('u_row0'), r0[0]!, r0[1]!, r0[2]!)
    gl.uniform3f(p.uniform('u_row1'), r1[0]!, r1[1]!, r1[2]!)
    gl.uniform3f(p.uniform('u_row2'), r2[0]!, r2[1]!, r2[2]!)
    gl.uniform3f(p.uniform('u_offset'), grade.offset[0]!, grade.offset[1]!, grade.offset[2]!)
    return p
  }

  /** Cover copy at 1/8 size (graded, so the bars match the picture), blurred separably, dimmed, and stretched back up. */
  private drawBlurBackground(target: Target, frame: FrameTexture, grade: Grade | null): void {
    const blur = this.ensureBlurTargets()
    const p = this.programs
    if (!p || !this.useFrameProgram(grade)) return

    this.bindTarget(blur.cover)
    this.setBlend(false)
    this.bindTexture(frame.tex)
    const [u0, u1, v0, v1] = coverUv(frame.w, frame.h, blur.cover.w, blur.cover.h)
    this.drawQuad(FULL_QUAD, [[u0, v1], [u1, v1], [u1, v0], [u0, v0]])

    const sigmaPx = BLUR_SIGMA * target.h
    this.blurPass(blur.cover, blur.tmp, [1 / blur.cover.w, 0], (sigmaPx * blur.cover.w) / target.w, 1)
    this.blurPass(blur.tmp, blur.out, [0, 1 / blur.tmp.h], (sigmaPx * blur.tmp.h) / target.h, BLUR_GAIN)

    this.bindTarget(target)
    this.setBlend(true)
    p.copy.use()
    this.bindTexture(blur.out.tex!)
    this.drawQuad(FULL_QUAD, UV_UPRIGHT)
  }

  private blurPass(src: Target, dst: Target, step: readonly [number, number], sigma: number, gain: number): void {
    const p = this.programs?.blur
    if (!p) return
    const gl = this.gl
    const s = Math.max(0.5, sigma)
    const radius = Math.min(MAX_BLUR_RADIUS, Math.ceil(3 * s))
    this.bindTarget(dst)
    this.setBlend(false)
    p.use()
    this.bindTexture(src.tex!)
    gl.uniform2f(p.uniform('u_step'), step[0], step[1])
    gl.uniform1f(p.uniform('u_sigma'), s)
    gl.uniform1i(p.uniform('u_radius'), radius)
    gl.uniform1f(p.uniform('u_gain'), gain)
    this.drawQuad(FULL_QUAD, UV_UPRIGHT)
  }

  private drawPicture(target: Target, frame: FrameTexture, t: PictureTransform, grade: Grade | null): void {
    const p = this.useFrameProgram(grade)
    if (!p) return
    const base = t.fill
      ? Math.max(target.w / frame.w, target.h / frame.h)
      : Math.min(target.w / frame.w, target.h / frame.h)
    const hw = (frame.w * base * t.scale) / 2
    const hh = (frame.h * base * t.scale) / 2
    const cx = target.w / 2 + t.x * target.w
    const cy = target.h / 2 + t.y * target.h
    const cos = Math.cos(t.radians)
    const sin = Math.sin(t.radians)
    const at = (dx: number, dy: number): Vec2 =>
      this.toClip(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos, target)
    const corners: Quad = [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)]

    this.bindTarget(target)
    this.setBlend(true)
    this.bindTexture(frame.tex)
    this.drawQuad(corners, t.flipX ? UV_MIRRORED : UV_UPRIGHT)
  }

  // --- transitions ---

  private mix(target: Target, a: Target, b: Target, type: number, progress: number): void {
    const p = this.programs?.mix
    if (!p) return
    const gl = this.gl
    this.bindTarget(target)
    this.setBlend(false)
    p.use()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, a.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, b.tex)
    gl.uniform1i(p.uniform('u_a'), 0)
    gl.uniform1i(p.uniform('u_b'), 1)
    gl.uniform1i(p.uniform('u_type'), type)
    gl.uniform1f(p.uniform('u_p'), progress)
    gl.uniform2f(p.uniform('u_res'), target.w, target.h)
    this.drawQuad(FULL_QUAD, UV_UPRIGHT)
    gl.activeTexture(gl.TEXTURE0)
  }

  // --- overlays (stickers, shapes, strokes, pictures) and regions ---

  private drawOverlays(layers: readonly OverlayLayer[], target: Target, frames: ReadonlyMap<string, FrameSource>): void {
    const p = this.programs?.text
    if (!p || layers.length === 0) return
    const gl = this.gl
    this.bindTarget(target)
    this.setBlend(true)
    for (const layer of layers) {
      const item = layer.item
      if (item.kind === 'media') {
        this.drawMedia(layer, item, frames.get(item.id), target)
        continue
      }
      if (!isDrawnOverlay(item)) continue
      // An animated sticker draws one cell of its sheet; until the sheet is decoded (or when it cannot be loaded) the still picture is drawn.
      const cell = layer.frame !== undefined && item.kind === 'sticker' ? this.animatedCell(item.imageId, layer.frame) : null
      const texture = cell ? cell.texture : this.overlayTexture(item, target.h)
      if (!texture) continue
      const box = overlayBox(item, target.w, target.h, layer)
      const [a, b, c, d] = rectCorners(box)
      const corners: Quad = [this.toClip(a.x, a.y, target), this.toClip(b.x, b.y, target), this.toClip(c.x, c.y, target), this.toClip(d.x, d.y, target)]
      p.use()
      gl.uniform1f(p.uniform('u_alpha'), layer.alpha)
      this.bindTexture(texture.tex)
      this.drawQuad(corners, cell ? cell.uv : UV_UPRIGHT)
    }
  }

  /** Picture-in-picture: the frame cropped to the box, with rounded corners and a border. */
  private drawMedia(layer: OverlayLayer, item: MediaOverlay, source: FrameSource | undefined, target: Target): void {
    const p = this.programs?.media
    if (!p || !source) return
    const frame = this.uploadFrame(item.id, source)
    if (!frame) return
    const gl = this.gl
    const box = overlayBox(item, target.w, target.h, layer)
    const [a, b, c, d] = rectCorners(box)
    const corners: Quad = [this.toClip(a.x, a.y, target), this.toClip(b.x, b.y, target), this.toClip(c.x, c.y, target), this.toClip(d.x, d.y, target)]
    const [u0, u1, v0, v1] = coverUv(frame.w, frame.h, box.w, box.h)
    const [r, g, bl] = parseCssColor(item.borderColor)
    p.use()
    gl.uniform1f(p.uniform('u_alpha'), layer.alpha)
    gl.uniform2f(p.uniform('u_size'), box.w, box.h)
    gl.uniform1f(p.uniform('u_radius'), Math.min(Math.max(0, item.radius) * target.h, box.w / 2, box.h / 2))
    gl.uniform1f(p.uniform('u_border'), Math.max(0, item.border) * target.h)
    gl.uniform3f(p.uniform('u_border_color'), r, g, bl)
    gl.uniform4f(p.uniform('u_crop'), u0, v0, u1, v1)
    this.bindTexture(frame.tex)
    this.drawQuad(corners, UV_UPRIGHT)
  }

  /**
   * Draws the overlays back to front. Pictures, stickers, shapes and strokes are drawn onto the picture composed
   * so far; a region replaces its shape by the blurred / pixelated picture below it. The two off-screen pages
   * (2 and 3) swap roles after every region, so a region never reads the page it writes. The last region writes
   * to the screen, and what is above it is drawn on the screen directly.
   */
  private drawOverlayStack(layers: readonly OverlayLayer[], picture: Target, screen: Target, frames: ReadonlyMap<string, FrameSource>): void {
    let lastRegion = -1
    layers.forEach((layer, i) => {
      if (layer.item.kind === 'region') lastRegion = i
    })
    let current = picture
    let batch: OverlayLayer[] = []
    layers.forEach((layer, i) => {
      if (layer.item.kind !== 'region') {
        batch.push(layer)
        return
      }
      this.drawOverlays(batch, current, frames)
      batch = []
      const last = i === lastRegion
      const next = last ? screen : current === this.pageTarget(2) ? this.pageTarget(3) : this.pageTarget(2)
      this.regionPass(next, current, layer)
      current = next
    })
    this.drawOverlays(batch, current, frames)
  }

  private regionPass(target: Target, src: Target, layer: OverlayLayer): void {
    const p = this.programs?.region
    if (!p) return
    const gl = this.gl
    const item = layer.item as RegionOverlay
    const pixelate = item.effect === 'pixelate'
    const blurred = pixelate ? src : this.blurCopy(src, regionBlurSigma(item.strength, target.h))
    const box = overlayBox(item, target.w, target.h, layer)
    const rad = (box.rotationDeg * Math.PI) / 180

    this.bindTarget(target)
    this.setBlend(false)
    p.use()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src.tex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, blurred.tex)
    gl.uniform1i(p.uniform('u_src'), 0)
    gl.uniform1i(p.uniform('u_blur'), 1)
    gl.uniform2f(p.uniform('u_res'), target.w, target.h)
    gl.uniform2f(p.uniform('u_center'), box.cx, box.cy)
    gl.uniform2f(p.uniform('u_half'), box.w / 2, box.h / 2)
    gl.uniform2f(p.uniform('u_rot'), Math.cos(rad), Math.sin(rad))
    gl.uniform1i(p.uniform('u_ellipse'), item.shape === 'ellipse' ? 1 : 0)
    gl.uniform1i(p.uniform('u_pixelate'), pixelate ? 1 : 0)
    gl.uniform1f(p.uniform('u_cell'), Math.max(2, regionCellSize(item.strength, target.h)))
    const radius = item.shape === 'roundRect' ? (item.radius ?? DEFAULT_REGION_RADIUS) : 0
    gl.uniform1f(p.uniform('u_radius'), Math.min(Math.max(0, radius) * target.h, box.w / 2, box.h / 2))
    gl.uniform1f(p.uniform('u_alpha'), layer.alpha)
    this.drawQuad(FULL_QUAD, UV_UPRIGHT)
    // Nothing stays bound to the second unit, so a later draw into one of these pages cannot read it.
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
  }

  /** Blurred copy of a full-size picture, computed at 1/8 size like the background. */
  private blurCopy(src: Target, sigmaPx: number): Target {
    const blur = this.ensureBlurTargets()
    const p = this.programs?.copy
    if (!p) return blur.out
    this.bindTarget(blur.cover)
    this.setBlend(false)
    p.use()
    this.bindTexture(src.tex!)
    this.drawQuad(FULL_QUAD, UV_UPRIGHT)
    this.blurPass(blur.cover, blur.tmp, [1 / blur.cover.w, 0], (sigmaPx * blur.cover.w) / src.w, 1)
    this.blurPass(blur.tmp, blur.out, [0, 1 / blur.tmp.h], (sigmaPx * blur.tmp.h) / src.h, 1)
    return blur.out
  }

  /**
   * Texture and texture coordinates of one cell of an animated sticker's sheet, or null while the sheet is not
   * decoded. The coordinates are inset by half a texel so linear filtering never reads a neighbouring cell.
   */
  private animatedCell(imageId: string | undefined, frame: number): { texture: FrameTexture; uv: Quad } | null {
    const animation = animatedSticker(imageId)
    if (!animation || imageId === undefined) return null
    const texture = this.sheetTexture(imageId, animation)
    if (!texture) return null
    const { col, row } = sheetCell(animation, Math.min(Math.max(0, frame), animation.frames - 1))
    const x0 = col * animation.cell
    const y0 = row * animation.cell
    const u0 = (x0 + 0.5) / texture.w
    const u1 = (x0 + animation.cell - 0.5) / texture.w
    // The upload flips the image, so row 0 of the sheet is at v = 1.
    const vTop = 1 - (y0 + 0.5) / texture.h
    const vBottom = 1 - (y0 + animation.cell - 0.5) / texture.h
    return { texture, uv: [[u0, vTop], [u1, vTop], [u1, vBottom], [u0, vBottom]] }
  }

  private sheetTexture(id: string, animation: AnimatedSticker): FrameTexture | null {
    const hit = this.sheetTextures.get(id)
    if (hit) {
      this.sheetTextures.delete(id)
      this.sheetTextures.set(id, hit)
      return hit
    }
    const bitmap = animatedSheetBitmap(id)
    if (!bitmap) return null
    const gl = this.gl
    // Through a 2D canvas, like every overlay: the upload then premultiplies exactly as it does for the still pictures.
    const canvas = createCanvas(bitmap.width, bitmap.height)
    const ctx = (canvas as HTMLCanvasElement).getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const tex = createTexture(gl)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    const entry: FrameTexture = { tex, w: bitmap.width, h: bitmap.height }
    this.sheetTextures.set(id, entry)
    this.sheetPixels += entry.w * entry.h
    while (this.sheetTextures.size > 1 && this.sheetPixels > SHEET_PIXEL_BUDGET) {
      const oldest = this.sheetTextures.keys().next().value
      if (oldest === undefined || oldest === id) break
      const evicted = this.sheetTextures.get(oldest)
      if (evicted) {
        gl.deleteTexture(evicted.tex)
        this.sheetPixels -= evicted.w * evicted.h
      }
      this.sheetTextures.delete(oldest)
    }
    return entry
  }

  private overlayTexture(item: DrawnOverlay, outH: number): FrameTexture | null {
    const key = overlayRasterKey(item, outH)
    const hit = this.overlayTextures.get(key)
    if (hit) {
      this.overlayTextures.delete(key)
      this.overlayTextures.set(key, hit)
      return hit
    }
    const raster = rasterizeOverlay(item, outH)
    if (!raster) return null
    const gl = this.gl
    const tex = createTexture(gl)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster.canvas)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    const entry: FrameTexture = { tex, w: raster.width, h: raster.height }
    this.overlayTextures.set(key, entry)
    this.overlayPixels += entry.w * entry.h
    // A stroke's box can cover the whole picture, so the cache is limited by pixels as well as by count.
    while (this.overlayTextures.size > 1 && (this.overlayTextures.size > OVERLAY_CACHE_LIMIT || this.overlayPixels > OVERLAY_PIXEL_BUDGET)) {
      const oldest = this.overlayTextures.keys().next().value
      if (oldest === undefined) break
      const evicted = this.overlayTextures.get(oldest)
      if (evicted) {
        gl.deleteTexture(evicted.tex)
        this.overlayPixels -= evicted.w * evicted.h
      }
      this.overlayTextures.delete(oldest)
    }
    return entry
  }

  // --- text ---

  private drawTexts(texts: readonly TextLayer[], target: Target): void {
    const p = this.programs?.text
    if (!p || texts.length === 0) return
    const gl = this.gl
    this.bindTarget(target)
    this.setBlend(true)
    p.use()
    for (const layer of texts) {
      const texture = this.textTexture(layer.text, layer.style, textPixelSize(layer.style?.size, target.h))
      if (!texture) continue
      const scale = finiteOr(layer.scale, 1) > 0 ? finiteOr(layer.scale, 1) : 1
      const cx = finiteOr(layer.pos?.x, 0.5) * target.w + finiteOr(layer.offsetX, 0) * target.h
      const cy = (finiteOr(layer.pos?.y, 0.5) + finiteOr(layer.offsetY, 0)) * target.h
      const hw = (texture.w * scale) / 2
      const hh = (texture.h * scale) / 2
      const corners: Quad = [
        this.toClip(cx - hw, cy - hh, target),
        this.toClip(cx + hw, cy - hh, target),
        this.toClip(cx + hw, cy + hh, target),
        this.toClip(cx - hw, cy + hh, target)
      ]
      this.bindTexture(texture.tex)
      gl.uniform1f(p.uniform('u_alpha'), clamp01(finiteOr(layer.alpha, 1)))
      this.drawQuad(corners, UV_UPRIGHT)
    }
  }

  private textTexture(text: string, style: TextStyle, px: number): FrameTexture | null {
    if (text.length === 0) return null
    const key = JSON.stringify([text, style.font, px, style.color, style.outline])
    const hit = this.textTextures.get(key)
    if (hit) {
      this.textTextures.delete(key)
      this.textTextures.set(key, hit)
      return hit
    }
    const raster = rasterizeText(text, style, px)
    if (!raster) return null
    const gl = this.gl
    const tex = createTexture(gl)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    // Canvas pixels are premultiplied; upload them that way to avoid dark fringes.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster.canvas)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    const entry: FrameTexture = { tex, w: raster.width, h: raster.height }
    this.textTextures.set(key, entry)
    if (this.textTextures.size > TEXT_CACHE_LIMIT) {
      const oldest = this.textTextures.keys().next().value
      if (oldest !== undefined) {
        const evicted = this.textTextures.get(oldest)
        if (evicted) gl.deleteTexture(evicted.tex)
        this.textTextures.delete(oldest)
      }
    }
    return entry
  }

  private readGlError(): number {
    const gl = this.gl
    let first = 0
    for (let i = 0; i < 8; i++) {
      const err = gl.getError()
      if (err === gl.NO_ERROR) break
      if (first === 0) first = err
    }
    return first
  }
}
