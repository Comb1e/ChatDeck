<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import { FLOAT_EXPANDED, FLOAT_INSET, FLOAT_FRAME_PAD } from '@shared/floatLayout'
import WhaleFrame from './components/WhaleFrame.vue'
import { useFloatStore } from './floatStore'
import { useProvidersStore } from '../stores/providers'
import FloatHeader from './components/FloatHeader.vue'
import FloatPrompts from './components/FloatPrompts.vue'

const float = useFloatStore()

function onKeydown(e: KeyboardEvent): void {
  // Ctrl+1~9 切换到第 N 个启用站点(与原桌面版快捷键一致)
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
    const target = useProvidersStore().enabled[Number(e.key) - 1]
    if (target) {
      e.preventDefault()
      float.activate(target.id)
    }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  window.api.form.onCommand(command => {
    if (command.type === 'present') requestAnimationFrame(() => requestAnimationFrame(() => {
      window.api.form.report({ type: 'presented', id: command.id, revision: command.revision })
    }))
  })
  await float.init()
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(() => window.api.form.ready()))
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <WhaleFrame />
  <div v-if="float.ready" class="float" :style="{ left: `${FLOAT_INSET.x}px`, top: `${FLOAT_INSET.y}px`, width: `${FLOAT_EXPANDED.width}px`, height: `${FLOAT_EXPANDED.height}px` }">
    <FloatHeader />
    <main class="content" :style="{ padding: `0 ${FLOAT_FRAME_PAD}px ${FLOAT_FRAME_PAD}px` }">
      <!-- 对话模式:该区域被主进程 WebContentsView 覆盖,HTML 无需绘制 -->
      <FloatPrompts v-if="float.mode === 'prompts'" />
    </main>
    <footer class="promptbar">
      <span class="stat" :class="float.loadStates[float.activeId ?? ''] ?? 'idle'" />
      <button
        class="bar-btn"
        :class="{ on: float.mode === 'prompts' }"
        @click="float.setMode(float.mode === 'prompts' ? 'chat' : 'prompts')"
      >
        <span class="glyph">✦</span>
        {{ float.mode === 'prompts' ? '返回对话' : '提示词速查' }}
      </button>
      <span class="mono-tag">ChatDeck·Float</span>
    </footer>

    <transition name="toast">
      <div v-if="float.toast" class="toast">{{ float.toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.float {
  position: absolute;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border-radius: var(--float-radius);
  background: transparent;
  overflow: hidden;
  color: var(--glass-text);
}

.content {
  flex: 1;
  min-height: 0;
  position: relative;
}

.promptbar {
  height: 42px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-top: 1px solid var(--glass-border);
  background: transparent;
}

.stat {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}
.stat.loading {
  background: #e2b34c;
  animation: breathe 1.2s ease-in-out infinite;
}
.stat.ready {
  background: #5fb877;
}
.stat.failed,
.stat.crashed {
  background: #d96a5f;
}

.bar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--glass-text-dim);
  border: 1px solid transparent;
  transition: all 0.15s ease;
}
.bar-btn:hover {
  color: var(--glass-text);
  background: var(--glass-bg-soft);
}
.bar-btn.on {
  color: var(--accent-bright);
  border-color: var(--glass-glow-border);
  background: var(--accent-dim);
}

.mono-tag {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--glass-text-faint);
  text-transform: uppercase;
}

.glyph {
  font-size: 13px;
}

.toast {
  position: absolute;
  left: 50%;
  bottom: 54px;
  transform: translateX(-50%);
  padding: 7px 16px;
  border-radius: 999px;
  background: rgba(12, 13, 18, 0.92);
  border: 1px solid var(--glass-glow-border);
  color: var(--glass-text);
  font-size: 12px;
  white-space: nowrap;
  z-index: 10;
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

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
