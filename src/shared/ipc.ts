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

  // 站点视图通道(绑定 FloatWindow 的 ViewManager 实例;悬浮窗是唯一站点宿主)
  FViewSetLayout: 'fview:set-layout',
  FViewSetActive: 'fview:set-active',
  FViewReload: 'fview:reload',
  FViewBack: 'fview:back',
  FViewForward: 'fview:forward',
  /** 无参:粘贴到悬浮窗当前活动站点(提示词面板等跨窗口使用) */
  FViewPaste: 'fview:paste',

  // 悬浮窗窗口控制
  FloatToggle: 'float:toggle',
  FloatResize: 'float:resize',
  FloatHide: 'float:hide',
  FloatGetState: 'float:get-state',
  FloatSetProvider: 'float:set-provider',

  // 设置窗口
  AppOpenSettings: 'app:open-settings',

  ClipboardWrite: 'clipboard:write',

  // 划词翻译(配置在设置窗口填写;结果推给译文弹窗渲染层)
  TranslateGetConfig: 'translate:get-config',
  TranslateSaveConfig: 'translate:save-config',
  TranslateSetPair: 'translate:set-pair',
  TranslateGetLast: 'translate:get-last',
  TranslateHide: 'translate:hide',

  // 主进程 → 渲染层事件(悬浮窗渲染层)
  EvFTitleChanged: 'ev:f-title-changed',
  EvFActiveChanged: 'ev:f-active-changed',
  EvFLoadStateChanged: 'ev:f-load-state-changed',
  // 译文弹窗事件(只发给弹窗 webContents)
  EvTranslateResult: 'ev:translate-result'
} as const
