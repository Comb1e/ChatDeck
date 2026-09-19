/** IPC channel 常量，主进程/preload/渲染层共用，避免魔法字符串 */
export const IPC = {
  ProvidersList: 'providers:list',
  ProvidersSave: 'providers:save',
  ProvidersRemove: 'providers:remove',
  ProvidersClearData: 'providers:clear-data',

  PromptsList: 'prompts:list',
  PromptsSave: 'prompts:save',
  PromptsRemove: 'prompts:remove',
  PromptsReset: 'prompts:reset',

  StateGet: 'state:get',
  StateSave: 'state:save',

  ViewSetLayout: 'view:set-layout',
  ViewSetActive: 'view:set-active',
  ViewReload: 'view:reload',
  ViewBack: 'view:back',
  ViewForward: 'view:forward',
  ViewOpenExternal: 'view:open-external',
  ViewPaste: 'view:paste',

  ClipboardWrite: 'clipboard:write',

  // 主进程 → 渲染层事件
  EvTitleChanged: 'ev:title-changed',
  EvActiveChanged: 'ev:active-changed',
  EvLoadStateChanged: 'ev:load-state-changed'
} as const
