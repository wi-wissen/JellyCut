// Registers the offline service worker (public/sw.js) and tells the page when a new build is waiting.
// The worker is passed as a URL relative to the page, so its scope is the deployed site root.

type Listener = () => void

const listeners = new Set<Listener>()
let waiting: ServiceWorker | null = null
let reloading = false

export function isUpdateReady(): boolean {
  return waiting !== null
}

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Activates the waiting worker; the page reloads once the new worker takes control. */
export function applyUpdate(): void {
  if (!waiting) return
  reloading = true
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

export function registerServiceWorker(swUrl: string): void {
  if (!('serviceWorker' in navigator)) return
  // A first install takes control without a reload; only an update that the user accepted reloads.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload()
  })
  navigator.serviceWorker
    .register(swUrl, { updateViaCache: 'none' })
    .then((registration) => {
      const hadController = navigator.serviceWorker.controller !== null
      const announce = (worker: ServiceWorker | null) => {
        if (!worker || !hadController) return
        waiting = worker
        listeners.forEach((listener) => listener())
      }
      announce(registration.waiting)
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') announce(registration.waiting)
        })
      })
    })
    .catch(() => undefined)
}
