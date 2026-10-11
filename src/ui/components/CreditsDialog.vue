<script lang="ts">
import { defineComponent, nextTick } from 'vue'
import { mapActions, mapState } from 'pinia'
import { useEditorStore } from '../stores/editor'
import { useCreditsStore } from '../stores/credits'
import type { Asset } from '../../core/project/types'
import {
  CREDIT_MAX_LENGTH,
  LICENSES,
  assetsInUse,
  creditStatus,
  generateCreditsText,
  isHttpUrl,
  patchAssetCredit,
  type CreditLocale,
  type CreditStatus,
  type License
} from '../../core/credits/credits'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
const TITLE_ID = 'credits-dialog-title'
const PREVIEW_ID = 'credits-preview-label'
const STATUS_KEY: Record<CreditStatus, string> = { complete: 'complete', missing: 'missing', 'not-needed': 'notNeeded' }
const BADGE_CLASS: Record<CreditStatus, string> = {
  complete: 'bg-signal text-signal-fg',
  missing: 'border border-[var(--jc-danger)] bg-panel text-[var(--jc-danger)]',
  'not-needed': 'border border-line bg-panel text-muted'
}
const INPUT_CLASS = 'mt-1 block h-11 w-full min-w-0 rounded-lg border border-line bg-bg px-3 text-sm font-normal text-fg placeholder:text-muted'

type TextField = 'title' | 'author' | 'source'

