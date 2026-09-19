import type {
  PaneLayoutEntry,
  Prompt,
  PromptInput,
  Provider,
  ProviderInput,
  UiState,
  ViewLoadState
} from './types'

/** 渲染层可用的宿主 API（preload 经 contextBridge 暴露，结构以本接口为准） */
export interface DeckApi {
  providers: {
    list(): Promise<Provider[]>
    save(input: ProviderInput): Promise<Provider[]>
    remove(id: string): Promise<Provider[]>
    clearData(id: string): Promise<boolean>
  }
  prompts: {
    list(): Promise<PromptLibrary>
    save(input: PromptInput): Promise<PromptLibrary>
    remove(id: string): Promise<PromptLibrary>
    reset(): Promise<PromptLibrary>
  }
  state: {
    get(): Promise<UiState | null>
    save(state: UiState): Promise<void>
  }
  view: {
    setLayout(entries: PaneLayoutEntry[]): Promise<boolean>
    setActive(id: string): void
    reload(id: string): void
    back(id: string): void
    forward(id: string): void
    openExternal(id: string): void
    paste(id: string): void
  }
  clipboard: {
    writeText(text: string): Promise<boolean>
  }
  on: {
    titleChanged(cb: (e: { id: string; title: string }) => void): void
    activeChanged(cb: (e: { id: string }) => void): void
    loadStateChanged(cb: (e: { id: string; state: ViewLoadState }) => void): void
  }
}

export interface PromptLibrary {
  prompts: Prompt[]
  categories: string[]
}
