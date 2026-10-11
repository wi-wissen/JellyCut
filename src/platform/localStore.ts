/**
 * Key-value storage on raw IndexedDB. Every call resolves and never throws:
 * without IndexedDB (private mode, blocked site data) reads return null and
 * writes return false, so callers can fall back quietly.
 */
export const AUTOSAVE_KEY = 'autosave'

export interface AutosaveRecord {
  text: string
  savedAt: number
}

const DB_NAME = 'jellycut'
const STORE_NAME = 'kv'

type Outcome<T> = { ok: true; value: T } | { ok: false }

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      try {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
        request.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    }).then((db) => {
      // Do not cache a failed open forever; the next call retries.
      if (!db) dbPromise = null
      return db
    })
  }
  return dbPromise
}

function transact<T>(mode: IDBTransactionMode, build: (store: IDBObjectStore) => IDBRequest<T>): Promise<Outcome<T>> {
  return openDb()
    .then(
      (db) =>
        new Promise<Outcome<T>>((resolve) => {
          if (!db) {
            resolve({ ok: false })
            return
          }
          try {
            const tx = db.transaction(STORE_NAME, mode)
            const request = build(tx.objectStore(STORE_NAME))
            // Resolve on commit, so a write is only reported as stored once it is durable.
            tx.oncomplete = () => resolve({ ok: true, value: request.result })
            tx.onerror = () => resolve({ ok: false })
            tx.onabort = () => resolve({ ok: false })
          } catch {
            resolve({ ok: false })
          }
        })
    )
    .catch((): Outcome<T> => ({ ok: false }))
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const outcome = await transact<T | undefined>('readonly', (store) => store.get(key))
  return outcome.ok && outcome.value !== undefined ? outcome.value : null
}

/** Resolves true once the value is committed to IndexedDB. */
export async function kvSet(key: string, value: unknown): Promise<boolean> {
  const outcome = await transact('readwrite', (store) => store.put(value, key))
  return outcome.ok
}

export async function kvDelete(key: string): Promise<boolean> {
  const outcome = await transact('readwrite', (store) => store.delete(key))
  return outcome.ok
}
