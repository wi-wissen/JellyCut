/// <reference lib="webworker" />
import { ExportCancelled, ExportUnsupported, runExport, type ExportProgress, type ExportRequest, type ExportResult } from './exporter'
import { GifTooLarge, isGifRequest, runGifExport, type GifExportRequest, type GifResult } from './gifExporter'
import { loadFonts, type FontSource } from './fontLoader'
import type { ExportControl } from './exporter'

export type WorkerIn =
  | { type: 'start'; request: ExportRequest | GifExportRequest; fonts: FontSource[] }
  | { type: 'cancel' }
  | { type: 'hidden'; hidden: boolean }

export type WorkerOut =
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'done'; result: ExportResult | GifResult }
  | { type: 'error'; kind: 'cancelled' | 'unsupported' | 'too-large' | 'failed'; message: string }

const controller = new AbortController()
const control: ExportControl = { hidden: false }
const post = (message: WorkerOut): void => (self as unknown as Worker).postMessage(message)

self.onmessage = async (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  if (message.type === 'cancel') {
    controller.abort()
    return
  }
  if (message.type === 'hidden') {
    control.hidden = message.hidden
    return
  }
  try {
    await loadFonts(message.fonts)
    const onProgress = (progress: ExportProgress) => post({ type: 'progress', progress })
    const request = message.request
    const result = isGifRequest(request)
      ? await runGifExport(request, onProgress, controller.signal, control)
      : await runExport(request, onProgress, controller.signal, control)
    post({ type: 'done', result })
  } catch (error) {
    if (error instanceof ExportCancelled) post({ type: 'error', kind: 'cancelled', message: error.message })
    else if (error instanceof ExportUnsupported) post({ type: 'error', kind: 'unsupported', message: error.message })
    else if (error instanceof GifTooLarge) post({ type: 'error', kind: 'too-large', message: error.message })
    else post({ type: 'error', kind: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
}
