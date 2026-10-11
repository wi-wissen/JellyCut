// Exports real projects from the fixtures and checks the resulting MP4 frame by frame and in the audio.
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { existsSync, readdirSync } from 'node:fs'

function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'
  const direct = `${root}/chromium`
  if (existsSync(direct) && !existsSync(`${direct}/chrome-linux`)) return direct
  const dir = readdirSync(root).find((d) => d.startsWith('chromium-'))
  return `${root}/${dir}/chrome-linux/chrome`
}

const server = await createServer({ server: { port: 5190, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()))
await page.goto('http://localhost:5190/')

const r = await page.evaluate(async () => {
  const mod = (p) => import(p)
  const { runExport, ExportCancelled } = await mod('/src/engine/export/exporter.ts')
  const { probeFile } = await mod('/src/engine/media/probe.ts')
  const { assetFromProbe } = await mod('/src/core/timeline/insert.ts').catch(() => ({}))
  const { createProject } = await mod('/src/core/project/schema.ts')
  const { ExactFrameProvider } = await mod('/src/engine/media/frames.ts')
  const { frameStart } = await mod('/src/core/time.ts')
  const { ALL_FORMATS, Input, BlobSource, AudioSampleSink } = await mod('/tests/helpers/mediabunny.ts')

  const S = 1_000_000
  const load = async (name, type) => new File([await (await fetch(`/tests/fixtures/${name}`)).blob()], name, { type })
  const files = {
    frames: await load('frames.webm', 'video/webm'),
    clipa: await load('clip-a.webm', 'video/webm'),
    music: await load('music.webm', 'audio/webm')
  }
  const infos = {}
  for (const [id, f] of Object.entries(files)) infos[id] = await probeFile(f)
  const mkProject = (name) => {
    const p = createProject(name)
    for (const [id, info] of Object.entries(infos)) {
      p.assets.push({ id, kind: info.kind, name: info.name, relPath: info.name, size: info.size, duration: info.duration, width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio })
    }
    return p
  }
  const clip = (id, assetId, srcIn, srcOut, start, extra = {}) => ({
    id, track: 'video', assetId, srcIn, srcOut, start, speed: 1,
    transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false },
    volume: 1, muted: false, filter: null, transitionIn: null, ...extra
  })

  const bits = (canvas) => {
    const c = new OffscreenCanvas(canvas.width, canvas.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const sx = canvas.width / 160, sy = canvas.height / 90
    let n = 0
    for (let b = 0; b < 8; b++) {
      const d = ctx.getImageData(Math.round((b * 20 + 10) * sx), Math.round(45 * sy), 1, 1).data
      if (d[0] > 127) n |= 1 << b
    }
    return n
  }
  const goertzel = (samples, rate, freq) => {
    const w = (2 * Math.PI * freq) / rate
    const coeff = 2 * Math.cos(w)
    let s1 = 0, s2 = 0
    for (let i = 0; i < samples.length; i++) { const s = samples[i] + coeff * s1 - s2; s2 = s1; s1 = s }
    return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / (samples.length / 2)
  }
  const decodeAudio = async (blob, fromS, toS) => {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
    const track = await input.getPrimaryAudioTrack()
    if (!track) { input.dispose(); return null }
    const sink = new AudioSampleSink(track)
    const chunks = []
    let rate = 48000
    for await (const s of sink.samples(fromS, toS)) {
      const a = new Float32Array(s.numberOfFrames)
      s.copyTo(a, { planeIndex: 0, format: 'f32-planar' })
      chunks.push(a); rate = s.sampleRate; s.close()
    }
    input.dispose()
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const out = new Float32Array(total)
    let o = 0
    for (const c of chunks) { out.set(c, o); o += c.length }
    return { samples: out, rate }
  }
  const outputInfo = async (blob) => {
    const f = new File([blob], 'out.mp4', { type: 'video/mp4' })
    return probeFile(f)
  }
  const opts = { resolution: 480, fps: 30, quality: 'good', format: 'mp4' }
  const out = {}

  // 1) Video-only export of the frame-coded clip: every output frame must show the source frame with the same number.
  {
    const p = mkProject('frames')
    p.clips = [clip('c1', 'frames', 0, 3 * S, 0)]
    const progress = []
    const t0 = performance.now()
    const res = await runExport({ project: p, files, options: opts }, (pr) => progress.push(pr.fraction), new AbortController().signal)
    out.frames = { ms: Math.round(performance.now() - t0), codec: res.videoCodec, audio: res.audioCodec, frames: res.frames, size: res.blob.size }
    out.framesInfo = await outputInfo(res.blob)
    out.progressMonotonic = progress.every((v, i) => i === 0 || v >= progress[i - 1]) && progress.at(-1) === 1
    const provider = new ExactFrameProvider()
    provider.setFile('o', new File([res.blob], 'out.mp4'), false)
    out.frameCheck = []
    for (const n of [0, 1, 2, 14, 15, 16, 29, 30, 44, 60, 89]) {
      const f = await provider.getFrame('o', frameStart(n, 30))
      out.frameCheck.push([n, f ? bits(f) : null])
    }
    await provider.dispose()
  }

  // 2) Two clips with a fade transition: total length follows the planner, no frame is lost at the cut.
  {
    const p = mkProject('transition')
    p.clips = [clip('c1', 'frames', 0, 2 * S, 0), clip('c2', 'clipa', 0, 2 * S, 2 * S, { transitionIn: { type: 'fade', duration: S } })]
    const { planTimeline } = await mod('/src/core/render/scene.ts')
    out.plannedDuration = planTimeline(p).duration
    const res = await runExport({ project: p, files, options: opts }, () => undefined, new AbortController().signal)
    out.transitionInfo = await outputInfo(res.blob)
    out.transitionFrames = res.frames
    out.transitionAudio = res.audioCodec
  }

  // 3) Audio: the clip tone (440 Hz) plus music (330 Hz); a muted clip leaves only the music.
  {
    const p = mkProject('audio')
    p.clips = [clip('c1', 'clipa', 0, 4 * S, 0)]
    p.music = [{ id: 'm1', assetId: 'music', start: 0, srcIn: 0, srcOut: 4 * S, volume: 0.5, fadeIn: 0, fadeOut: 0 }]
    const res = await runExport({ project: p, files, options: opts }, () => undefined, new AbortController().signal)
    const a = await decodeAudio(res.blob, 1, 3)
    out.audio = a ? { f440: goertzel(a.samples, a.rate, 440), f330: goertzel(a.samples, a.rate, 330), f880: goertzel(a.samples, a.rate, 880), seconds: a.samples.length / a.rate } : null
    const edge = await decodeAudio(res.blob, 0, 0.02)
    out.audioStartPeak = edge ? Math.max(...edge.samples.map(Math.abs)) : null

    const q = mkProject('muted')
    q.clips = [clip('c1', 'clipa', 0, 4 * S, 0, { muted: true })]
    q.music = p.music
    const res2 = await runExport({ project: q, files, options: opts }, () => undefined, new AbortController().signal)
    const b = await decodeAudio(res2.blob, 1, 3)
    out.muted = b ? { f440: goertzel(b.samples, b.rate, 440), f330: goertzel(b.samples, b.rate, 330) } : null
  }

  // 4) Cancel in the middle: rejects with ExportCancelled and does not hang.
  {
    const p = mkProject('cancel')
    p.clips = [clip('c1', 'clipa', 0, 4 * S, 0)]
    const ac = new AbortController()
    let seen = 0
    const started = performance.now()
    try {
      await runExport({ project: p, files, options: opts }, (pr) => { seen++; if (pr.fraction > 0.3) ac.abort() }, ac.signal)
      out.cancel = 'resolved'
    } catch (e) {
      out.cancel = e instanceof ExportCancelled ? 'cancelled' : `other: ${e?.message}`
    }
    out.cancelMs = Math.round(performance.now() - started)
  }

  // 5) Empty project is refused with a clear error.
  {
    const p = mkProject('empty')
    try { await runExport({ project: p, files, options: opts }, () => undefined, new AbortController().signal); out.empty = 'resolved' } catch (e) { out.empty = e?.message }
  }
  return out
})

let failed = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + detail}`); if (!ok) failed++ }
const near = (a, b, tol) => Math.abs(a - b) <= tol

check('video export: 90 frames, 854x480, a real MP4 with video only', r.frames.frames === 90 && r.framesInfo.width === 854 && r.framesInfo.height === 480 && r.framesInfo.audioCodec === null && r.frames.size > 2000, JSON.stringify([r.frames, r.framesInfo]))
check('video export: duration is 3 s and fps about 30', near(r.framesInfo.duration, 3_000_000, 70_000) && near(r.framesInfo.fps, 30, 0.6), JSON.stringify(r.framesInfo))
check('video export: every sampled output frame equals the source frame number', r.frameCheck.every(([n, got]) => got === n), JSON.stringify(r.frameCheck))
check('progress is monotonic and ends at 100 %', r.progressMonotonic)
console.log(`INFO codec ${r.frames.codec}, ${r.frames.ms} ms for ${r.frames.frames} frames (${Math.round((r.frames.frames / r.frames.ms) * 1000)} fps)`)
check('transition: exported length follows the planner', near(r.transitionInfo.duration, r.plannedDuration, 80_000) && r.transitionFrames === Math.ceil((r.plannedDuration * 30) / 1_000_000), JSON.stringify([r.plannedDuration, r.transitionInfo.duration, r.transitionFrames]))
check('transition: audio track exists (second clip has sound)', r.transitionInfo.hasAudio && r.transitionAudio !== null, JSON.stringify(r.transitionInfo))
check('audio: both tones are present in the mix (440 Hz clip, 330 Hz music) and 880 Hz is not', r.audio && r.audio.f440 > 0.1 && r.audio.f330 > 0.05 && r.audio.f880 < 0.03, JSON.stringify(r.audio))
check('audio: starts without a click (fade-in at the very start)', r.audioStartPeak !== null && r.audioStartPeak < 0.2, String(r.audioStartPeak))
check('audio: a muted clip leaves only the music', r.muted && r.muted.f330 > 0.05 && r.muted.f440 < 0.02, JSON.stringify(r.muted))
check('cancel: rejects with ExportCancelled quickly', r.cancel === 'cancelled' && r.cancelMs < 15000, `${r.cancel} ${r.cancelMs} ms`)
check('empty project gives a clear error', typeof r.empty === 'string' && /empty/i.test(r.empty), String(r.empty))
check('no uncaught page errors', errors.length === 0, errors.join('; '))
await browser.close()
await server.close()
if (failed) { console.log(`${failed} CHECK(S) FAILED`); process.exit(1) }
console.log('ALL CHECKS PASSED')
