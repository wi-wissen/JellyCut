// Time limits for awaited steps. Browser APIs (decoders, recorders) can stall without ever rejecting.

export class TimeoutError extends Error {
  constructor(readonly label: string, readonly ms: number) {
    super(`${label} did not finish within ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Rejects with a TimeoutError when `promise` is still pending after `ms`. The underlying work is not
 * cancelled; its late result or error is ignored.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Like withTimeout, but resolves with `fallback` instead of rejecting (for optional steps such as thumbnails). */
export async function orFallback<T>(promise: Promise<T>, ms: number, label: string, fallback: T): Promise<T> {
  try {
    return await withTimeout(promise, ms, label)
  } catch {
    return fallback
  }
}
