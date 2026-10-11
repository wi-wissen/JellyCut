/// <reference lib="webworker" />
import { ExportCancelled, ExportUnsupported, runExport, type ExportProgress, type ExportRequest, type ExportResult } from './exporter'
import { loadFonts, type FontSource } from './fontLoader'

export type WorkerIn =
  | { type: 'start'; request: ExportRequest; fonts: FontSource[] }
  | { type: 'cancel' }

export type WorkerOut =
  | { type: 'progress'; progress: ExportProgress }
  | { type: 'done'; result: ExportResult }
  | { type: 'error'; kind: 'cancelled' | 'unsupported' | 'failed'; message: string }

const controller = new AbortController()
const post = (message: WorkerOut): void => (self as unknown as Worker).postMessage(message)

self.onmessage = async (event: MessageEvent<WorkerIn>) => {
  const message = event.data
  if (message.type === 'cancel') {
    controller.abort()
    return
  }
  try {
    await loadFonts(message.fonts)
    const result = await runExport(message.request, (progress) => post({ type: 'progress', progress }), controller.signal)
    post({ type: 'done', result })
  } catch (error) {
    if (error instanceof ExportCancelled) post({ type: 'error', kind: 'cancelled', message: error.message })
    else if (error instanceof ExportUnsupported) post({ type: 'error', kind: 'unsupported', message: error.message })
    else post({ type: 'error', kind: 'failed', message: error instanceof Error ? error.message : String(error) })
  }
}
