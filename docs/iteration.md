# 迭代记录

## v0.2.0（2026-09-19）

新增悬浮窗版应用（迷你对话 + 提示词速查，暗色玻璃科幻风）。

### 上版问题

- 只有一种桌面窗口形态，无法在其他应用之上随手唤起对话/查提示词（新需求）。
- 打包安装器已就绪（v0.1.1 遗留已清零）；签名/自动更新仍遗留。

### 方法

- **双窗口双管理器**：同一应用内新增 FloatWindow（frame:false + transparent + alwaysOnTop('floating') + skipTaskbar，360×620 展开 ⇄ 148×64 药丸折叠），第二个 `ViewManager` 实例绑定其 contentView。同名分区 `persist:provider-<id>` 即同一 session，**登录态与桌面版天然互通**。通道按作用域拆分：`view:*`（桌面）/ `fview:*`（悬浮）/ `float:*`（窗口控制），preload 复用同一单文件入口。
- **窄屏适配**：悬浮窗视图用 `webContents.setUserAgent()`（视图级）盖移动端 UA 适配 360px 窄幅；绝不能动 `session.setUserAgent`（会污染桌面版同分区视图）；厂商自带 `userAgent` 配置优先。
- **隐藏不刷新**：折叠/切提示词模式时站点视图用零矩形 `{0,0,0,0}` 保持挂载（`setLayout([])` 会 detach→重挂→整页刷新）。悬浮窗存活时关主窗 = 隐藏到托盘，托盘「退出」才真退；新增 `src/main/tray.ts`（托盘菜单：主窗口/悬浮窗开关/退出）。
- **渲染层独立入口**：`electron.vite.config.ts` renderer 段加多 HTML 入口（index.html + float.html），float 分包互不拖累；float 端有独立 pinia store（floatStore：展开/折叠、对话/提示词模式、活动站点、事件桥）。
- **独立持久化**：悬浮窗位置/展开态/活动站点写 `float-state.json`（独立 JsonStore + 串行化写入队列），与 `ui-state.json` 分文件避免整包覆盖互踩；moved 事件 400ms 防抖保存。
- **视觉**：tokens.css 新增暗色玻璃令牌组（`--glass-*` 半透明深底、微光描边、赤陶辉光、mono 微标签、150ms 微动效）；折叠药丸呼吸光点；窗口 CSS 圆角 16px，站点视图区域留 10px padding 不贴圆角。
- 提示词速查抽屉复用 `stores/prompts` 与 `@shared/prompts` 纯函数（extractPlaceholders/renderContent）；复制后 toast 提示。
- `make-icon.mjs` 追加导出 `resources/tray.png`(16px) + `tray@2x.png`(32px)，运行时经 `resourceFile()` 读取（打包由 extraResources `to: "."` 覆盖，v0.1.1 的坑位直接复用）。

### 踩坑

- **floatViews 未 attach**：悬浮窗惰性创建晚于 bootstrap，`ViewManager.setLayout` 里 `if (!this.win) return` 静默跳过 → 玻璃壳渲染正常但站点视图永远不挂载。修复：FloatWindowController 增加 `onWindowCreated` 回调，创建后把 floatViews attach 上去。教训：静默 return 的防御分支会让「忘装配」这类错误不可见。
- **Windows 非可调窗口最小高度**：折叠药丸设 48 高被系统静默抬到 64 → 药丸下方出现 16px 透明带。把 `FLOAT_PILL.height` 定为 64、圆角 32 适配。
- 透明窗口约束（调研确认）：`backgroundColor` 必须 `#00000000`、`ready-to-show` 后再 show（防 Windows 黑底）、`resizable:false`（防透明合成被破坏）；`backgroundMaterial: acrylic` 与 `transparent` 互斥（Win11 22H2+），本版玻璃感用纯 CSS 实现。

### 验证结果

