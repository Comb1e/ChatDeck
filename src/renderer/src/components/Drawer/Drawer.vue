<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import PromptPanel from '../Prompts/PromptPanel.vue'
import PromptEditor from '../Prompts/PromptEditor.vue'
import PromptFill from '../Prompts/PromptFill.vue'
import SettingsPanel from '../Settings/SettingsPanel.vue'

const ui = useUiStore()

const title = computed(() => {
  switch (ui.view) {
    case 'prompts':
      return '提示词库'
    case 'editor':
      return ui.editing ? '编辑提示词' : '新建提示词'
    case 'fill':
      return '填写占位符'
    case 'settings':
      return '设置'
    default:
      return ''
  }
})
</script>

<template>
  <aside v-if="ui.isOpen" class="drawer">
    <header class="dhead">
      <h2>{{ title }}</h2>
      <button class="close" title="关闭" @click="ui.close()">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
    </header>

    <div class="dbody">
      <PromptPanel v-if="ui.view === 'prompts'" />
      <PromptEditor v-else-if="ui.view === 'editor'" />
      <PromptFill v-else-if="ui.view === 'fill'" />
      <SettingsPanel v-else-if="ui.view === 'settings'" />
    </div>
  </aside>
</template>

<style scoped>
.drawer {
  width: var(--drawer-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-drawer);
}

.dhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border);
}

.dhead h2 {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
}

.close {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-faint);
}

.close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.dbody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
