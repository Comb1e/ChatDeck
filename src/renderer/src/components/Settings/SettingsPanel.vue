<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { effectiveAutoSleepMinutes, type Provider } from '@shared/types'
import { useProvidersStore } from '../../stores/providers'
import { usePromptsStore } from '../../stores/prompts'
import { useUiStore } from '../../stores/ui'

const providers = useProvidersStore()
const prompts = usePromptsStore()
const ui = useUiStore()

onMounted(() => {
  if (providers.items.length === 0) void providers.load()
})

// ---------- 划词翻译配置(百度翻译 APPID/KEY,存 translate.user.json) ----------
const trForm = reactive({ appId: '', appKey: '' })

onMounted(async () => {
  const cfg = await window.api.translate.getConfig()
  trForm.appId = cfg.appId
  trForm.appKey = cfg.appKey
})

async function saveTranslateConfig(): Promise<void> {
  const saved = await window.api.translate.saveConfig({ appId: trForm.appId, appKey: trForm.appKey })
  trForm.appId = saved.appId
  trForm.appKey = saved.appKey
  ui.showToast('翻译服务配置已保存')
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

async function toggle(p: Provider): Promise<void> {
  await window.api.providers.save({ id: p.id, name: p.name, url: p.url, enabled: !p.enabled })
  await providers.load()
}

async function removeCustom(p: Provider): Promise<void> {
  if (!window.confirm(`删除自定义站点「${p.name}」？`)) return
  await window.api.providers.remove(p.id)
  await providers.load()
}

async function clearLogin(p: Provider): Promise<void> {
  if (!window.confirm(`清除「${p.name}」的登录数据与缓存？下次打开需重新登录。`)) return
  await window.api.providers.clearData(p.id)
  providers.loadStates[p.id] = 'loading'
  ui.showToast(`已清除 ${p.name} 的本地数据`)
}

// ---------- 后台休眠：每站点可调（0=不休眠），缺省值来自 providers.default.json ----------
const SLEEP_OPTIONS = [
  { value: 0, label: '不休眠' },
  { value: 1, label: '1 分钟' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '60 分钟' }
]

function sleepValue(p: Provider): number {
  return effectiveAutoSleepMinutes(p)
}

async function setSleep(p: Provider, e: Event): Promise<void> {
  const minutes = Number((e.target as HTMLSelectElement).value)
  await window.api.providers.save({ id: p.id, name: p.name, url: p.url, autoSleepMinutes: minutes })
  await providers.load()
  ui.showToast(minutes === 0 ? `「${p.name}」后台不休眠` : `「${p.name}」后台 ${minutes} 分钟后休眠`)
}

async function resetPrompts(): Promise<void> {
  if (!window.confirm('恢复提示词库为默认内容？你的修改和自定义提示词将被清除。')) return
  await prompts.reset()
  ui.showToast('提示词库已恢复默认')
}

// ---------- 新增自定义厂商 ----------
const showAdd = ref(false)
const addForm = reactive({ name: '', url: '', color: '#d97757' })

async function addProvider(): Promise<void> {
  const name = addForm.name.trim()
  const url = addForm.url.trim()
  if (!name || !url) return
  await window.api.providers.save({ name, url, color: addForm.color, enabled: true })
  await providers.load()
  addForm.name = ''
  addForm.url = ''
  addForm.color = '#d97757'
  showAdd.value = false
  ui.showToast(`已添加 ${name}`)
}
</script>

<template>
  <div class="settings">
    <section>
      <h3 class="sec-title">模型站点</h3>
      <div class="prov-list">
        <div v-for="p in providers.items" :key="p.id" class="prov-row">
          <span class="mark" :style="{ background: p.color }">{{ initial(p.name) }}</span>
          <div class="prov-info">
            <div class="prov-name">
              {{ p.name }}
              <span v-if="!p.builtin" class="badge">自定义</span>
            </div>
            <div class="prov-url">{{ p.url }}</div>
          </div>
          <select
            class="sleep"
            :value="sleepValue(p)"
            title="后台休眠：超过该时长未显示的站点卸载以省内存，切回自动重载（登录保留）"
            @change="setSleep(p, $event)"
          >
            <option v-for="opt in SLEEP_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <button class="mini" title="清除登录数据" @click="clearLogin(p)">清登录</button>
          <button v-if="!p.builtin" class="mini danger" title="删除站点" @click="removeCustom(p)">删除</button>
          <button
            class="switch"
            :class="{ on: p.enabled }"
            role="switch"
            :aria-checked="p.enabled"
            :title="p.enabled ? '点击停用' : '点击启用'"
            @click="toggle(p)"
          >
            <span class="knob" />
          </button>
        </div>
      </div>

      <div v-if="!showAdd" class="add-wrap">
        <button class="add-btn" @click="showAdd = true">＋ 添加自定义站点</button>
      </div>
      <div v-else class="add-form">
        <input v-model="addForm.name" type="text" placeholder="名称，如：混元" />
        <input v-model="addForm.url" type="text" placeholder="网址，如：https://hunyuan.tencent.com/" />
        <div class="row">
          <label class="color-label">
            图标色
            <input v-model="addForm.color" type="color" />
          </label>
          <span class="grow" />
          <button class="ghost" @click="showAdd = false">取消</button>
          <button class="primary" :disabled="!addForm.name.trim() || !addForm.url.trim()" @click="addProvider()">
            添加
          </button>
        </div>
      </div>
    </section>

    <section>
      <h3 class="sec-title">划词翻译</h3>
      <div class="add-form">
        <input v-model="trForm.appId" type="text" placeholder="百度翻译 APPID" autocomplete="off" />
        <input v-model="trForm.appKey" type="text" placeholder="百度翻译密钥 KEY" autocomplete="off" />
        <div class="row">
          <span class="grow" />
          <button
            class="primary"
            :disabled="!trForm.appId.trim() || !trForm.appKey.trim()"
            @click="saveTranslateConfig()"
          >
            保存
          </button>
        </div>
        <p class="tr-hint">
          配置后在任意应用划选文字按 Ctrl+Q，译文显示在悬浮窗正上方（默认中⇄英自动，方向可在弹窗切换）。
          凭据在 fanyi-api.baidu.com 注册获取，免费标准版 QPS=1；仅保存在本机。
        </p>
      </div>
    </section>

    <section>
      <h3 class="sec-title">提示词库</h3>
      <div class="row">
        <button class="ghost" @click="resetPrompts()">恢复默认提示词</button>
        <span class="grow" />
        <span class="count">{{ prompts.prompts.length }} 条</span>
      </div>
    </section>

    <section>
      <h3 class="sec-title">关于</h3>
      <p class="about">
        ChatDeck v0.3.6 · 国内大模型聚合工作台<br />
        每个站点使用独立存储，登录数据仅保存在本机。<br />
        快捷键：Ctrl + 1~9 切换站点（悬浮窗），Ctrl + Q 划词翻译。
      </p>
    </section>
  </div>
</template>

<style scoped>
.settings {
  padding: 6px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.sec-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-faint);
  letter-spacing: 1px;
  margin-bottom: 10px;
}

