# 迭代记录

## v0.3.1（2026-09-19）

产物轻量化（exe −11%）+ 修复悬浮窗收缩态可拖进任务栏且无法取回的 bug。

### 上版问题

- exe 偏重：Portable/Setup 均 ~78MB（用户要求在不影响功能前提下尽量轻量化，不设硬指标）。
- 用户报告：悬浮窗折叠成药丸后能拖到任务栏底下，松手后被任务栏盖住再也抓不回来，重启也没用（坏位置被持久化）。

### 方法（根因）

- **体积根因**（体积剖析实测）：① `app.asar` 14.9MB 中约 12–13MB 是死重——vue/pinia 是仅有的两个生产依赖，只被渲染层用且已被 vite 打进 bundle，主进程/preload 零引用，但 electron-builder 会把生产依赖整树拷进 asar，连带拖进 @babel/parser(1.9MB)、@babel/types(3.0MB)、@vue/compiler-sfc(2.6MB) 和 150 个 sourcemap；② locales 55 个语言全量 40.4MB（实际只用中英）；③ 未配置 `compression`（默认 normal）。
- **体积处理**：`dependencies` 清空（vue/pinia 移到 devDependencies，asar 14.9 → 0.38MB）；`compression: maximum`；新增 `build/afterPack.js` 在压缩归档前裁掉 en-US/zh-CN 以外的 53 个 .pak（释放 39.3MB）。明确**不删** LICENSES.chromium.html（合规）与 vk_swiftshader/d3dcompiler_47/vulkan-1（GPU 异常机器的软件渲染兜底）。
- **拖动 bug 根因**：悬浮窗拖动走 CSS drag region（Chromium 原生 move loop），主进程仅在「启动还原」和「展开⇄折叠」两条路径有 `clampPoint`，自由拖动全程无钳制；Windows 允许把窗口拖进工作区外，置顶任务栏盖住药丸 → 抓不回；`schedulePositionSave` 还把坏位置原样落盘。
- **拖动修复（用户明确要"拖不下去"而非"松手弹回"）**：挂 `will-move`（手动拖动落地前触发、可 preventDefault；程序性 setBounds 不触发）逐帧钳制——新纯函数 `clampDragBounds`：**底边完全不允许越过工作区底**（拖不进任务栏），左右上允许部分越界但保留 8px 可见条带（不堵死跨显示器拖动）；越界时 `preventDefault()` + `setBounds` 到钳制位置。拖动结束落盘前再用 `clampPoint` 兜底、启动还原沿用 `clampPoint`（历史坏位置在下次启动自动治愈）。

### 踩坑

- **"松手弹回"不满足需求**：首版只在 move 结束（防抖落盘）时钳制，用户指出要的是拖动过程中就压不下去。改用 `will-move` 在每帧移动落地前拦截；若不 preventDefault 直接 setBounds 会与 OS move loop 逐帧互殴（窗口在两位置间抖动），preventDefault 让越界移动根本不生效。
- **electron-vite watcher 偶发写空 out/main**：连续编辑触发两次背靠背重编译，第二次 "0 modules transformed" 却报成功，out/main 被写空，随后重启报 "No electron app entry file found"（v0.3.0 的 out/main 空目录残留同源）。清理 out 重启即恢复，记为 watcher 已知抖动。
- `npm run dev -- --flag` 的 `--` 会被 npm 吃掉，追加 Electron 参数须 `npx electron-vite dev --watch -- --flag`。
- CUA 合成拖拽驱动不了 Chromium drag region（v0.3.0 已知），真实拖拽验证用 PowerShell `mouse_event`（SendInput 级）绝对坐标脚本完成。

### 验证结果

