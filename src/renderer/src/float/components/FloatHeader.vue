<script setup lang="ts">
import { computed } from 'vue'
import { useFloatStore } from '../floatStore'
import { useProvidersStore } from '../../stores/providers'
import { FLOAT_HEADER_H } from '@shared/floatLayout'

const float = useFloatStore()
const providers = useProvidersStore()

const state = computed(() => (float.activeId ? float.loadStates[float.activeId] : undefined))

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function collapse(): void {
  float.collapse()
}

function openSettings(): void {
  void window.api.app.openSettings()
}
</script>

<template>
  <!-- 头部整块为拖拽区;按钮/厂商点各自 no-drag -->
  <header class="hd" :style="{ height: `${FLOAT_HEADER_H}px` }">
    <div class="row title-row">
      <span class="logo-dot" />
      <span class="wordmark">ChatDeck</span>
      <span class="mono-tag">FLOAT</span>
      <span class="flex" />
      <button class="wbtn" title="设置" @click="openSettings()">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
        </svg>
      </button>
      <button class="wbtn" title="收起为鲸鱼" @click="collapse()">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M9 3h4v4M7 13H3V9M13 3l-5 5M3 13l5-5" />
        </svg>
      </button>
      <button class="wbtn" title="收起为鲸鱼" @click="collapse()">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>

    <div class="row provs">
      <button
        v-for="p in providers.enabled"
        :key="p.id"
        class="pdot"
        :class="{ on: p.id === float.activeId }"
        :title="p.name"
        @click="float.activate(p.id)"
      >
        <span class="mark" :style="{ background: p.color }">{{ initial(p.name) }}</span>
        <span v-if="providers.unread.includes(p.id)" class="unread" />
        <span v-if="p.id === float.activeId && state === 'loading'" class="ring loading" />
        <span v-else-if="p.id === float.activeId && (state === 'failed' || state === 'crashed')" class="ring err" />
        <span v-else-if="p.id === float.activeId" class="ring ok" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.hd {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 0 8px;
  border-bottom: 1px solid var(--glass-border);
  background: var(--glass-bg-soft);
  -webkit-app-region: drag;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.title-row {
  padding: 4px 4px 0;
}

.provs {
  padding: 2px 4px 7px;
  overflow-x: auto;
  scrollbar-width: none;
}
.provs::-webkit-scrollbar {
  display: none;
}

.logo-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--glow);
}

.wordmark {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--glass-text);
}

.mono-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--accent-bright);
  opacity: 0.85;
}

.flex {
  flex: 1;
}

.wbtn {
  -webkit-app-region: no-drag;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--glass-text-dim);
  transition: all 0.15s ease;
}
.wbtn:hover {
  background: var(--glass-bg-soft);
  color: var(--glass-text);
}

.pdot {
  -webkit-app-region: no-drag;
  position: relative;
  flex-shrink: 0;
  padding: 2px;
  border-radius: 50%;
  transition: transform 0.15s ease;
}
.pdot:hover {
  transform: translateY(-1px);
}

.mark {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}
.pdot:hover .mark,
.pdot.on .mark {
  opacity: 1;
}

.ring {
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  pointer-events: none;
}

.unread {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-bright);
  border: 1.5px solid rgba(12, 13, 18, 0.9);
  pointer-events: none;
}
.ring.ok {
  border-color: var(--glass-glow-border);
  box-shadow: 0 0 10px var(--glow);
}
.ring.loading {
  border-color: rgba(226, 179, 76, 0.8);
  animation: spin 1s linear infinite;
  border-top-color: transparent;
}
.ring.err {
  border-color: rgba(217, 106, 95, 0.9);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
