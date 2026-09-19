<script setup lang="ts">
import { computed, reactive } from 'vue'
import { extractPlaceholders, renderContent } from '@shared/prompts'
import { useUiStore } from '../../stores/ui'
import { useLayoutStore } from '../../stores/layout'

const ui = useUiStore()
const layout = useLayoutStore()

const target = ui.fill
const fields = reactive<Record<string, string>>({})
if (target) {
  for (const name of extractPlaceholders(target.prompt.content)) fields[name] = ''
}

const names = Object.keys(fields)

const preview = computed(() =>
  target ? renderContent(target.prompt.content, fields) : ''
)

const complete = computed(() => names.every((n) => fields[n].trim().length > 0))

async function finish(): Promise<void> {
  if (!target) return
  const text = renderContent(target.prompt.content, fields)
  await window.api.clipboard.writeText(text)
  if (target.pasteAfter) {
    const id = layout.activeId
    if (!id) {
      ui.showToast('当前没有活动站点')
      return
    }
    ui.close()
    window.api.view.paste(id)
    ui.showToast('已复制，正在粘贴到当前站点（若无效请手动 Ctrl+V）')
  } else {
    ui.showToast('已复制到剪贴板')
  }
}
</script>

<template>
  <div v-if="target" class="fill">
    <h3 class="ptitle">{{ target.prompt.title }}</h3>

    <label v-for="name in names" :key="name" class="field">
      <span class="label">{{ name }}</span>
      <textarea v-model="fields[name]" rows="4" :placeholder="`填写「${name}」`" />
    </label>

    <div class="field">
      <span class="label">预览</span>
      <pre class="preview">{{ preview }}</pre>
    </div>

    <div class="buttons">
      <button class="ghost" @click="ui.openPrompts()">返回</button>
      <button class="ghost" :disabled="!complete" @click="finish()">复制</button>
      <button class="primary" :disabled="!complete" @click="finish()">
        {{ target.pasteAfter ? '复制并粘贴' : '复制' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.fill {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ptitle {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

textarea {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--bg);
  outline: none;
  resize: vertical;
  line-height: 1.6;
  width: 100%;
}

textarea:focus {
  border-color: var(--accent);
}

.preview {
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.primary {
  background: var(--accent);
  color: #fff;
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  font-weight: 600;
}

.primary:disabled,
.ghost:disabled {
  opacity: 0.4;
  cursor: default;
}

.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.ghost {
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.ghost:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
