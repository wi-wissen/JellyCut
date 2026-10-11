<script lang="ts">
import { defineComponent } from 'vue'
import { mapActions, mapState } from 'pinia'
import Icon from '../Icon.vue'
import ChoiceTile from './ChoiceTile.vue'
import { useEditorStore } from '../../stores/editor'
import { useMediaStore } from '../../stores/media'

/** Library images and videos as tiles. A tap puts the picture over the video at the playhead. */
export default defineComponent({
  name: 'PicturePanel',
  components: { Icon, ChoiceTile },
  computed: {
    ...mapState(useEditorStore, ['project']),
    ...mapState(useMediaStore, ['thumbnails']),
    /** Library images and videos can be placed as pictures; audio cannot. */
    pictureAssets() {
      return this.project.assets.filter((a) => a.kind !== 'audio')
    }
  },
  methods: {
    ...mapActions(useEditorStore, ['addMediaAtPlayhead']),
    thumbnailOf(id: string): string | undefined {
      return (this.thumbnails as Record<string, string | undefined>)[id]
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
    <h2 class="text-sm font-bold">{{ $t('tabs.picture') }}</h2>
    <p class="text-xs leading-relaxed text-muted">{{ $t('overlays2.pictureHint') }}</p>
    <p v-if="pictureAssets.length === 0" class="text-xs text-muted">{{ $t('overlays2.noPictures') }}</p>
    <div v-else class="grid grid-cols-2 gap-2.5" role="group" :aria-label="$t('tabs.picture')">
      <ChoiceTile
        v-for="asset in pictureAssets"
        :key="asset.id"
        :label="asset.name"
        aspect="aspect-video"
        :aria-label="$t('overlays2.addPicture', { name: asset.name })"
        @choose="addMediaAtPlayhead(asset.id)"
      >
        <img v-if="thumbnailOf(asset.id)" :src="thumbnailOf(asset.id)" alt="" class="absolute inset-0 size-full object-cover" />
        <span v-else class="absolute inset-0 flex items-center justify-center bg-panel2 text-muted" aria-hidden="true">
          <Icon name="picture" class="size-8" />
        </span>
      </ChoiceTile>
    </div>
  </div>
</template>
