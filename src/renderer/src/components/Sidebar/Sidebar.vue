<script setup lang="ts">
import { useProvidersStore } from '../../stores/providers'
import { useLayoutStore } from '../../stores/layout'
import { useUiStore } from '../../stores/ui'

const providers = useProvidersStore()
const layout = useLayoutStore()
const ui = useUiStore()

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function isActive(id: string): boolean {
  return layout.panes.includes(id) && (layout.mode === 'single' ? layout.activeId === id : true)
}
</script>

<template>
  <aside class="sidebar">
    <div class="wordmark">ChatDeck</div>
    <div class="section-label">模型站点</div>

    <nav class="list">
      <button
        v-for="p in providers.items.filter((x) => x.enabled)"
        :key="p.id"
        class="prov"
        :class="{ active: isActive(p.id) }"
        :title="p.name"
        @click="layout.activate(p.id)"
      >
        <span class="mark" :style="{ background: p.color }">{{ initial(p.name) }}</span>
        <span class="name">{{ p.name }}</span>
        <span v-if="providers.unread.includes(p.id)" class="dot" />
      </button>
    </nav>

    <div class="footer">
      <button class="foot-btn" :class="{ on: ui.view === 'prompts' }" @click="ui.openPrompts()">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M2.5 3.2c1.6-.9 3.4-.9 5.5.4v9c-2.1-1.3-3.9-1.3-5.5-.4V3.2Z" />
          <path d="M13.5 3.2c-1.6-.9-3.4-.9-5.5.4v9c2.1-1.3 3.9-1.3 5.5-.4V3.2Z" />
        </svg>
        提示词库
      </button>
      <button class="foot-btn" :class="{ on: ui.view === 'settings' }" @click="ui.openSettings()">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4">
          <circle cx="8" cy="8" r="2.2" />
          <path
            d="M8 1.8v1.6M8 12.6v1.6M13 8h-1.6M4.6 8H3M11.6 4.4l-1.1 1.1M5.5 10.5l-1.1 1.1M11.6 11.6l-1.1-1.1M5.5 5.5L4.4 4.4"
          />
        </svg>
        设置
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 16px 10px 12px;
}

.wordmark {
  font-family: var(--font-serif);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.2px;
  padding: 2px 10px 14px;
}

.section-label {
  font-size: 11px;
  color: var(--text-faint);
  padding: 0 10px 8px;
  letter-spacing: 1px;
}

.list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.prov {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  text-align: left;
  color: var(--text-secondary);
  transition: background 0.12s ease, color 0.12s ease;
}

.prov:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.prov.active {
  background: var(--bg-active);
  color: var(--text);
  font-weight: 600;
}

.mark {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.footer {
  border-top: 1px solid var(--border);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.foot-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}

.foot-btn:hover,
.foot-btn.on {
  background: var(--bg-hover);
  color: var(--text);
}
</style>
