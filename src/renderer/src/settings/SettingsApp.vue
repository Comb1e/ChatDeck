<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import PromptPanel from '../components/Prompts/PromptPanel.vue'
import PromptEditor from '../components/Prompts/PromptEditor.vue'
import PromptFill from '../components/Prompts/PromptFill.vue'
import SettingsPanel from '../components/Settings/SettingsPanel.vue'

const ui = useUiStore()

/** 提示词库标签:覆盖列表/编辑/填空三个子视图 */
const onPrompts = computed(() => ui.view === 'prompts' || ui.view === 'editor' || ui.view === 'fill')

const title = computed(() => {
  switch (ui.view) {
    case 'prompts':
      return '提示词库'
    case 'editor':
      return ui.editing ? '编辑提示词' : '新建提示词'
    case 'fill':
      return '填写占位符'
    default:
      return '设置'
  }
})

onMounted(async () => {
  // 面板组件各自按需加载,这里只保证默认落在设置页
  if (!ui.view) ui.openSettings()
})

// 关闭动作(ui.close)不允许留白,回到设置页
watch(
  () => ui.view,
  (v) => {
    if (!v) ui.openSettings()
  }
)
</script>

<template>
  <div class="sapp">
    <header class="bar">
      <span class="brand">ChatDeck</span>
      <nav class="tabs">
        <button class="tab" :class="{ on: ui.view === 'settings' }" @click="ui.openSettings()">
          设置
        </button>
        <button class="tab" :class="{ on: onPrompts }" @click="ui.openPrompts()">提示词库</button>
      </nav>
      <span class="grow" />
      <span class="page">{{ title }}</span>
    </header>

    <main class="body">
      <SettingsPanel v-if="ui.view === 'settings'" />
      <template v-else-if="onPrompts">
        <PromptPanel v-if="ui.view === 'prompts'" />
        <PromptEditor v-else-if="ui.view === 'editor'" />
        <PromptFill v-else-if="ui.view === 'fill'" />
      </template>
    </main>

    <transition name="toast">
      <div v-if="ui.toast" class="toast">{{ ui.toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.sapp {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

.bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 48px;
  padding: 0 16px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.2px;
}

.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--text-secondary);
}

.tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.tab.on {
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
}

.grow {
  flex: 1;
}

.page {
  font-size: 12px;
  color: var(--text-faint);
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(32, 30, 24, 0.92);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  z-index: 20;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
</style>
