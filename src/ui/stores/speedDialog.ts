import { defineStore } from 'pinia'

/** Element to focus when the dialog closes, set by the opener before openFor. Not reactive. */
let opener: HTMLElement | null = null

export function setSpeedOpener(element: HTMLElement | null): void {
  opener = element
}

export function takeSpeedOpener(): HTMLElement | null {
  const element = opener
  opener = null
  return element
}

/** The speed dialog is bound to the clip it was opened for, so a selection change cannot retarget it. */
export const useSpeedDialogStore = defineStore('speedDialog', {
  state: () => ({
    isOpen: false,
    clipId: null as string | null
  }),
  actions: {
    openFor(clipId: string): void {
      this.clipId = clipId
      this.isOpen = true
    },
    close(): void {
      this.isOpen = false
      this.clipId = null
    }
  }
})
