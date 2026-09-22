/**
 * 余额状态通知——移植自 token-balance src/main/main.js 的 onStateChange 通知部分。
 * 每站点仅在状态切换沿上提醒，避免每个轮询周期重复打扰。
 */
import { Notification } from 'electron'
import type { BalanceSnapshot } from '@shared/balance'
import { formatBalance } from '@shared/balance'

export class BalanceNotifier {
  private readonly lastStatusBySite = new Map<string, string>()

  constructor(private readonly iconPath: string) {}

  private notify(title: string, body: string): void {
    if (!Notification.isSupported()) return
    new Notification({ title, body, icon: this.iconPath, silent: true }).show()
  }

  onSnapshot(state: BalanceSnapshot): void {
    for (const s of state.sites) {
      const prev = this.lastStatusBySite.get(s.id)
      if (prev && prev !== s.status) {
        if (s.status === 'auth-error') {
          this.notify('Token 已失效', `${s.label}:请点击余额小窗重新粘贴 Token`)
        } else if (
          s.status === 'ok' &&
          ['network-error', 'api-error', 'auth-error'].includes(prev)
        ) {
          this.notify('余额已恢复更新', `${s.label}: ${formatBalance(s.balance, s.currency)}`)
        }
      }
      this.lastStatusBySite.set(s.id, s.status)
    }
  }
}
