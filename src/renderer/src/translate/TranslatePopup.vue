<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TRANSLATE_PAIRS } from '@shared/translate'
import type { TranslatePairId, TranslatePopupState } from '@shared/translate'

const state = ref<TranslatePopupState | null>(null)
const pairId = ref<TranslatePairId>('auto')
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

// 先订阅再拉兜底状态,避免首帧竞态漏事件
window.api.on.translateResult((s) => {
  state.value = s
  pairId.value = s.pairId
  copied.value = false
})

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  const [cfg, last] = await Promise.all([
    window.api.translate.getConfig(),
    window.api.translate.getLast()
  ])
  pairId.value = last?.pairId ?? cfg.pair
  if (last) state.value = last
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') hide()
}

/** 切换方向对即持久化;当前内容不变,下一次 Ctrl+Q 按新方向翻译 */
function onPairChange(v: string): void {
  pairId.value = v as TranslatePairId
  window.api.translate.setPair(pairId.value)
}

async function copyDst(): Promise<void> {
  if (!state.value || state.value.status !== 'done' || !state.value.dst) return
  await window.api.clipboard.writeText(state.value.dst)
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1400)
}

function hide(): void {
  void window.api.translate.hide()
}
</script>

<template>
  <div class="popup">
    <header class="bar">
      <span class="dot" :class="state?.status ?? 'idle'" />
      <span class="brand">TRANSLATE</span>
      <span class="dir">{{ state?.dirLabel }}</span>
      <span class="grow" />
      <select
        class="pair"
        :value="pairId"
        title="翻译方向"
        @change="onPairChange(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="p in TRANSLATE_PAIRS" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>
      <button class="close" title="关闭" @click="hide">✕</button>
    </header>
    <main class="body">
      <div v-if="!state" class="hint">划选文字后按 Ctrl+Q 翻译</div>
      <div v-else-if="state.status === 'translating'" class="hint">
        <span class="pulse" />
        翻译中…
      </div>
      <div v-else-if="state.status === 'error'" class="err">{{ state.message }}</div>
      <div v-else class="dst" title="点击复制" @click="copyDst">{{ state.dst }}</div>
    </main>
    <transition name="fade">
      <span v-if="copied" class="copied">已复制</span>
    </transition>
  </div>
</template>

<style scoped>
.popup {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  overflow: hidden;
  color: var(--glass-text);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px 7px 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.bar select,
.bar button {
  -webkit-app-region: no-drag;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--glass-text-faint);
  flex-shrink: 0;
}

.dot.translating {
  background: var(--accent-bright);
  box-shadow: 0 0 6px var(--glow);
  animation: breathe 1.1s ease-in-out infinite;
}

.dot.done {
  background: var(--accent-bright);
  box-shadow: 0 0 6px var(--glow);
}

.dot.error {
  background: #e06c5f;
  box-shadow: 0 0 6px rgba(224, 108, 95, 0.6);
}

.brand {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--glass-text-faint);
}

.dir {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--glass-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 110px;
}

.grow {
  flex: 1;
}

.pair {
  font-size: 11px;
  color: var(--glass-text);
  background: var(--glass-bg-soft);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  padding: 2px 4px;
  outline: none;
  max-width: 108px;
}

.close {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--glass-text-dim);
  font-size: 11px;
  line-height: 1;
}

.close:hover {
  background: var(--glass-bg-soft);
  color: var(--glass-text);
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 10px 12px;
}

.hint {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--glass-text-dim);
}

.err {
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
  color: #e8a08f;
  overflow-y: auto;
  user-select: text;
}

.dst {
  flex: 1;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
  cursor: copy;
  user-select: text;
}

.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-bright);
  box-shadow: 0 0 8px var(--glow);
  animation: breathe 1.1s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes breathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.copied {
  position: absolute;
  right: 10px;
  bottom: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--accent-bright);
  background: rgba(17, 19, 26, 0.92);
  border: 1px solid var(--glass-glow-border);
  padding: 2px 8px;
  border-radius: 999px;
  pointer-events: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
