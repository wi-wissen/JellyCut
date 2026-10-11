import { describe, expect, it } from 'vitest'
import { createProject } from '../project/schema'
import { validateProject } from '../project/schema'
import type { Asset, AssetCredit, Project } from '../project/types'
import {
  CREDIT_MAX_LENGTH,
  LICENSES,
  assetsInUse,
  assetsNeedingCredit,
  cleanText,
  creditLine,
  creditStatus,
  generateCreditsText,
  isHttpUrl,
  licenseById,
  patchAssetCredit
} from './credits'

function asset(id: string, kind: Asset['kind'] = 'video', credit?: AssetCredit): Asset {
  return { id, kind, name: `${id}.${kind === 'audio' ? 'mp3' : 'mp4'}`, relPath: `media/${id}`, size: 1, duration: 1_000_000, ...(credit ? { credit } : {}) }
}

/** A project where the given assets are used by a clip (video and image) or a music item (audio). */
function project(assets: Asset[], usedIds: string[] = assets.map((a) => a.id)): Project {
  const p = createProject('Test')
  p.assets = assets
  p.clips = assets
    .filter((a) => usedIds.includes(a.id) && a.kind !== 'audio')
    .map((a, i) => ({
      id: `clip-${i}`, track: 'video', assetId: a.id, srcIn: 0, srcOut: 1_000_000, start: i * 1_000_000, speed: 1,
      transform: { fit: 'fit', scale: 1, x: 0, y: 0, rotation: 0, flipX: false }, volume: 1, muted: false, filter: null, transitionIn: null
    }))
  p.music = assets
    .filter((a) => usedIds.includes(a.id) && a.kind === 'audio')
    .map((a, i) => ({ id: `music-${i}`, assetId: a.id, start: 0, srcIn: 0, srcOut: 1_000_000, volume: 1, fadeIn: 0, fadeOut: 0 }))
  return p
}

const CC_BY: AssetCredit = { title: 'Beach', author: 'Jane Doe', source: 'Pixabay', url: 'https://pixabay.com/photos/beach-1/', license: 'cc-by-4.0' }

describe('LICENSES', () => {
  it('has unique ids and the official licence links from the requirements', () => {
    expect(new Set(LICENSES.map((l) => l.id)).size).toBe(LICENSES.length)
    const urls = Object.fromEntries(LICENSES.map((l) => [l.name, l.url]))
    expect(urls['CC0 1.0']).toBe('https://creativecommons.org/publicdomain/zero/1.0/')
    expect(urls['CC BY 4.0']).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(urls['CC BY-SA 4.0']).toBe('https://creativecommons.org/licenses/by-sa/4.0/')
    expect(urls['Pixabay Content License']).toBe('https://pixabay.com/service/license-summary/')
    expect(urls['Pexels License']).toBe('https://www.pexels.com/license/')
    expect(urls['Unsplash License']).toBe('https://unsplash.com/license')
  })
  it('lists the licences that need no credit', () => {
    const free = LICENSES.filter((l) => !l.needsAttribution).map((l) => l.name).sort()
    expect(free).toEqual(['CC0 1.0', 'Own work', 'Public domain'])
  })
  it('every licence link is an https address', () => {
    for (const l of LICENSES) if (l.url) expect(isHttpUrl(l.url)).toBe(true)
  })
  it('licenseById finds entries and ignores unknown ids', () => {
    expect(licenseById('cc-by-4.0')?.name).toBe('CC BY 4.0')
    expect(licenseById('nope')).toBeUndefined()
    expect(licenseById(undefined)).toBeUndefined()
  })
})

