export interface FontSource {
  family: string
  weight: number
  url: string
}

/** Loads fonts into the current global scope (window or worker) so 2D canvas text can use them. */
export async function loadFonts(sources: readonly FontSource[]): Promise<void> {
  const set = (globalThis as unknown as { fonts?: FontFaceSet }).fonts
  if (!set) return
  await Promise.all(
    sources.map(async (source) => {
      try {
        const face = new FontFace(source.family, `url(${source.url})`, { weight: String(source.weight) })
        await face.load()
        set.add(face)
      } catch {
        // A missing font only changes how the text looks; the export must still succeed.
      }
    })
  )
}
