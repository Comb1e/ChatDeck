<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Prompt } from '@shared/types'
import { hasPlaceholders, renderContent } from '@shared/prompts'
import { usePromptsStore } from '../../stores/prompts'
import { useUiStore } from '../../stores/ui'
import { useLayoutStore } from '../../stores/layout'

const prompts = usePromptsStore()
const ui = useUiStore()
const layout = useLayoutStore()

const search = ref('')
const activeCategory = ref('全部')

onMounted(() => {
  if (prompts.prompts.length === 0) void prompts.load()
})

const categories = computed(() => {
  const extra = prompts.prompts.map((p) => p.category).filter((c) => !prompts.categories.includes(c))
  return ['全部', ...prompts.categories, ...new Set(extra)]
})

const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  return prompts.prompts.filter((p) => {
    if (activeCategory.value !== '全部' && p.category !== activeCategory.value) return false
    if (!kw) return true
    return p.title.toLowerCase().includes(kw) || p.content.toLowerCase().includes(kw)
  })
})

/** 使用提示词：有占位符先转填空页；否则直接复制/粘贴 */
function usePrompt(p: Prompt, pasteAfter: boolean): void {
  if (hasPlaceholders(p.content)) {
    ui.startFill(p, pasteAfter)
    return
  }
  void exec(p.content, {}, pasteAfter)
}

async function exec(content: string, values: Record<string, string>, pasteAfter: boolean): Promise<void> {
  const text = renderContent(content, values)
  await window.api.clipboard.writeText(text)
  if (pasteAfter) {
    const target = layout.activeId
    if (!target) {
      ui.showToast('当前没有活动站点')
      return
    }
    ui.close()
    window.api.view.paste(target)
    ui.showToast('已复制，正在粘贴到当前站点（若无效请手动 Ctrl+V）')
  } else {
    ui.showToast('已复制到剪贴板')
  }
}
</script>

<template>
  <div class="panel">
    <div class="tools">
      <input v-model="search" class="search" type="text" placeholder="搜索提示词…" />
      <button class="new-btn" @click="ui.newPrompt()">＋ 新建</button>
    </div>

    <div class="chips">
      <button
        v-for="c in categories"
        :key="c"
        class="chip"
        :class="{ on: activeCategory === c }"
        @click="activeCategory = c"
      >
        {{ c }}
      </button>
    </div>

    <div class="cards">
      <article v-for="p in filtered" :key="p.id" class="card" @click="usePrompt(p, false)">
        <div class="card-top">
          <h3 class="title">{{ p.title }}</h3>
          <span class="tag">{{ p.category }}</span>
        </div>
        <p class="content">{{ p.content }}</p>
        <div class="actions" @click.stop>
          <button v-if="hasPlaceholders(p.content)" class="act" @click="usePrompt(p, false)">
            填空复制
          </button>
          <button v-else class="act" @click="usePrompt(p, false)">复制</button>
          <button class="act primary" @click="usePrompt(p, true)">粘贴</button>
          <span class="gap" />
          <button class="act" @click="ui.editPrompt(p)">编辑</button>
          <button class="act danger" @click="void prompts.remove(p.id)">删除</button>
        </div>
      </article>
      <p v-if="filtered.length === 0" class="none">没有匹配的提示词</p>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tools {
  display: flex;
  gap: 8px;
  padding: 14px 16px 10px;
}

.search {
  flex: 1;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  outline: none;
}

.search:focus {
  border-color: var(--accent);
}

.new-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 13px;
}

.new-btn:hover {
  background: var(--accent-hover);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 12px;
}

.chip {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.chip.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-hover);
  font-weight: 600;
}

.cards {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}

.card:hover {
  border-color: var(--border-strong);
  box-shadow: 0 2px 10px rgba(61, 57, 41, 0.06);
}

.card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.content {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}

.actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  align-items: center;
}

.gap {
  flex: 1;
}

.act {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.act:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.act.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.act.primary:hover {
  background: var(--accent-hover);
  color: #fff;
}

.act.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
  background: none;
}

.none {
  text-align: center;
  color: var(--text-faint);
  font-size: 13px;
  padding: 24px 0;
}
</style>
