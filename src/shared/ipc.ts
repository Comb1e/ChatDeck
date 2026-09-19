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

  // 悬浮窗专用视图通道(绑定 FloatWindow 的 ViewManager 实例)
  FViewSetLayout: 'fview:set-layout',
  FViewSetActive: 'fview:set-active',
  FViewReload: 'fview:reload',
  FViewBack: 'fview:back',
  FViewForward: 'fview:forward',

  // 悬浮窗窗口控制
  FloatToggle: 'float:toggle',
  FloatResize: 'float:resize',
  FloatHide: 'float:hide',
  FloatGetState: 'float:get-state',
  FloatSetProvider: 'float:set-provider',

  ClipboardWrite: 'clipboard:write',

  // 主进程 → 渲染层事件
  EvTitleChanged: 'ev:title-changed',
  EvActiveChanged: 'ev:active-changed',
  EvLoadStateChanged: 'ev:load-state-changed',
  EvFTitleChanged: 'ev:f-title-changed',
  EvFActiveChanged: 'ev:f-active-changed',
  EvFLoadStateChanged: 'ev:f-load-state-changed'
} as const
