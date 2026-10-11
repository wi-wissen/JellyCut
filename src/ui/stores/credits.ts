import { defineStore } from 'pinia'

/**
 * Open state of the credits dialog. The dialog is mounted once (in the project menu); callers only
 * say what to show and where focus returns when it closes.
 */
export const useCreditsStore = defineStore('credits', {
  state: () => ({
    open: false,
    /** Medium to scroll to, or null for the whole list. */
    assetId: null as string | null,
    /** Element id that receives focus when the dialog closes. */
    returnId: null as string | null
  }),
  actions: {
    show(options: { assetId?: string | null; returnId?: string | null } = {}) {
      this.open = true
      this.assetId = options.assetId ?? null
      this.returnId = options.returnId ?? null
    },
    close() {
      this.open = false
    }
  }
})