.prov-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.prov-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 6px;
  border-radius: var(--radius-sm);
}

.prov-row:hover {
  background: var(--bg);
}

.mark {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.prov-info {
  flex: 1;
  min-width: 0;
}

.prov-name {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 500;
}

.prov-url {
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.mini:hover {
  background: var(--bg-hover);
}

.mini.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
  background: none;
}

.sleep {
  font-size: 11px;
  padding: 3px 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* 开关 */
.switch {
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: var(--border-strong);
  position: relative;
  transition: background 0.15s ease;
  flex-shrink: 0;
}

.switch .knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.switch.on {
  background: var(--accent);
}

.switch.on .knob {
  left: 16px;
}

.add-wrap {
  margin-top: 10px;
}

.add-btn {
  width: 100%;
  padding: 9px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
}

.add-btn:hover {
  border-color: var(--accent);
  color: var(--accent-hover);
}

.add-form {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg);
}

.add-form input[type='text'] {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  outline: none;
  background: var(--bg-card);
}

.add-form input[type='text']:focus {
  border-color: var(--accent);
}

.tr-hint {
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-faint);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.color-label input[type='color'] {
  width: 30px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px;
  background: none;
}

.grow {
  flex: 1;
}

.primary {
  background: var(--accent);
  color: #fff;
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: 13px;
}

.primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.ghost {
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 13px;
}

.ghost:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.count {
  font-size: 12px;
  color: var(--text-faint);
}

.about {
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-faint);
}
</style>