- 回归：typecheck 通过；**95/95** 单测通过（floatLayout 新增 `clampDragBounds` 7 例：界内不变/底边硬钳/顶边 8px 条带/左越界条带/负坐标副屏/展开态大窗口/退化区间）。
- dev GUI（用户实测确认）：药丸拖向任务栏**压不下去**，位置钉在工作区底；正常拖动不受影响。自动化佐证：SendInput 脚本按住药丸向下拖 100px（越过任务栏顶），拖动中截图药丸钉在原位，`float-state.json` 恒为钳制值 (2382,1488=工作区底−64)；启动还原对历史坏位置 (2467,1560) 自动治愈为 (2382,1488)。
- 打包实测：**Portable 78.2 → 69.6MB、Setup 78.4 → 69.7MB（−11%）**；win-unpacked 283.4 → 229.5MB；asar 14.9 → 0.38MB（21 条：三入口产物 + package.json，零 node_modules/零 sourcemap）；locales 55 → 2 个。
- 打包冒烟：win-unpacked 启动主窗渲染完整（10 站点/双屏布局/登录态延续），语言包裁剪无副作用；便携版 SFX 自解压启动正常。

### 遗留问题

- ~69MB 是 Electron 33 运行时的压缩地板（ChatDeck.exe 本体 180MB），再往下只能换 WebView2/Tauri 类方案（重写，超出"不影响功能"范围）。
- 删 vk_swiftshader.dll/d3dcompiler_47.dll/vulkan-1.dll 可再省 ~10.9MB 解压体积，但 GPU 异常机器（虚拟机/RDP）可能白屏，待用户定夺。
- 底边硬钳按"窗口多数落在的显示器"工作区计算：垂直排列的双屏向下跨屏会被挡（水平排列/单屏无影响）。
- 顶/左/右仅保留 8px 可见条带：任务栏在顶部的用户仍可能把药丸大部分藏进任务栏（留 8px 可抓回，不致命）。
- electron-vite watcher 偶发写空 out/main，重启 dev 即恢复（本版两次遇到）。
- v0.3.0 遗留照旧：error 页 retry 通道、方向对切换不重译、富文本剪贴板、Ctrl+Q 全局劫持、QPS 串行等待；v0.1.x 遗留照旧：签名、自动更新、暗色主题、站点重排序、比例记忆、缩放管理。

## v0.3.0（2026-09-19）

悬浮窗划词翻译：全局 Ctrl+Q 取词 → 百度翻译 API → 悬浮窗正上方弹窗只显示译文。

### 上版问题

- v0.2.0 遗留：悬浮窗 error 页重试按钮硬编码桌面版 `view:reload` 通道（本版未动，仍遗留）。

### 方法

- **参考项目**：`E:\Projects\ChineseHoverTranslator`（Chrome MV3 扩展）——百度 API 调用范式全部照搬（`GET /api/trans/vip/translate`、`sign=MD5(appid+q+salt+key)` 小写 hex、salt=毫秒时间戳、15s AbortController 超时、5000 字上限、`from:'auto'` 服务端检测）；其取词（DOM Selection）与弹窗（页面内 DOM）是浏览器专用，Electron 里重做。MD5 用 `node:crypto`，不移植扩展自带 md5.js。
- **全局取词**（`main/textCapture.ts`）：暂存剪贴板文本+图片 → 清空文本位（便于判定复制是否生效）→ `spawn powershell SendKeys '^c'` 发前台窗口 → 250ms 后读 → finally 无条件还原。无原生依赖；取词失败（无选区/Ctrl+C 非复制）返回 null 静默。
- **百度客户端**（`main/translateService.ts`）：`JsonStore('translate.user.json')` 存 appId/appKey/pair；promise 链串行 + 相邻请求 ≥1.1s（免费版 QPS=1）；错误码映射为中文文案（54001 签名错误/54003 频率/52003 未授权等）。
- **译文弹窗**（`main/translateWindow.ts` + 第三渲染入口 `translate.html`）：照抄 FloatWindowController 的透明窗模板；`showInactive()` 不抢焦点；位置=悬浮窗正上方居中 8px（`translatePopupRect` 纯函数：上方放不下→下方，workArea 夹取）；悬浮窗 move/折叠展开→`onMoved` 跟随、隐藏→`onHide` 级联隐藏；`FloatWindowDeps` 新增 `onMoved`/`onHide` 回调。
- **方向选择**（`shared/translate.ts` 纯函数）：`auto` 按 CJK 启发式定目标语种（from 恒 auto 交服务端检测）；弹窗下拉 11 个方向对（自动/中⇄英/日/韩 + 中→俄/法/德/西），切换即 `translate:set-pair` 持久化。
- **凭据**：主窗口设置面板新增「划词翻译」区（复用 add-form 样式），只在 UI 填写、存 userData，不进源码（用户明确要求不用 .env）。
- 单测 +27：方向解析（纯英/纯中/混合/数字/假名/空）、MD5 已知向量、多段拼接、选区清洗、错误码映射、弹窗定位（上方/翻下方/贴边/负坐标副屏/退化工作区）、PAIRS 完整性。

