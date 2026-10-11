export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface AutosaveOptions<T> {
  delayMs: number
  save: (value: T) => Promise<void>
  onError?: (e: unknown) => void
  onStatus?: (s: AutosaveStatus) => void
}

export interface Autosaver<T> {
  notify(value: T): void
  flush(): Promise<void>
  dispose(): void
  status(): AutosaveStatus
}

export function createAutosaver<T>(options: AutosaveOptions<T>): Autosaver<T> {
  let currentStatus: AutosaveStatus = 'idle'
  let pending = false
  let pendingValue: T | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let disposed = false

  function setStatus(s: AutosaveStatus): void {
    if (s === currentStatus) return
    currentStatus = s
    options.onStatus?.(s)
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function loop(): Promise<void> {
    while (pending && !disposed) {
      const value = pendingValue as T
      pending = false
      setStatus('saving')
      try {
        await options.save(value)
      } catch (e) {
        // A newer notify may already have replaced the value; keep that one.
        if (!pending) {
          pending = true
          pendingValue = value
        }
        setStatus('error')
        options.onError?.(e)
        return
      }
      setStatus(pending ? 'dirty' : 'saved')
      // While a timer is armed, its callback starts the next save after the debounce.
      if (timer !== null) return
    }
  }

  function pump(): Promise<void> {
    if (!running) {
      running = loop().finally(() => {
        running = null
      })
    }
    return running
  }

  return {
    notify(value: T): void {
      if (disposed) return
      pendingValue = value
      pending = true
      if (currentStatus !== 'saving') setStatus('dirty')
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        void pump()
      }, options.delayMs)
    },

    async flush(): Promise<void> {
      clearTimer()
      while (running) await running
      if (pending && !disposed) {
        clearTimer()
        await pump()
      }
    },

    dispose(): void {
      disposed = true
      pending = false
      clearTimer()
    },

    status(): AutosaveStatus {
      return currentStatus
    }
  }
}
