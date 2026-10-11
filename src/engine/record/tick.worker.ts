/// <reference lib="webworker" />
// Timer in a worker: timers on the page are throttled to about 1 Hz while the user shares another window and
// this tab is in the background; a dedicated worker's timer is not.
export type TickIn = { type: 'start'; intervalMs: number } | { type: 'stop' }

let timer: ReturnType<typeof setInterval> | null = null

self.onmessage = (event: MessageEvent<TickIn>) => {
  if (timer !== null) clearInterval(timer)
  timer = null
  if (event.data.type === 'start') {
    timer = setInterval(() => (self as unknown as Worker).postMessage(0), event.data.intervalMs)
  }
}
