<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import Sidebar from './components/Sidebar/Sidebar.vue'
import Workspace from './components/Workspace/Workspace.vue'
import Drawer from './components/Drawer/Drawer.vue'
import { useProvidersStore } from './stores/providers'
import { useLayoutStore } from './stores/layout'
import type { ViewLoadState } from '@shared/types'

const providers = useProvidersStore()
const layout = useLayoutStore()

function onKeydown(e: KeyboardEvent): void {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
    const idx = Number(e.key) - 1
    const target = providers.enabled[idx]
    if (target) {
      e.preventDefault()
      layout.activate(target.id)
    }
  }
}

onMounted(async () => {
  window.api.on.titleChanged((e) => providers.onTitleChanged(e.id, e.title, layout.activeId === e.id))
  window.api.on.activeChanged((e) => layout.onMainActiveChanged(e.id))
  window.api.on.loadStateChanged((e) => providers.onLoadStateChanged(e.id, e.state as ViewLoadState))
  window.addEventListener('keydown', onKeydown)
  await providers.load()
  await layout.restore()
  // 设置里被禁用的站点请出窗格(原在 providers.load 内,为悬浮窗复用解耦至此)
  layout.prunePanes()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app">
    <Sidebar />
    <Workspace />
    <Drawer />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  height: 100%;
  background: var(--bg);
}
</style>
