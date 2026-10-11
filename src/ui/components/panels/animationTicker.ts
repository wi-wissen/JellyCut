/** One animation frame loop for every animated tile on screen; it stops when the last tile goes. */
type Tick = (nowMs: number) => void

const subscribers = new Set<Tick>()
let handle = 0

function loop(now: number): void {
  handle = 0
  if (subscribers.size === 0) return
  for (const tick of [...subscribers]) tick(now)
  handle = requestAnimationFrame(loop)
}

export function subscribeToTicks(tick: Tick): () => void {
  subscribers.add(tick)
  if (handle === 0) handle = requestAnimationFrame(loop)
  return () => {
    subscribers.delete(tick)
  }
}
