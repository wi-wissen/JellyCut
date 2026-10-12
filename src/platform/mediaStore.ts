/**
 * The browser's private copy of media that exists nowhere else: recordings and the generated example videos.
 * Bytes stay in this browser (IndexedDB blobs, which Firefox, Chromium and Safari all keep on disk); nothing is
 * uploaded. IndexedDB was chosen over the Origin Private File System because writing OPFS files is not available
 * on the main thread in every browser (Safari), while IndexedDB blobs work the same everywhere.
 */
import { MEDIA_STORE_NAME, openDb } from './localStore'
import type { StoredMediaInfo } from '../core/io/storedMedia'

export type PutResult = { ok: true } | { ok: false; reason: 'quota' | 'unavailable' }

export interface MediaStore {
  put(key: string, file: File): Promise<PutResult>
  /** The stored file, or null when this browser has no copy under that key. Never throws. */
  get(key: string): Promise<File | null>
  delete(key: string): Promise<void>
  list(): Promise<StoredMediaInfo[]>
}

/** A random key for a new stored copy. */
export function newStoreKey(): string {
  const bytes = new Uint8Array(12)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return `m-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

interface Row {
  blob: Blob
  name: string
  type: string
  lastModified: number
  size: number
  savedAt: number
}

function isQuota(error: unknown): boolean {
  const name = (error as { name?: string } | null | undefined)?.name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

type Outcome<T> = { ok: true; value: T } | { ok: false; quota: boolean }

async function transact<T>(mode: IDBTransactionMode, build: (store: IDBObjectStore) => IDBRequest<T>): Promise<Outcome<T>> {
  const db = await openDb().catch(() => null)
  if (!db) return { ok: false, quota: false }
  return new Promise<Outcome<T>>((resolve) => {
    try {
      const tx = db.transaction(MEDIA_STORE_NAME, mode)
      const request = build(tx.objectStore(MEDIA_STORE_NAME))
      // Committed, not just queued: only then is a copy durable.
      tx.oncomplete = () => resolve({ ok: true, value: request.result })
      tx.onerror = () => resolve({ ok: false, quota: isQuota(tx.error ?? request.error) })
      tx.onabort = () => resolve({ ok: false, quota: isQuota(tx.error ?? request.error) })
    } catch (e) {
      resolve({ ok: false, quota: isQuota(e) })
    }
  })
}

export function createIdbMediaStore(): MediaStore {
  return {
    async put(key, file) {
      const row: Row = { blob: file, name: file.name, type: file.type, lastModified: file.lastModified, size: file.size, savedAt: Date.now() }
      const out = await transact('readwrite', (store) => store.put(row, key))
      return out.ok ? { ok: true } : { ok: false, reason: out.quota ? 'quota' : 'unavailable' }
    },
    async get(key) {
      const out = await transact<Row | undefined>('readonly', (store) => store.get(key))
      if (!out.ok || !out.value || !(out.value.blob instanceof Blob)) return null
      const row = out.value
      return new File([row.blob], row.name, { type: row.type, lastModified: row.lastModified })
    },
    async delete(key) {
      await transact('readwrite', (store) => store.delete(key))
    },
    async list() {
      const out = await transact<Row[]>('readonly', (store) => store.getAll())
      const keys = await transact<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
      if (!out.ok || !keys.ok) return []
      return out.value.map((row, i) => ({ key: String(keys.value[i]), name: row.name, size: row.size, type: row.type, savedAt: row.savedAt }))
    }
  }
}

export interface MemoryMediaStoreOptions {
  /** Total bytes the fake accepts; a put beyond it fails with 'quota'. */
  quotaBytes?: number
  /** Makes every put fail like a browser without storage. */
  unavailable?: boolean
}

/** In-memory stand-in for tests; `options` can be changed while it is in use. */
export function createMemoryMediaStore(options: MemoryMediaStoreOptions = {}): MediaStore & { options: MemoryMediaStoreOptions; keys(): string[] } {
  const rows = new Map<string, { file: File; savedAt: number }>()
  const used = (except: string): number => [...rows].reduce((sum, [k, r]) => (k === except ? sum : sum + r.file.size), 0)
  return {
    options,
    keys: () => [...rows.keys()],
    async put(key, file) {
      if (options.unavailable) return { ok: false, reason: 'unavailable' }
      if (options.quotaBytes !== undefined && used(key) + file.size > options.quotaBytes) return { ok: false, reason: 'quota' }
      rows.set(key, { file, savedAt: Date.now() })
      return { ok: true }
    },
    async get(key) {
      return rows.get(key)?.file ?? null
    },
    async delete(key) {
      rows.delete(key)
    },
    async list() {
      return [...rows].map(([key, r]) => ({ key, name: r.file.name, size: r.file.size, type: r.file.type, savedAt: r.savedAt }))
    }
  }
}

const PERSIST_ASKED_KEY = 'jellycut.storage.persistAsked'

export type PersistState = 'granted' | 'denied' | 'unsupported'

/**
 * Asks the browser not to evict this site's storage. Asked once per browser: most browsers decide silently
 * (Firefox may show a small prompt); a refusal is remembered and never repeated.
 */
export async function requestPersistentStorage(): Promise<PersistState> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  if (!storage || typeof storage.persist !== 'function') return 'unsupported'
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'granted'
    let asked = false
    try {
      asked = localStorage.getItem(PERSIST_ASKED_KEY) === '1'
    } catch {
      // not remembered; asking again is harmless
    }
    if (asked) return 'denied'
    const granted = await storage.persist()
    try {
      localStorage.setItem(PERSIST_ASKED_KEY, '1')
    } catch {
      // see above
    }
    return granted ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}
