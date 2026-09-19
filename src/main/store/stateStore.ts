import type { UiState } from '@shared/types'
import { JsonStore } from './jsonStore'

const EMPTY: UiState = { activeProviderId: null, mode: 'single', paneProviderIds: [], ratios: [] }

/** 界面状态持久化（活动厂商、布局模式、窗格与比例） */
export class StateStore {
  private store = new JsonStore<UiState>('ui-state.json', EMPTY)

  async get(): Promise<UiState> {
    const s = await this.store.load()
    if (!Array.isArray(s.paneProviderIds) || !Array.isArray(s.ratios)) return EMPTY
    if (s.mode !== 'single' && s.mode !== 'split2' && s.mode !== 'split3') return EMPTY
    return s
  }

  async save(state: UiState): Promise<void> {
    await this.store.save(state)
  }
}
