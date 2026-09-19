import { contextBridge, ipcRenderer } from 'electron'

/**
 * 错误页专用桥：只暴露重试能力，随 error.html 一起加载到任意站点视图。
 * 注意：这里刻意不导入 @shared/ipc —— 沙箱 preload 必须打成单文件，
 * 两个 preload 入口共享模块会被 Rollup 拆成 chunk 导致运行时加载失败。
 * channel 字符串与 @shared/ipc 的 ViewReload 保持一致。
 */
contextBridge.exposeInMainWorld('deckError', {
  reload: (providerId: string): void => {
    if (typeof providerId === 'string' && providerId) {
      ipcRenderer.send('view:reload', providerId)
    }
  }
})