export default defineComponent({
  name: 'CreditsDialog',
  data() {
    return {
      licenses: LICENSES,
      maxLength: CREDIT_MAX_LENGTH,
      titleId: TITLE_ID,
      previewId: PREVIEW_ID,
      inputClass: INPUT_CLASS,
      /** Link text that is not valid yet; it is shown but not stored. */
      urlDrafts: {} as Record<string, string>,
      urlErrors: {} as Record<string, boolean>,
      copyMessage: ''
    }
  },
  computed: {
    ...mapState(useEditorStore, ['project']),
    ...mapState(useCreditsStore, ['open', 'assetId', 'returnId']),
    locale(): CreditLocale {
      return this.$i18n.locale === 'de' ? 'de' : 'en'
    },
    assets(): Asset[] {
      return assetsInUse(this.project)
    },
    text(): string {
      return generateCreditsText(this.project, this.locale)
    },
    noneNeeded(): boolean {
      return this.assets.length > 0 && this.text === ''
    }
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) {
        this.copyMessage = ''
        void nextTick(() => this.focusStart())
        return
      }
      this.urlDrafts = {}
      this.urlErrors = {}
      this.endRenameStep()
      const target = this.returnId ? document.getElementById(this.returnId) : null
      void nextTick(() => target?.focus())
    }
  },
  mounted() {
    // Capture phase on window: Escape and Tab belong to the dialog while it is open. Typing is not intercepted.
    window.addEventListener('keydown', this.onWindowKeydown, true)
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.onWindowKeydown, true)
  },
  methods: {
    ...mapActions(useEditorStore, ['commitProject', 'endRenameStep']),
    ...mapActions(useCreditsStore, ['close']),
    panel(): HTMLElement | null {
      return (this.$refs.panel as HTMLElement | undefined) ?? null
    },
    focusables(): HTMLElement[] {
      return Array.from(this.panel()?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    },
    focusStart(): void {
      const panel = this.panel()
      if (!panel) return
      const target = this.assetId ? document.getElementById(`credit-title-${this.assetId}`) : null
      if (target) {
        target.scrollIntoView({ block: 'center' })
        target.focus()
        return
      }
      const first = this.focusables()[0]
      if (first) first.focus()
      else panel.focus()
    },
    statusLabel(asset: Asset): string {
      return this.$t(`credits.status.${STATUS_KEY[creditStatus(asset)]}`)
    },
    badgeClass(asset: Asset): string {
      return BADGE_CLASS[creditStatus(asset)]
    },
    kindLabel(asset: Asset): string {
      return this.$t(`credits.kinds.${asset.kind}`)
    },
    licenseName(license: License): string {
      if (license.id === 'own-work') return this.$t('credits.licenseOwn')
      if (license.id === 'other') return this.$t('credits.licenseOther')
      return license.name
    },
    textValue(asset: Asset, field: TextField): string {
      return asset.credit?.[field] ?? ''
    },
    urlValue(asset: Asset): string {
      return this.urlDrafts[asset.id] ?? asset.credit?.url ?? ''
    },
    /** One undo step per burst of typing: keyed commits with the same key are merged by the history. */
    setField(asset: Asset, field: TextField | 'url' | 'license', value: string, key?: string): void {
      this.commitProject(patchAssetCredit(this.project, asset.id, { [field]: value }), key)
    },
    onText(asset: Asset, field: TextField, event: Event): void {
      this.setField(asset, field, (event.target as HTMLInputElement).value, `credit:${asset.id}:${field}`)
    },
    onLicense(asset: Asset, event: Event): void {
      this.setField(asset, 'license', (event.target as HTMLSelectElement).value)
      this.endRenameStep()
    },
    onUrl(asset: Asset, event: Event): void {
      const value = (event.target as HTMLInputElement).value
      if (value !== '' && !isHttpUrl(value)) {
        this.urlDrafts[asset.id] = value
        this.urlErrors[asset.id] = true
        return
      }
      delete this.urlDrafts[asset.id]
      this.urlErrors[asset.id] = false
      this.setField(asset, 'url', value, `credit:${asset.id}:url`)
    },
    /** Leaving the link field drops an invalid entry, so the list shows what is stored. */
    onUrlChange(asset: Asset): void {
      this.endRenameStep()
      if (this.urlErrors[asset.id]) {
        delete this.urlDrafts[asset.id]
        this.urlErrors[asset.id] = false
      }
    },
    async copyText(): Promise<void> {
      const text = this.text
      if (!text) return
      let copied = false
      try {
        if (window.isSecureContext && navigator.clipboard) {
          await navigator.clipboard.writeText(text)
          copied = true
        }
      } catch {
        copied = false
      }
      if (!copied) copied = this.copyBySelection()
      this.copyMessage = copied ? this.$t('credits.copied') : this.$t('credits.copyFailed')
    },
    /** Fallback for browsers or contexts without the Clipboard API: select the text and let the browser copy it. */
    copyBySelection(): boolean {
      const area = this.$refs.preview as HTMLTextAreaElement | undefined
      if (!area) return false
      area.focus()
      area.select()
      try {
        return document.execCommand('copy')
      } catch {
        return false
      }
    },
    onBackdropClick(): void {
      this.close()
    },
    onWindowKeydown(event: KeyboardEvent): void {
      if (!this.open) return
      if (event.key === 'Escape') {
        // Stacked over the export dialog: Escape closes only this one, whatever the listener order.
        event.preventDefault()
        event.stopImmediatePropagation()
        this.close()
        return
      }
      if (event.key !== 'Tab') return
      const items = this.focusables()
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (!this.panel()?.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" @click.self="onBackdropClick">
      <div
        ref="panel"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="flex max-h-[calc(100dvh-24px)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-xl"
      >
        <header class="border-b border-line px-5 py-4">
          <h2 :id="titleId" class="text-base font-bold">{{ $t('credits.title') }}</h2>
          <p class="mt-1 text-xs text-muted">{{ $t('credits.intro') }}</p>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p v-if="assets.length === 0" class="text-sm text-muted">{{ $t('credits.empty') }}</p>

          <div v-else class="flex flex-col gap-3">
            <section
              v-for="asset in assets"
              :key="asset.id"
              :aria-label="asset.name"
              class="rounded-xl border border-line bg-panel2 p-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
                  {{ asset.name }}
                  <span class="text-xs font-normal text-muted">· {{ kindLabel(asset) }}</span>
                </h3>
                <span class="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold" :class="badgeClass(asset)">
                  {{ statusLabel(asset) }}
                </span>
              </div>

              <div class="mt-2 grid grid-cols-1 gap-x-3 gap-y-2.5 sm:grid-cols-2">
                <label class="block text-xs font-semibold text-muted">
                  {{ $t('credits.fields.title') }}
                  <input
                    :id="`credit-title-${asset.id}`"
                    type="text"
                    :maxlength="maxLength"
                    :class="inputClass"
                    :placeholder="$t('credits.hints.title')"
                    :value="textValue(asset, 'title')"
                    @input="onText(asset, 'title', $event)"
                    @change="endRenameStep"
                  />
                </label>
                <label class="block text-xs font-semibold text-muted">
                  {{ $t('credits.fields.author') }}
                  <input
                    type="text"
                    :maxlength="maxLength"
                    :class="inputClass"
                    :placeholder="$t('credits.hints.author')"
                    :value="textValue(asset, 'author')"
                    @input="onText(asset, 'author', $event)"
                    @change="endRenameStep"
                  />
                </label>
                <label class="block text-xs font-semibold text-muted">
                  {{ $t('credits.fields.source') }}
                  <input
                    type="text"
                    :maxlength="maxLength"
                    :class="inputClass"
                    :placeholder="$t('credits.hints.source')"
                    :value="textValue(asset, 'source')"
                    @input="onText(asset, 'source', $event)"
                    @change="endRenameStep"
                  />
                </label>
                <label class="block text-xs font-semibold text-muted">
                  {{ $t('credits.fields.url') }}
                  <input
                    type="url"
                    inputmode="url"
                    :maxlength="maxLength"
                    :class="inputClass"
                    :placeholder="$t('credits.hints.url')"
                    :value="urlValue(asset)"
                    :aria-invalid="urlErrors[asset.id] ? 'true' : 'false'"
                    :aria-describedby="urlErrors[asset.id] ? `credit-url-error-${asset.id}` : undefined"
                    @input="onUrl(asset, $event)"
                    @change="onUrlChange(asset)"
                  />
                </label>
                <p
                  v-if="urlErrors[asset.id]"
                  :id="`credit-url-error-${asset.id}`"
                  role="alert"
                  class="text-xs font-semibold text-[var(--jc-danger)] sm:col-span-2"
                >
                  {{ $t('credits.urlInvalid') }}
                </p>
                <label :for="`credit-licence-${asset.id}`" class="block text-xs font-semibold text-muted sm:col-span-2">
                  {{ $t('credits.fields.license') }}
                </label>
                <select
                  :id="`credit-licence-${asset.id}`"
                  :class="inputClass"
                  class="sm:col-span-2"
                  :value="asset.credit?.license ?? ''"
                  @change="onLicense(asset, $event)"
                >
                  <option value="">{{ $t('credits.chooseLicence') }}</option>
                  <option v-for="license in licenses" :key="license.id" :value="license.id">
                    {{ licenseName(license) }}
                  </option>
                </select>
              </div>
            </section>
          </div>

          <section v-if="assets.length > 0" class="mt-4 rounded-xl border border-line p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 :id="previewId" class="text-sm font-semibold">{{ $t('credits.preview') }}</h3>
              <button
                type="button"
                class="min-h-11 rounded-lg bg-fill px-4 text-sm font-semibold text-fill-fg hover:brightness-110 disabled:opacity-40"
                :disabled="text === ''"
                @click="copyText"
              >
                {{ $t('credits.copy') }}
              </button>
            </div>
            <textarea
              ref="preview"
              readonly
              rows="6"
              :aria-labelledby="previewId"
              :value="text"
              class="mt-2 block w-full resize-y rounded-lg border border-line bg-bg p-2 font-mono text-xs leading-relaxed text-fg"
            />
            <p v-if="noneNeeded" class="mt-2 text-xs text-muted">{{ $t('credits.noneNeeded') }}</p>
            <p v-else class="mt-2 text-xs text-muted">{{ $t('credits.previewHint') }}</p>
            <p role="status" aria-live="polite" class="mt-1 min-h-4 text-xs font-semibold text-txt">{{ copyMessage }}</p>
          </section>
        </div>

        <div class="flex justify-end border-t border-line px-5 py-3">
          <button type="button" class="min-h-11 rounded-lg px-4 text-sm font-semibold text-fg hover:bg-panel2" @click="close">
            {{ $t('credits.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
