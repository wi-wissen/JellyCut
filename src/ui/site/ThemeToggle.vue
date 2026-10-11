<script lang="ts">
import { defineComponent } from 'vue'
import { currentTheme, setSiteTheme, type SiteTheme } from './theme'

export default defineComponent({
  name: 'ThemeToggle',
  data() {
    return { theme: currentTheme() as SiteTheme }
  },
  computed: {
    label(): string {
      return this.theme === 'dark' ? this.$t('site.theme.toLight') : this.$t('site.theme.toDark')
    }
  },
  methods: {
    toggle(): void {
      this.theme = this.theme === 'dark' ? 'light' : 'dark'
      setSiteTheme(this.theme)
    }
  }
})
</script>

<template>
  <button
    type="button"
    class="inline-flex size-11 items-center justify-center rounded-full text-fg hover:bg-panel2"
    :aria-label="label"
    :title="label"
    @click="toggle"
  >
    <svg v-if="theme === 'dark'" viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
    <svg v-else viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
    </svg>
  </button>
</template>
