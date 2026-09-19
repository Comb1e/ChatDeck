<script setup lang="ts">
import { computed } from 'vue'
import { useFloatStore } from '../floatStore'
import { useProvidersStore } from '../../stores/providers'

const float = useFloatStore()
const providers = useProvidersStore()

const active = computed(() => (float.activeId ? providers.byId(float.activeId) : undefined))
const initial = computed(() => active.value?.name.trim().charAt(0).toUpperCase() ?? '?')

function expand(): void {
  void float.toggleExpanded()
}
</script>

<template>
  <!-- 折叠药丸:整体可拖动;右侧按钮展开 -->
  <div class="pill">
    <span class="pulse" :style="{ background: active?.color ?? 'var(--accent)' }" />
    <span class="brand">ChatDeck</span>
    <span class="chip" :style="{ background: active?.color ?? 'var(--accent)' }">{{ initial }}</span>
    <button class="expand" title="展开悬浮窗" @click="expand">
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M7 3H3v4M9 13h4V9M3 3l4.5 4.5M13 13L8.5 8.5" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.pill {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 14px;
  /* 高 64 全圆角(Windows 最小窗高) */
  border-radius: 32px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  -webkit-app-region: drag;
  color: var(--glass-text);
}

.pulse {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  animation: breathe 2.4s ease-in-out infinite;
}

.brand {
  font-family: var(--font-serif);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.chip {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.expand {
  -webkit-app-region: no-drag;
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-bright);
  transition: all 0.15s ease;
}
.expand:hover {
  background: var(--accent-dim);
  box-shadow: 0 0 12px var(--glow);
}

@keyframes breathe {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 6px var(--glow);
  }
  50% {
    opacity: 0.45;
    box-shadow: 0 0 2px var(--glow);
  }
}
</style>
