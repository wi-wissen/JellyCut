import { ExportCancelled, ExportUnsupported, runExport, type ExportProgress, type ExportRequest, type ExportResult } from './exporter'
import { loadFonts, type FontSource } from './fontLoader'
import type { WorkerIn, WorkerOut } from './export.worker'

export interface RunningExport {
  promise: Promise<ExportResult>
  cancel(): void
  /** True when the export runs in a worker and therefore keeps going in a background tab. */
  inWorker: boolean
}

export function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

/**
 * Starts an export in a worker (so the page stays responsive and a hidden tab is not throttled).
 * Falls back to the main thread where workers or OffscreenCanvas are missing.
 */
export function startExport(
  request: ExportRequest,
  fonts: FontSource[],
  onProgress: (p: ExportProgress) => void
): RunningExport {
  if (!canUseWorker()) {
    const controller = new AbortController()
    const promise = loadFonts(fonts).then(() => runExport(request, onProgress, controller.signal))
    return { promise, cancel: () => controller.abort(), inWorker: false }
  }

  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' })
  const promise = new Promise<ExportResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress(message.progress)
        return
      }
      worker.terminate()
      if (message.type === 'done') resolve(message.result)
      else if (message.kind === 'cancelled') reject(new ExportCancelled())
      else if (message.kind === 'unsupported') reject(new ExportUnsupported(message.message))
      else reject(new Error(message.message))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'The export worker crashed.'))
    }
    const start: WorkerIn = { type: 'start', request, fonts }
    worker.postMessage(start)
  })
  return {
    promise,
    inWorker: true,
    cancel: () => worker.postMessage({ type: 'cancel' } satisfies WorkerIn)
  }
}
