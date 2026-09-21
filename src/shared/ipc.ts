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
  /** 把站点视图导航到指定地址(余额站点的 Usage 页在悬浮窗内打开) */
  FViewNavigate: 'fview:navigate',
  /** 无参:粘贴到悬浮窗当前活动站点(提示词面板等跨窗口使用) */
  FViewPaste: 'fview:paste',

  // 悬浮窗窗口控制
  FloatToggle: 'float:toggle',
  FloatHide: 'float:hide',
  FloatGetState: 'float:get-state',
  FloatSetProvider: 'float:set-provider',
  /** 悬浮窗内部:收起为鲸鱼形态 */
  FloatCollapse: 'float:collapse',
  /** 悬浮窗渲染层 → 主进程:未读站点数变化(鲸鱼头顶气泡显示用) */
  FloatUnreadCount: 'float:unread-count',

  // 鲸鱼形态(悬浮窗压缩态,移植自 whale-pet)
  WhaleGetWorkarea: 'whale:get-workarea',
  /** 悬浮在鲸鱼身上时开启窗口交互,离开后恢复鼠标穿透 */
  WhaleSetInteractive: 'whale:set-interactive',
  /** 鲸鱼渲染层初始化完成后再显示窗口(避免闪空) */
  WhaleReady: 'whale:ready',
  /** 单击鲸鱼:携带世界姿态,主进程据此定位并展开悬浮窗 */
  WhaleExpand: 'whale:expand',

  // 设置窗口
  AppOpenSettings: 'app:open-settings',
  // 开机自启(Windows 写 HKCU\...\CurrentVersion\Run,经 app.setLoginItemSettings)
  AppGetAutostart: 'app:get-autostart',
  AppSetAutostart: 'app:set-autostart',

  ClipboardWrite: 'clipboard:write',

  // 余额监控(移植自 token-balance;独立小窗,与悬浮窗/鲸鱼形态无关)
  BalanceState: 'balance:state',
  BalanceDescribeSites: 'balance:describe-sites',
  BalanceDescribeNewSite: 'balance:describe-new-site',
  BalanceDescribeSiteTypes: 'balance:describe-site-types',
  BalanceSaveSite: 'balance:save-site',
  BalanceRemoveSite: 'balance:remove-site',
  BalanceRefresh: 'balance:refresh',
  BalanceOpenUsage: 'balance:open-usage',
  /** 打开/关闭余额小窗(悬浮窗头部与设置窗口的入口;托盘勾选态跟随) */
  BalanceToggle: 'balance:toggle',
  /** 打开独立账单窗口(余额卡片/胶囊已用行/设置窗口的入口) */
  BalanceBillingOpen: 'balance:billing-open',
  /** 拉取账单报告(现拉现算:sub2api 现场请求用量趋势,可能耗时数秒) */
  BalanceBillingGet: 'balance:billing-get',
  /** 关闭账单窗口(窗口内 Esc/关闭按钮) */
  BalanceBillingClose: 'balance:billing-close',
  /** 渲染层按内容测量的窗口尺寸(主进程按工作区钳制) */
  BalanceResize: 'balance:resize',

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
  // 主进程 → 鲸鱼渲染层事件(只发给鲸鱼窗口 webContents)
  EvWhaleCursor: 'ev:whale-cursor',
  EvWhaleWorkarea: 'ev:whale-workarea',
  EvWhaleCommand: 'ev:whale-command',
  EvWhaleUnread: 'ev:whale-unread',
  // 主进程 → 余额小窗事件
  EvBalanceState: 'ev:balance-state',
  // 主进程 → 悬浮窗:打开余额站点的 Usage 页(先导航视图,再激活对应窗格)
  EvFUsageOpen: 'ev:f-usage-open',
  // 译文弹窗事件(只发给弹窗 webContents)
  EvTranslateResult: 'ev:translate-result'
} as const
