<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Prompt } from '@shared/types'
import { extractPlaceholders, hasPlaceholders, renderContent } from '@shared/prompts'
import { usePromptsStore } from '../../stores/prompts'
import { useFloatStore } from '../floatStore'

const prompts = usePromptsStore()
const float = useFloatStore()

const q = ref('')
const cat = ref<string | null>(null)
const filling = ref<Prompt | null>(null)
const fields = reactive<Record<string, string>>({})

const filtered = computed(() =>
  prompts.prompts.filter(
    (p) =>
      (!cat.value || p.category === cat.value) &&
      (!q.value || (p.title + p.content).toLowerCase().includes(q.value.toLowerCase()))
  )
)

const preview = computed(() =>
  filling.value ? renderContent(filling.value.content, fields) : ''
)
const complete = computed(() =>
  extractPlaceholders(filling.value?.content ?? '').every((name) => fields[name]?.trim())
)

function open(p: Prompt): void {
  if (!hasPlaceholders(p.content)) {
    void copy(p.content)
    return
  }
  filling.value = p
  for (const k of Object.keys(fields)) delete fields[k]
}

function back(): void {
  filling.value = null
}

async function copy(text: string): Promise<void> {
  await window.api.clipboard.writeText(text)
  float.showToast('已复制,任意输入框 Ctrl+V 即可粘贴')
  filling.value = null
}
</script>

<template>
  <div class="panel">
    <!-- 填空视图 -->
    <template v-if="filling">
      <div class="fill-head">
        <button class="back" @click="back">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M10 3L5 8l5 5" />
          </svg>
          返回
        </button>
        <span class="fill-title">{{ filling.title }}</span>
      </div>
      <div class="fill-body">
        <label v-for="name in extractPlaceholders(filling.content)" :key="name" class="field">
          <span class="fname">{{ name }}</span>
          <textarea v-model="fields[name]" rows="2" :placeholder="`填写「${name}」`" />
        </label>
        <div class="preview">{{ preview }}</div>
      </div>
      <div class="fill-foot">
        <button class="primary" :disabled="!complete" @click="filling && copy(preview)">复制</button>
      </div>
    </template>

    <!-- 列表视图 -->
    <template v-else>
      <div class="search">
        <input v-model="q" type="text" placeholder="搜索提示词…" />
      </div>
      <div class="cats">
        <button class="chip" :class="{ on: cat === null }" @click="cat = null">全部</button>
        <button
          v-for="c in prompts.categories"
          :key="c"
          class="chip"
          :class="{ on: cat === c }"
          @click="cat = cat === c ? null : c"
        >
          {{ c }}
        </button>
      </div>
      <div class="list">
        <button v-for="p in filtered" :key="p.id" class="card" @click="open(p)">
          <span class="ct">{{ p.category }}</span>
          <span class="ttl">{{ p.title }}</span>
          <span class="content">{{ p.content }}</span>
        </button>
        <div v-if="filtered.length === 0" class="empty">没有匹配的提示词</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.search {
  padding: 10px 12px 6px;
}
.search input {
  width: 100%;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--glass-text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}
.search input::placeholder {
  color: var(--glass-text-faint);
}
.search input:focus {
  border-color: var(--glass-glow-border);
}

.cats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 4px 12px 8px;
}
.chip {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--glass-text-dim);
  border: 1px solid var(--glass-border);
  transition: all 0.15s ease;
}
.chip:hover {
  color: var(--glass-text);
}
.chip.on {
  color: var(--accent-bright);
  border-color: var(--glass-glow-border);
  background: var(--accent-dim);
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card {
  text-align: left;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: all 0.15s ease;
}
.card:hover {
  border-color: var(--glass-glow-border);
  background: var(--accent-dim);
}

.ct {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 1.5px;
  color: var(--accent-bright);
  text-transform: uppercase;
}

.ttl {
  font-size: 13px;
  font-weight: 600;
  color: var(--glass-text);
}

.content {
  font-size: 11px;
  color: var(--glass-text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.empty {
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--glass-text-faint);
}

/* ---- 填空视图 ---- */
.fill-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 6px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--glass-text-dim);
}
.back:hover {
  color: var(--glass-text);
  background: var(--glass-bg-soft);
}
.fill-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--glass-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fill-body {
  flex: 1;
  overflow-y: auto;
  padding: 2px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fname {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--accent-bright);
}
.field textarea {
  resize: none;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  color: var(--glass-text);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease;
}
.field textarea:focus {
  border-color: var(--glass-glow-border);
}

.preview {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--glass-border);
  font-size: 11px;
  line-height: 1.6;
  color: var(--glass-text-dim);
  white-space: pre-wrap;
  word-break: break-all;
}

.fill-foot {
  padding: 8px 12px 12px;
}
.primary {
  width: 100%;
  padding: 8px 0;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  transition: all 0.15s ease;
}
.primary:hover:not(:disabled) {
  background: var(--accent-hover);
  box-shadow: 0 0 14px var(--glow);
}
.primary:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
