/**
 * Returns `<prefix><n>` with n one above the largest existing `<prefix><n>` id.
 * Ids that do not match the prefix pattern are ignored, so they never affect the result.
 */
export function nextId(existingIds: Iterable<string>, prefix = 'c'): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`)
  let max = 0
  for (const id of existingIds) {
    const match = pattern.exec(id)
    if (!match) continue
    const n = Number(match[1])
    if (Number.isSafeInteger(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

/**
 * Id source that also remembers what it issued, so two calls before a commit never
 * return the same id even if the caller's project does not contain it yet.
 */
export function createIdGenerator(prefix = 'c'): (existingIds: Iterable<string>) => string {
  const issued = new Set<string>()
  return (existingIds) => {
    const id = nextId([...existingIds, ...issued], prefix)
    issued.add(id)
    return id
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