- 回归：typecheck（node+web 双工程）通过；61/61 单测通过（新增 floatLayout 纯函数 12 例：聊天/提示词矩形边界、clampPoint 含负坐标副屏与单/双向超大窗口）。
- dev GUI 全流程：侧边栏「悬浮窗」唤起 → 360×620 落主屏右下角 → DeepSeek **移动版**页面加载、登录态延续 → 切豆包（光点辉环联动）→ 提示词速查（搜索/分类/26 卡片）→ 「写代码」占位符填空（未填满时复制按钮禁用）→ 复制内容剪贴板逐字验证 → 折叠药丸/展开 → 头部拖拽移动 → 对话⇄提示词往返页面**不重载**（零矩形保挂载，推荐 feed 前后一致）。
- 置顶验证：悬浮窗压在处于前台焦点的其他应用之上渲染。
- 持久化验证：重启后悬浮窗以折叠态出现在记忆位置，活动站点（豆包）保留。
- 关闭语义：悬浮窗存活时关主窗 → 窗口隐藏、进程存活；第二实例启动 → 已有实例主窗口重新显示并聚焦（单实例链路正常）。
- 桌面版回归：双屏分屏 + 窗格头/分割条正常，与悬浮窗共存互不干扰。
- 打包复测：`npm run dist` 产出 v0.2.0 两个 exe；win-unpacked 启动 → float.html 从 app.asar 正确加载、resources 根层含 tray.png → 悬浮窗全功能可用。

### 遗留问题

- exe 未做代码签名（SmartScreen）；未接 electron-updater（承接 v0.1.1）。
- 悬浮窗站点视图加载失败时，error.html 内置「重试」按钮硬编码走桌面版 `view:reload` 通道，在悬浮窗内会重载桌面版同名视图（悬浮窗侧需手动切站点刷新）；error preload 参数化待做。
- 悬浮窗提示词只有「复制」没有「粘贴到桌面版当前站点」；桌面版关闭时悬浮窗无法粘贴（后续可加跨窗口 paste 通道）。
- acrylic 系统级模糊与 transparent 互斥未采用，玻璃感为纯 CSS（无桌面真模糊）。
- 悬浮窗与桌面版焦点互斥（Electron 单焦点），切换有轻微焦点跳动。
- 未做暗色主题（桌面版）；未做站点重排序；分屏切换重置比例；Ctrl+滚轮缩放未统一管理（承接 v0.1.x）。

## v0.1.1（2026-09-19）

打包为可双击运行的 exe。

### 上版问题

- 只能以 `npm run dev` / `build + preview` 命令行方式运行（iteration v0.1.0 遗留）。

### 方法

- 引入 electron-builder 26（`electron-builder.yml` 配置，不打进应用代码）：`files: out/**`（asar），`extraResources` 把 `resources/`（error.html + 两个默认配置 JSON）拷到安装目录 resources 根层，`win.icon` 用脚本生成的 `build/icon.ico`。
- 产物双形态：`ChatDeck-<ver>-Portable.exe`（单文件免安装，双击即用）+ `ChatDeck-Setup-<ver>.exe`（一键安装器，装到 `%LOCALAPPDATA%\Programs\ChatDeck`，自动建桌面/开始菜单快捷方式，无需管理员）。
- 脚本：`npm run dist`（构建 + 打包两个 exe）、`npm run icon`（重新生成图标）、`npm run dist:dir`（只出 win-unpacked 便于冒烟）。
- 图标 `scripts/make-icon.mjs`：纯像素数学绘制（赤陶色圆角底 + 双窗格分屏意象），3×3 超采样抗锯齿，7 个尺寸嵌入单个 .ico，无字体/无原生依赖。
- 国内镜像：`electronDownload.mirror`（Electron 发行包）与 `ELECTRON_BUILDER_BINARIES_MIRROR`（NSIS/winCodeSign 二进制，cross-env 注入）均指向 npmmirror。

### 踩坑

- `extraResources` 的 `to: resources` 会把文件拷成 `resources/resources/`（多套一层），而代码 `resourceFile()` 读取的是 `process.resourcesPath` 根层 → 打包版会得到空厂商列表。**`to` 必须为 `.`**。已在打包后 `ls win-unpacked/resources/` 验证。

### 验证结果

- 回归：typecheck（node+web 双工程）通过；49/49 单测通过。
- `npm run dist` 产出 `ChatDeck-0.1.1-Portable.exe`（78MB）与 `ChatDeck-Setup-0.1.1.exe`（78MB）。
- GUI 冒烟（打包版）：win-unpacked 启动 → 侧边栏 10 站点全部渲染（extraResources 生效）→ DeepSeek 真实页面加载、登录态从开发版延续（userData 共用 `%APPDATA%\chatdeck`）→ 切换豆包正常（侧边栏高亮/窗格头/工具条联动）→ 恢复上次布局状态（ui-state 持久化生效）。
- 单实例锁：重复启动第二个实例后进程数不变（第二实例自行退出，已有窗口聚焦）。
- portable 版双击启动正常，首次自解压约数秒。

### 遗留问题