describe('isHttpUrl', () => {
  it('accepts absolute http and https addresses', () => {
    expect(isHttpUrl('https://pixabay.com')).toBe(true)
    expect(isHttpUrl('http://example.org/a?b=c')).toBe(true)
    expect(isHttpUrl('HTTPS://Example.org')).toBe(true)
  })
  it('rejects everything else', () => {
    for (const value of ['', 'pixabay.com', 'www.pixabay.com', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x.org', 'https://', 'https:/x.org', ' https://x.org', 'https://x org', 42, null, undefined]) {
      expect(isHttpUrl(value)).toBe(false)
    }
  })
})

describe('cleanText', () => {
  it('replaces control characters by spaces, collapses whitespace and trims', () => {
    expect(cleanText('  Line one\nLine\ttwo\u0000end  ')).toBe('Line one Line two end')
    expect(cleanText('\u007Fa\u009Fb')).toBe('a b')
  })
  it('handles missing values', () => {
    expect(cleanText(undefined)).toBe('')
    expect(cleanText(null)).toBe('')
    expect(cleanText('   ')).toBe('')
  })
})

describe('assetsInUse', () => {
  it('returns assets used by clips or music, in project order, each once', () => {
    const p = project([asset('a'), asset('b'), asset('m', 'audio'), asset('unused')], ['m', 'a'])
    p.clips.push({ ...p.clips[0]!, id: 'again', start: 9_000_000 })
    expect(assetsInUse(p).map((a) => a.id)).toEqual(['a', 'm'])
  })
  it('is empty for an empty timeline', () => {
    expect(assetsInUse(project([asset('a')], []))).toEqual([])
  })
})

describe('assetsNeedingCredit', () => {
  it('returns used media whose licence needs credit, in project order', () => {
    const p = project([
      asset('a', 'video', { license: 'cc-by-4.0' }),
      asset('b', 'video', { license: 'own-work' }),
      asset('c', 'audio', { license: 'pixabay' }),
      asset('d', 'video', { license: 'cc-by-4.0' })
    ], ['a', 'b', 'c'])
    expect(assetsNeedingCredit(p).map((a) => a.id)).toEqual(['a', 'c'])
  })

  it('ignores unlicensed media, free licences and media not on the timeline', () => {
    const p = project([asset('a'), asset('b', 'video', { license: 'cc0-1.0' }), asset('c', 'video', { license: 'other' })], ['a', 'b'])
    expect(assetsNeedingCredit(p)).toEqual([])
  })

  it('counts a medium once when it is used twice', () => {
    const p = project([asset('a', 'video', { license: 'unsplash' })], ['a'])
    p.clips = [...p.clips, { ...p.clips[0]!, id: 'clip-copy', start: 2_000_000 }]
    expect(assetsNeedingCredit(p).map((a) => a.id)).toEqual(['a'])
  })
})

describe('creditStatus', () => {
  it('is missing without a licence', () => {
    expect(creditStatus(asset('a'))).toBe('missing')
    expect(creditStatus(asset('a', 'video', { title: 'x', author: 'y', source: 'z' }))).toBe('missing')
  })
  it('is missing for an unknown licence id', () => {
    expect(creditStatus(asset('a', 'video', { license: 'mystery', title: 'x', author: 'y', source: 'z' }))).toBe('missing')
  })
  it('is not-needed for own work, CC0 and public domain, whatever the details', () => {
    for (const license of ['own-work', 'cc0-1.0', 'public-domain']) {
      expect(creditStatus(asset('a', 'video', { license }))).toBe('not-needed')
    }
  })
  it('is complete for a licence that needs credit with title, author and source or link', () => {
    expect(creditStatus(asset('a', 'video', CC_BY))).toBe('complete')
    expect(creditStatus(asset('a', 'video', { title: 'x', author: 'y', source: 'Pixabay', license: 'cc-by-4.0' }))).toBe('complete')
    expect(creditStatus(asset('a', 'video', { title: 'x', author: 'y', url: 'https://x.org', license: 'other' }))).toBe('complete')
  })
  it('is missing when title, author or any source is absent or blank', () => {
    expect(creditStatus(asset('a', 'video', { ...CC_BY, title: '' }))).toBe('missing')
    expect(creditStatus(asset('a', 'video', { ...CC_BY, author: '   ' }))).toBe('missing')
    expect(creditStatus(asset('a', 'video', { title: 'x', author: 'y', license: 'cc-by-4.0' }))).toBe('missing')
  })
  it('treats the free licences as not needing details', () => {
    expect(creditStatus(asset('a', 'video', { license: 'pexels' }))).toBe('missing')
    expect(creditStatus(asset('a', 'video', { ...CC_BY, license: 'pexels' }))).toBe('complete')
  })
})

describe('creditLine', () => {
  it('writes the full TASL form in English', () => {
    expect(creditLine(asset('beach', 'video', CC_BY), 'en')).toBe(
      'Beach by Jane Doe, source: Pixabay (https://pixabay.com/photos/beach-1/), licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)'
    )
  })
  it('writes the German labels', () => {
    expect(creditLine(asset('beach', 'video', CC_BY), 'de')).toBe(
      'Beach von Jane Doe, Quelle: Pixabay (https://pixabay.com/photos/beach-1/), Lizenz: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)'
    )
  })
  it('uses the file name when there is no title', () => {
    expect(creditLine(asset('beach', 'video', { ...CC_BY, title: undefined }), 'en').startsWith('beach.mp4 by Jane Doe')).toBe(true)
  })
  it('leaves out missing parts without printing undefined', () => {
    const line = creditLine(asset('beach', 'video', { license: 'cc-by-sa-4.0' }), 'en')
    expect(line).toBe('beach.mp4, licence: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)')
    expect(line).not.toContain('undefined')
  })
  it('prints only the link when there is no source name, and only the source when there is no link', () => {
    expect(creditLine(asset('a', 'video', { title: 'T', author: 'A', url: 'https://x.org/y', license: 'cc-by-4.0' }), 'en')).toContain('source: https://x.org/y,')
    expect(creditLine(asset('a', 'video', { title: 'T', author: 'A', source: 'Pixabay', license: 'cc-by-4.0' }), 'en')).toContain('source: Pixabay,')
  })
  it('drops an invalid link instead of printing it', () => {
    const line = creditLine(asset('a', 'video', { title: 'T', author: 'A', url: 'javascript:alert(1)', license: 'cc-by-4.0' }), 'en')
    expect(line).not.toContain('javascript')
    expect(line).not.toContain('source:')
  })
  it('prints "Other" in the chosen language and no link when there is none', () => {
    expect(creditLine(asset('a', 'video', { title: 'T', author: 'A', source: 'S', license: 'other' }), 'en')).toMatch(/licence: Other$/)
    expect(creditLine(asset('a', 'video', { title: 'T', author: 'A', source: 'S', license: 'other' }), 'de')).toMatch(/Lizenz: Sonstige$/)
  })
  it('sanitises control characters in the fields', () => {
    const line = creditLine(asset('a', 'video', { title: 'Sun\nset', author: 'Jane\u0000Doe', source: 'Pix\tabay', license: 'cc-by-4.0' }), 'en')
    expect(line.startsWith('Sun set by Jane Doe, source: Pix abay, licence: CC BY 4.0')).toBe(true)
  })
})

describe('generateCreditsText', () => {
  it('is empty when nothing needs credit', () => {
    const p = project([asset('a', 'video', { license: 'own-work' }), asset('b', 'video', { license: 'cc0-1.0' }), asset('c', 'audio', { license: 'public-domain' })])
    expect(generateCreditsText(p, 'en')).toBe('')
    expect(generateCreditsText(project([]), 'de')).toBe('')
  })
  it('ignores media that is not used on the timeline', () => {
    const p = project([asset('a', 'video', CC_BY)], [])
    expect(generateCreditsText(p, 'en')).toBe('')
  })
  it('groups images and videos before music and ends with the Jelly Cut line', () => {
    const p = project([
      asset('m', 'audio', { title: 'Song', author: 'Band', source: 'Free Music Archive', license: 'cc-by-4.0' }),
      asset('v', 'video', CC_BY),
      asset('own', 'video', { license: 'own-work' })
    ])
    const text = generateCreditsText(p, 'en')
    expect(text).toBe(
      [
        'Images and videos',
        'Beach by Jane Doe, source: Pixabay (https://pixabay.com/photos/beach-1/), licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
        '',
        'Music',
        'Song by Band, source: Free Music Archive, licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
        '',
        'Edited with Jelly Cut'
      ].join('\n')
    )
  })
  it('omits a group without entries', () => {
    const text = generateCreditsText(project([asset('v', 'image', CC_BY)]), 'de')
    expect(text.startsWith('Bilder und Videos\n')).toBe(true)
    expect(text).not.toContain('Musik')
    expect(text.endsWith('\n\nBearbeitet mit Jelly Cut')).toBe(true)
  })
  it('includes media with a missing licence, with the details that exist', () => {
    const text = generateCreditsText(project([asset('v', 'video', { author: 'Jane' })]), 'en')
    expect(text).toContain('v.mp4 by Jane')
    expect(text).not.toContain('undefined')
  })
  it('never prints undefined or null for any combination of fields', () => {
    const values: (AssetCredit | undefined)[] = [undefined, {}, { title: '' }, { license: 'cc-by-4.0' }, { url: 'nope', license: 'pixabay' }, { author: 'A', license: 'other' }]
    for (const credit of values) {
      for (const locale of ['de', 'en'] as const) {
        const text = generateCreditsText(project([asset('v', 'video', credit)]), locale)
        expect(text).not.toMatch(/undefined|null/)
      }
    }
  })
})

describe('patchAssetCredit', () => {
  it('sets a field and keeps the others', () => {
    const p = project([asset('a', 'video', { title: 'Old' })])
    const next = patchAssetCredit(p, 'a', { author: 'Jane' })
    expect(next.assets[0]?.credit).toEqual({ title: 'Old', author: 'Jane' })
    expect(p.assets[0]?.credit).toEqual({ title: 'Old' })
  })
  it('keeps spaces while typing (no trimming in the store)', () => {
    const next = patchAssetCredit(project([asset('a')]), 'a', { title: 'Sun ' })
    expect(next.assets[0]?.credit?.title).toBe('Sun ')
  })
  it('removes a field when it is set to empty or null, and drops an empty credit', () => {
    const p = project([asset('a', 'video', { title: 'T' })])
    expect(patchAssetCredit(p, 'a', { title: '' }).assets[0]).not.toHaveProperty('credit')
    expect(patchAssetCredit(p, 'a', { title: null }).assets[0]).not.toHaveProperty('credit')
  })
  it('accepts a valid link and ignores an invalid one', () => {
    const p = project([asset('a')])
    expect(patchAssetCredit(p, 'a', { url: 'https://x.org' }).assets[0]?.credit?.url).toBe('https://x.org')
    expect(patchAssetCredit(p, 'a', { url: 'javascript:alert(1)' })).toBe(p)
  })
  it('cuts text to the maximum length', () => {
    const next = patchAssetCredit(project([asset('a')]), 'a', { title: 'x'.repeat(CREDIT_MAX_LENGTH + 20) })
    expect(next.assets[0]?.credit?.title).toHaveLength(CREDIT_MAX_LENGTH)
  })
  it('returns the same project when nothing changes or the asset is unknown', () => {
    const p = project([asset('a', 'video', { title: 'T' })])
    expect(patchAssetCredit(p, 'a', { title: 'T' })).toBe(p)
    expect(patchAssetCredit(p, 'a', { author: undefined })).toBe(p)
    expect(patchAssetCredit(p, 'missing', { title: 'x' })).toBe(p)
  })
  it('does not touch other assets', () => {
    const p = project([asset('a'), asset('b', 'video', { title: 'B' })])
    const next = patchAssetCredit(p, 'a', { title: 'A' })
    expect(next.assets[1]).toBe(p.assets[1])
  })
  it('produces projects that pass schema validation', () => {
    let p = project([asset('a', 'video', CC_BY)])
    p = patchAssetCredit(p, 'a', { source: 'Pexels', url: 'https://www.pexels.com', license: 'pexels' })
    expect(validateProject(p).ok).toBe(true)
  })
})
