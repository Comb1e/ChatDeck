import { spawn } from 'node:child_process'
import { clipboard } from 'electron'

/** Ctrl+C 后等待目标应用写剪贴板 */
const COPY_SETTLE_MS = 250
const POWERSHELL_TIMEOUT_MS = 3000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 全局取词:向前台应用模拟 Ctrl+C,读剪贴板后无条件还原。
 * 先清空文本位,读到空即视为取词失败(该应用 Ctrl+C 非复制/无选区),静默返回 null。
 * 已知限制:富文本/文件等非文本+图片格式无法还原(还原文本与图片两种)。
 */
export async function captureSelectedText(): Promise<string | null> {
  const savedText = clipboard.readText()
  const savedImage = clipboard.readImage()
  const hadImage = !savedImage.isEmpty()
  clipboard.writeText('')
  try {
    try {
      await sendCtrlC()
    } catch {
      // 前台无法模拟按键(超时/无控制台),按取词失败处理
    }
    await sleep(COPY_SETTLE_MS)
    return clipboard.readText().trim() || null
  } finally {
    const restore: { text?: string; image?: typeof savedImage } = {}
    if (savedText) restore.text = savedText
    if (hadImage) restore.image = savedImage
    if (restore.text || restore.image) clipboard.write(restore)
    else clipboard.clear()
  }
}

/** SendKeys '^c' 发往前台窗口;不用 shell 以避免参数被二次解释 */
function sendCtrlC(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"
      ],
      { windowsHide: true }
    )
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('send keys timeout'))
    }, POWERSHELL_TIMEOUT_MS)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