### 踩坑

- **弹窗失焦即隐藏会杀掉方向选择**：点击原生 `<select>` 展开下拉的瞬间窗口失焦，`blur → hide` 让用户永远选不了方向。修复：失焦改为**重排**自动隐藏计时（不立即隐藏），聚焦才取消；已隐藏窗口的 blur 不再排程（否则 hide→blur→hide 每 10s 空转一轮，日志成对出现）。
- **测试进程管理两连坑**：① 上版遗留的 Portable 冒烟实例占着单实例锁，`npm run dev` 秒退（exit 0 无报错）——先 `taskkill` 再启动；② 绕过 npm script 直接 `npx electron-vite dev` 会丢 `--watch`，改了主进程代码不重建，还以为功能坏了。
- **全局热键的触发方式**：CUA 按键是窗口级合成事件，**不会**触发 `globalShortcut`（RegisterHotKey 走系统输入路径）；测试须用 PowerShell `SendKeys '^q'`（SendInput 级）才能命中。真实用户键盘按键无此问题。
- **打包版“弹窗不出”是截图时机假象**：`ELECTRON_ENABLE_LOGGING=1` 重打包加诊断日志后证实 `positionAndShow done, visible= true`——自动化往返（选词→触发→sleep→截图）超过 10s 自动隐藏，弹窗早已正常显示又隐藏。诊断结论：打包链路与 dev 完全一致。
- **剪贴板取词的选区易失**：弹窗交互、窗口切换都会清掉原应用的文本选区，自动化测试里“选词→触发”必须一气呵成；期间 captured=null 属设计内静默。

### 验证结果

- 回归：typecheck（node+web）通过；88/88 单测通过（61 → 88）。
- dev GUI：设置填入凭据保存 → `translate.user.json` 落盘；主窗口/悬浮窗 WebContentsView/其他应用（ZCode）划词均能取词；自动方向中→英（配置→Configuration、应用→Application、回来→come back）与英→中（QPS→频度）正确；切「中 → 日」后同样本文本→「戻る/いつも」；剪贴板标记串在取词后完整还原；点击译文复制成功；弹窗随悬浮窗折叠从 x=2220 精确跟随到 x=2114；悬浮窗隐藏→弹窗级联隐藏（日志 `hide: api`）；10s 无交互自动隐藏；无选区触发静默。
- 打包：`translate.html` + 资源入 asar；凭据与 pair=zh-jp 跨重启、跨 dev/打包版持久化（弹窗选择器回显「中 → 日」）；打包版设置回显已存凭据；打包版全局取词实测（日志 visible=true + 目视弹窗）。
- 产物：`ChatDeck-0.3.0-Portable.exe` / `ChatDeck-Setup-0.3.0.exe`。

### 遗留问题

- 悬浮窗 error 页重试按钮硬编码桌面 `view:reload` 通道（v0.2.0 遗留，未动）。
- 切换方向对不会重译当前文本，需重新划词触发（可存 last text 重跑）。
- 剪贴板借还原只覆盖文本+图片，富文本/文件等格式丢失；PowerShell SendKeys 对个别程序（终端等 Ctrl+C 非复制语义）取不到词，均静默。
- Ctrl+Q 为应用运行期全局劫持，会占用其他软件的退出快捷键（README 已注明）。
- 免费版 QPS=1 已做串行+1.1s 间隔，连续快速触发时第二次需等间隔后才发起（表现为弹窗“翻译中”稍长）。
- electron-builder 收尾阶段偶发一条 cross-spawn ENOENT 噪声栈（产物完好，未影响 exe 生成，待观察）。
- v0.1.x 遗留照旧：代码签名、自动更新、暗色主题、站点重排序、分屏比例记忆、Ctrl+滚轮缩放。

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
