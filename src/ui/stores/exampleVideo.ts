import { defineStore } from 'pinia'
import { EXAMPLE_CLIPS } from '../../core/demo/example'
import { nextId } from '../../core/timeline/ids'
import { appendClip } from '../../core/timeline/insert'
import { projectIds } from '../../core/timeline/ops'
import { createExampleFiles, ExampleCancelled, ExampleUnsupported } from '../../engine/demo/exampleMedia'
import { useEditorStore } from './editor'
import { useMediaStore } from './media'

export type ExampleStatus = 'idle' | 'creating' | 'failed'

/** Not reactive: the controller only lives while one example is being encoded. */
let controller: AbortController | null = null

/** Generates the example clips in the browser, imports them as normal media and puts them on the timeline. */
export const useExampleVideoStore = defineStore('exampleVideo', {
  state: () => ({
    status: 'idle' as ExampleStatus,
    /** Share of the frames encoded so far, 0..1. */
    fraction: 0,
    /** i18n key of the message shown after a failure. */
    errorKey: null as string | null
  }),
  getters: {
    percent(state): number {
      return Math.round(state.fraction * 100)
    }
  },
  actions: {
    async create(): Promise<void> {
      if (this.status === 'creating') return
      const abort = new AbortController()
      controller = abort
      this.status = 'creating'
      this.fraction = 0
      this.errorKey = null
      try {
        const files = await createExampleFiles(EXAMPLE_CLIPS, {
          onProgress: (fraction) => {
            this.fraction = fraction
          },
          signal: abort.signal
        })
        await addToTimeline(files)
        this.status = 'idle'
      } catch (error) {
        if (error instanceof ExampleCancelled) {
          this.status = 'idle'
        } else {
          this.status = 'failed'
          this.errorKey = error instanceof ExampleUnsupported ? 'start.errors.noEncoder' : 'start.errors.failed'
        }
      } finally {
        if (controller === abort) controller = null
      }
    },
    abort(): void {
      controller?.abort()
    }
  }
})

/** Imports the files, then appends each ready video in the order it was generated. */
async function addToTimeline(files: File[]): Promise<void> {
  const editor = useEditorStore()
  const media = useMediaStore()
  const before = new Set(editor.project.assets.map((a) => a.id))
  await media.importFiles(files, [], { origin: 'example' })
  const added = editor.project.assets.filter((a) => !before.has(a.id) && a.kind === 'video' && media.statusOf(a.id) === 'ready')
  let project = editor.project
  for (const asset of added) {
    project = appendClip(project, asset.id, nextId(projectIds(project), 'clip-'))
  }
  if (project !== editor.project) editor.commitProject(project)
  // The generated clips exist nowhere else: keep them in this browser like recordings.
  await Promise.all(added.map((asset) => media.persistAsset(asset.id)))
}
