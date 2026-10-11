/**
 * GIF variable-width LZW. Output is the image data block: the minimum code size byte, the data in
 * sub-blocks of at most 255 bytes, and the zero terminator.
 */

const MAX_CODES = 4096
const MAX_CODE_SIZE = 12
const HASH_BITS = 14
const HASH_SIZE = 1 << HASH_BITS
const HASH_MASK = HASH_SIZE - 1
const SUB_BLOCK = 255

export function lzwEncode(indexes: Uint8Array, minCodeSize: number): Uint8Array {
  if (!Number.isInteger(minCodeSize) || minCodeSize < 2 || minCodeSize > 8) {
    throw new RangeError('The minimum code size must be an integer from 2 to 8')
  }
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  // Open addressing table from (prefix code, symbol) to code. keys[h] = -1 marks an empty slot.
  const keys = new Int32Array(HASH_SIZE)
  const codes = new Int16Array(HASH_SIZE)

  let data = new Uint8Array(Math.max(256, indexes.length >> 1))
  let length = 0
  let acc = 0
  let bits = 0
  let codeSize = minCodeSize + 1
  let nextCode = eoi + 1
  // A new code width applies to the code after the one that follows the entry that caused it.
  // The decoder adds each entry one code late, so the width must lag the same way.
  let growAfterNext = false

  const put = (code: number): void => {
    acc |= code << bits
    bits += codeSize
    while (bits >= 8) {
      if (length === data.length) {
        const bigger = new Uint8Array(data.length * 2)
        bigger.set(data)
        data = bigger
      }
      data[length++] = acc & 0xff
      acc >>>= 8
      bits -= 8
    }
  }

  const reset = (): void => {
    keys.fill(-1)
    codeSize = minCodeSize + 1
    nextCode = eoi + 1
    growAfterNext = false
  }

  reset()
  put(clear)
  if (indexes.length > 0) {
    let prefix = indexes[0]!
    for (let i = 1; i < indexes.length; i++) {
      const symbol = indexes[i]!
      const key = (prefix << 8) | symbol
      let h = Math.imul(key, 0x9e3779b1) >>> (32 - HASH_BITS)
      let found = -1
      for (;;) {
        const k = keys[h]!
        if (k === -1) break
        if (k === key) {
          found = codes[h]!
          break
        }
        h = (h + 1) & HASH_MASK
      }
      if (found >= 0) {
        prefix = found
        continue
      }
      put(prefix)
      if (growAfterNext) {
        codeSize++
        growAfterNext = false
      }
      if (nextCode === MAX_CODES) {
        put(clear)
        reset()
      } else {
        keys[h] = key
        codes[h] = nextCode
        nextCode++
        if (nextCode === 1 << codeSize && codeSize < MAX_CODE_SIZE) growAfterNext = true
      }
      prefix = symbol
    }
    put(prefix)
    if (growAfterNext) {
      codeSize++
      growAfterNext = false
    }
  }
  put(eoi)
  if (bits > 0) {
    if (length === data.length) {
      const bigger = new Uint8Array(data.length + 1)
      bigger.set(data)
      data = bigger
    }
    data[length++] = acc & 0xff
  }

  const blocks = Math.ceil(length / SUB_BLOCK)
  const out = new Uint8Array(1 + length + blocks + 1)
  out[0] = minCodeSize
  let o = 1
  for (let start = 0; start < length; start += SUB_BLOCK) {
    const size = Math.min(SUB_BLOCK, length - start)
    out[o++] = size
    out.set(data.subarray(start, start + size), o)
    o += size
  }
  out[o] = 0
  return out
}
