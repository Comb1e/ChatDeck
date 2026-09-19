<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { usePromptsStore } from '../../stores/prompts'
import { useUiStore } from '../../stores/ui'

const prompts = usePromptsStore()
const ui = useUiStore()

const NEW_CATEGORY = '__new__'

const form = reactive({
  title: ui.editing?.title ?? '',
  category: ui.editing?.category ?? prompts.categories[0] ?? '自定义',
  content: ui.editing?.content ?? ''
})

const useNewCategory = ref(
  ui.editing ? !prompts.categories.includes(ui.editing.category) : false
)
const newCategory = ref(ui.editing && useNewCategory.value ? ui.editing.category : '')

const finalCategory = computed(() =>
  useNewCategory.value ? newCategory.value.trim() : String(form.category)
)

const valid = computed(
  () => form.title.trim().length > 0 && form.content.trim().length > 0 && finalCategory.value.length > 0
)

async function save(): Promise<void> {
  if (!valid.value) return
  await prompts.save({
    id: ui.editing?.id,
    title: form.title,
    category: finalCategory.value,
    content: form.content
  })
  ui.showToast('已保存')
  ui.openPrompts()
}

function pickCategory(e: Event): void {
  const v = (e.target as HTMLSelectElement).value
  if (v === NEW_CATEGORY) {
    useNewCategory.value = true
  } else {
    useNewCategory.value = false
    form.category = v
  }
}
</script>

<template>
  <div class="editor">
    <label class="field">
      <span class="label">标题</span>
      <input v-model="form.title" type="text" placeholder="例如：周报整理" />
    </label>

    <div class="field">
      <span class="label">分类</span>
      <select v-if="!useNewCategory" :value="form.category" @change="pickCategory">
        <option v-for="c in prompts.categories" :key="c" :value="c">{{ c }}</option>
        <option v-if="form.category && !prompts.categories.includes(form.category)" :value="form.category">
          {{ form.category }}
        </option>
        <option :value="NEW_CATEGORY">＋ 新建分类…</option>
      </select>
      <div v-else class="row">
        <input v-model="newCategory" type="text" placeholder="新分类名称" />
        <button class="ghost" @click="useNewCategory = false">选择已有</button>
      </div>
    </div>

    <label class="field">
      <span class="label">内容</span>
      <textarea
        v-model="form.content"
        rows="10"
        placeholder="提示词内容。可用 {名称} 作为占位符，使用时会弹出填空框，例如：请翻译以下内容：&#10;{内容}"
      />
    </label>

    <p class="hint">支持占位符语法：<code>{名称}</code>，点击提示词时会先要求填写占位符内容。</p>

    <div class="buttons">
      <button class="ghost" @click="ui.openPrompts()">取消</button>
      <button class="primary" :disabled="!valid" @click="save()">保存</button>
    </div>
  </div>
</template>

<style scoped>
.editor {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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

input[type='text'],
select,
textarea {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--bg);
  outline: none;
  width: 100%;
}

input:focus,
select:focus,
textarea:focus {
  border-color: var(--accent);
}

textarea {
  resize: vertical;
  line-height: 1.6;
}

.row {
  display: flex;
  gap: 8px;
}

.hint {
  font-size: 12px;
  color: var(--text-faint);
  line-height: 1.6;
}

.hint code {
  font-family: var(--font-mono);
  background: var(--bg-hover);
  padding: 1px 5px;
  border-radius: 4px;
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.primary {
  background: var(--accent);
  color: #fff;
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  font-weight: 600;
}

.primary:disabled {
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

.ghost:hover {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