- exe 未做代码签名，首次运行 Windows SmartScreen 可能提示，需点「更多信息 → 仍要运行」。
- 未做自动更新（latest.yml/blockmap 已随构建产出，可接 electron-updater）。
- 「粘贴到输入框」依赖站点输入框持有焦点，个别站点若粘贴无效需手动 Ctrl+V（剪贴板内容一致）。
- 未做暗色主题；未做站点重排序。
- 分屏切换会重置窗格比例（保留比例需要更复杂的 ratio 推导，价值低暂缓）。
- 站点内 Ctrl+滚轮缩放是 Electron 默认行为，只影响单个站点视图，未统一管理。

## v0.1.0（2026-09-18）

首个版本。

### 功能

- 内置 10 个国内 LLM 站点（DeepSeek、Kimi、豆包、通义千问、智谱清言、腾讯元宝、文心一言、讯飞星火、海螺AI、秘塔AI搜索），配置驱动，可在设置中启停、新增自定义站点、清除单个站点登录数据。
- 单屏 + 双屏/三屏分屏对比，分割条可拖动（最小窗格宽度 280px），布局与比例持久化。
- 每站点独立持久 session，登录态跨重启保留；Ctrl+1~9 快捷切换；后台站点标题变化时侧边栏小红点。
- 提示词库：内置 26 条预设（编程/写作/翻译/分析/学习/生活六类），支持占位符 `{名称}` 填空、复制、粘贴到当前站点输入框（走剪贴板 + `webContents.paste()`，不做 DOM 注入）、增删改、恢复默认。
- 站点加载失败/崩溃时展示内置错误页，可一键重试。
- Claude 风格 UI：米白底色、赤陶色点缀、衬线标题。

### 本版本的实现决策

- 选 Electron 而非 Tauri 2：WebContentsView + persist partition 对多站点 cookie 隔离最成熟；参考同类开源项目（ChatALL、LLM-God）均为 Electron 路线。
- 交互模式为「纯内嵌多标签」：不向站点注入 JS，「粘贴」能力通过系统剪贴板 + Electron 原生 paste 命令实现，站点改版不会导致功能失效。
- 抽屉式面板（提示词/设置）以「挤占宽度」而不是「悬浮遮挡」实现——WebContentsView 是原生层，HTML 无法盖在其上。
- **坐标对齐（开发期踩坑）**：`WebContentsView.setBounds` 的坐标系与渲染层页面坐标系一致（均以窗口内容区为原点），无需任何标题栏补偿；渲染层一侧的窗格/窗格头/分割条必须用 `position: fixed`（页面坐标）定位，若作为 `.panes`（relative 容器）的 absolute 子元素会用页面坐标当容器坐标造成双重偏移。经插桩日志（sent vs `view.getBounds()`）实测确认。dev 模式需 `electron-vite dev --watch` 才会在主进程改动后自动重启。

### 验证结果

- 单元测试 49 个全部通过（merge 合并策略、computeRects 边界含容器过小/零宽/NaN、视图状态机全部转移、assignPane 互换、占位符渲染含 `$` 特殊字符）。
- `vue-tsc` 类型检查（node + web 两个工程）通过。
- `electron-vite build` 通过；preload 输出确认为单文件（无 chunk，沙箱可加载）。
- 开发模式 GUI 实测通过（200% 缩放屏、1440×900 窗口）：
  - 侧边栏 10 站点渲染与切换（DeepSeek、豆包真实页面加载正常，登录态分区隔离）；
  - 双屏分屏 + 分割条拖动实时调整比例，窗格头/视图/HTML 三者像素级对齐（坐标插桩验证 sent == `getBounds()`）；
  - 提示词库：分类筛选、卡片、占位符填空 + 实时预览；
  - 「复制」写入剪贴板内容逐字验证正确；「复制并粘贴」端到端验证：抽屉自动收起、文本落入豆包站点输入框；
  - 打开抽屉时站点视图正确让位（ResizeObserver → setLayout 联动）。

### 遗留问题

- 「粘贴到输入框」依赖站点输入框持有焦点，个别站点若粘贴无效需手动 Ctrl+V（剪贴板内容一致）。
- 未做暗色主题；未做站点重排序；未打包安装程序（→ v0.1.1 完成）。
- 分屏切换会重置窗格比例（保留比例需要更复杂的 ratio 推导，价值低暂缓）。
- 站点内 Ctrl+滚轮缩放是 Electron 默认行为，只影响单个站点视图，未统一管理。
