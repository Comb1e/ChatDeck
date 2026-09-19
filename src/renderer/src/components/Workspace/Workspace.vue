<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Rect } from '@shared/types'
import { useProvidersStore } from '../../stores/providers'
import { useLayoutStore, HEADER_H, PANE_GAP } from '../../stores/layout'
import { useUiStore } from '../../stores/ui'

const providers = useProvidersStore()
const layout = useLayoutStore()
const ui = useUiStore()
const api = window.api

const panesEl = ref<HTMLElement | null>(null)
let resizeObserver: ResizeObserver | null = null

const modes = [
  { mode: 'single', need: 1, label: '单屏' },
  { mode: 'split2', need: 2, label: '双屏' },
  { mode: 'split3', need: 3, label: '三屏' }
] as const

const activeProvider = computed(() =>
  layout.activeId ? providers.byId(layout.activeId) : undefined
)

function providerOf(id: string) {
  return providers.byId(id)
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function paneStyle(rect: Rect): Record<string, string> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  }
}

function headerStyle(rect: Rect): Record<string, string> {
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${HEADER_H}px`
  }
}

function dividerStyle(i: number): Record<string, string> {
  const rects = layout.paneRects
  const left = rects[i]
  const right = rects[i + 1]
  const x = left.rect.x + left.rect.width
  const width = right.rect.x - x
  return {
    left: `${x}px`,
    top: `${left.rect.y + HEADER_H}px`,
    width: `${Math.max(0, width)}px`,
    height: `${left.rect.height - HEADER_H}px`
  }
}

// ---------------- 分割条拖动 ----------------
let dragging: { index: number; startX: number; ratios: number[]; last: number } | null = null

function flexWidth(): number {
  if (!layout.container) return 0
  return Math.max(0, layout.container.width - (layout.paneCount - 1) * PANE_GAP)
}

function startDrag(index: number, e: PointerEvent): void {
  if (!panesEl.value) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  dragging = { index, startX: e.clientX, ratios: layout.beginDrag(), last: 0 }
  e.preventDefault()
}

function onDragMove(e: PointerEvent): void {
  if (!dragging) return
  const now = performance.now()
  if (now - dragging.last < 30) return // 节流，避免 IPC 洪泛
  dragging.last = now
  const dx = e.clientX - dragging.startX
  layout.ratios = [...dragging.ratios]
  layout.dragTo(dragging.index, dx, flexWidth())
}

function endDrag(): void {
  if (!dragging) return
  dragging = null
  layout.endDrag()
}

// ---------------- 生命周期 ----------------
onMounted(() => {
  const el = panesEl.value
  if (!el) return
  resizeObserver = new ResizeObserver(() => {
    const r = el.getBoundingClientRect()
    layout.setContainer({ x: r.left, y: r.top, width: r.width, height: r.height })
  })
  resizeObserver.observe(el)
  const r = el.getBoundingClientRect()
  layout.setContainer({ x: r.left, y: r.top, width: r.width, height: r.height })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <main class="workspace">
    <div class="toolbar">
      <div class="mode-switch" role="group" aria-label="布局">
        <button
          v-for="m in modes"
          :key="m.mode"
          class="mode-btn"
          :class="{ on: layout.mode === m.mode }"
          :disabled="providers.enabled.length < m.need"
          :title="m.label"
          @click="layout.setMode(m.mode)"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3">
            <template v-if="m.mode === 'single'">
              <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" />
            </template>
            <template v-else-if="m.mode === 'split2'">
              <rect x="2.5" y="3.5" width="5" height="9" rx="1.2" />
              <rect x="9.5" y="3.5" width="4" height="9" rx="1.2" />
            </template>
            <template v-else>
              <rect x="2.5" y="3.5" width="3.2" height="9" rx="1" />
              <rect x="7.1" y="3.5" width="3.2" height="9" rx="1" />
              <rect x="10.9" y="3.5" width="2.6" height="9" rx="1" />
            </template>
          </svg>
        </button>
      </div>

      <span class="active-name">{{ activeProvider ? activeProvider.name : '未选择站点' }}</span>

      <transition name="toast">
        <div v-if="ui.toast" class="toast">{{ ui.toast }}</div>
      </transition>
    </div>

    <div ref="panesEl" class="panes">
      <div v-if="layout.paneCount === 0" class="empty">
        <p>没有可显示的站点</p>
        <p class="hint">在右侧「设置」中启用或添加站点</p>
      </div>

      <template v-for="(pane, i) in layout.paneRects" :key="pane.id">
        <div
          class="pane"
          :style="paneStyle(pane.rect)"
          :class="{ active: layout.activeId === pane.id }"
        />
        <div
          class="pane-header"
          :style="headerStyle(pane.rect)"
          :class="{ active: layout.activeId === pane.id }"
          @click="layout.setActivePane(pane.id)"
        >
          <span
            v-if="providerOf(pane.id)"
            class="mark"
            :style="{ background: providerOf(pane.id)!.color }"
            >{{ initial(providerOf(pane.id)!.name) }}</span
          >
          <span class="name">{{ providerOf(pane.id)?.name ?? pane.id }}</span>

          <span class="spacer" />

          <button class="hbtn" title="后退" @click.stop="api.view.back(pane.id)">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
          </button>
          <button class="hbtn" title="前进" @click.stop="api.view.forward(pane.id)">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="m6 3.5 4.5 4.5L6 12.5" />
            </svg>
          </button>
          <button class="hbtn" title="刷新" @click.stop="api.view.reload(pane.id)">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.7h-2.7" />
            </svg>
          </button>
          <button class="hbtn" title="在浏览器打开" @click.stop="api.view.openExternal(pane.id)">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="M6.5 3.5H3.8c-.7 0-1.3.6-1.3 1.3v7.4c0 .7.6 1.3 1.3 1.3h7.4c.7 0 1.3-.6 1.3-1.3V9.5M9.5 2.5h4v4M13 3 8.2 7.8" />
            </svg>
          </button>
          <button v-if="layout.mode !== 'single'" class="hbtn" title="关闭此窗格" @click.stop="layout.closePane(pane.id)">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div
          v-if="i < layout.paneRects.length - 1"
          class="divider"
          :style="dividerStyle(i)"
          @pointerdown="startDrag(i, $event)"
          @pointermove="onDragMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        />
      </template>
    </div>
  </main>
</template>

<style scoped>
.workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.toolbar {
  height: var(--toolbar-h);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  position: relative;
}

.mode-switch {
  display: flex;
  gap: 2px;
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.mode-btn {
  width: 28px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--text-secondary);
}

.mode-btn.on {
  background: var(--bg-card);
  color: var(--accent);
  box-shadow: 0 1px 3px rgba(61, 57, 41, 0.12);
}

.mode-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.active-name {
  font-family: var(--font-serif);
  font-size: 13px;
  color: var(--text-secondary);
}

.toast {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--text);
  color: var(--bg);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 999px;
  white-space: nowrap;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(calc(-50% + 4px));
}

.panes {
  position: relative;
  flex: 1;
  min-height: 0;
}

.pane {
  position: absolute;
  background: var(--bg);
}

.pane-header {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 0 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  border-top: 2px solid transparent;
  user-select: none;
  z-index: 2;
}

.pane-header.active {
  border-top-color: var(--accent);
}

.pane-header .mark {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pane-header .name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pane-header.active .name {
  color: var(--text);
}

.spacer {
  flex: 1;
}

.hbtn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--text-faint);
}

.hbtn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.divider {
  position: absolute;
  cursor: col-resize;
  z-index: 3;
  touch-action: none;
}

.divider::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  width: 3px;
  height: 100%;
  transform: translateX(-50%);
  border-radius: 2px;
  background: transparent;
  transition: background 0.12s ease;
}

.divider:hover::after,
.divider:active::after {
  background: var(--accent-soft);
}

.empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-secondary);
}

.empty .hint {
  font-size: 12px;
  color: var(--text-faint);
}
</style>
