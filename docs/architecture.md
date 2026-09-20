# ChatDeck 架构

> 用最简单的话说：ChatDeck 是一个常驻桌面的「悬浮小窗套壳浏览器」——平时是一颗悬浮药丸，展开后内嵌 LLM 网页；托盘右键放设置等入口；没有主窗口。

## 技术栈

Electron（主进程 + WebContentsView）+ Vue 3 + TypeScript + Pinia + electron-vite + Vitest。

## 整体结构

```
┌──────────────────────────┐
│ FloatWindow (悬浮窗)      │
│ frame:false + transparent │
│ + alwaysOnTop + skipTaskbar│
│ ┌──────────────────────┐ │
│ │ FloatHeader (HTML)    │ │
│ ├──────────────────────┤ │
│ │ WebContentsView       │ │  展开态:站点原生视图
│ │ (站点) / FloatPrompts │ │  提示词模式:纯 HTML
│ ├──────────────────────┤ │
│ │ FloatPill (折叠成药丸) │ │
│ └──────────────────────┘ │
└──────────────────────────┘
```

**关键点：WebContentsView 是原生层，永远盖在 HTML 上面。** 所以 UI 划分为两类：

1. **永不被遮挡的区域**（纯 HTML）：悬浮窗头部、提示词面板、底部条。所有交互控件都在这些区域。
2. **站点区域**：主进程把 WebContentsView 放在渲染层算出来的矩形里。加载失败时在视图内部加载本地 `resources/error.html`（重试按钮走 error preload 的 IPC），**而不是**用 HTML 盖上去（盖不住）。

## 窗口形态：悬浮窗 + 设置窗口 + 译文弹窗

应用没有主窗口，三个窗口各司其职、共用同一批站点会话分区：

```
app（单实例 + 托盘常驻,窗口全关也不退出,退出只走托盘「退出」）
├─ FloatWindow   悬浮窗(默认显示,站点唯一宿主) ── ViewManager ◀─ fview:* 通道（移动端 UA）
├─ SettingsWindow 设置窗口(惰性创建,关闭即销毁)   ── 无站点视图,承载设置/提示词库面板
└─ TranslatePopup 译文弹窗(依附悬浮窗,见下节)     ── 无站点视图
```

- **悬浮窗**：无边框透明置顶小窗，展开(360×620) ⇄ 折叠(药丸 148×64)。启动即按持久化状态显示；`floatStore.sync` 只把**当前活动站点**以非零矩形挂载，其余站点视图按休眠策略销毁/保留。
- **设置窗口**：普通有框窗口（`settingsWindow.ts`），渲染层入口 `settings.html`，顶部标签页「设置 / 提示词库」，内部复用 `SettingsPanel`/`PromptPanel`/`PromptEditor`/`PromptFill` 组件（与悬浮窗共用 stores）。入口三处：托盘「设置…」、悬浮窗头部齿轮、`app:open-settings` IPC；已开则聚焦。
- **登录态互通**：站点视图与历史桌面版用同名分区 `persist:provider-<id>`，同名 partition 即同一 session，历史登录数据直接沿用。
- **移动端 UA**：悬浮窗视图用 `webContents.setUserAgent()`（视图级）盖移动端 UA 匹配 360 宽面板，**不能**用 `session.setUserAgent`（会污染同分区其他视图）。厂商自带 `userAgent` 配置优先。
- **隐藏不刷新**：折叠成药丸或切到提示词模式时，站点视图用**零矩形** `{0,0,0,0}` 保持挂载（`setLayout([])` 会 detach→重挂→整页刷新）。
- **独立持久化**：悬浮窗位置/展开态/活动站点存 `float-state.json`，不与其它配置混写。
- **拖动硬钳制**：`will-move`（手动拖动落地前触发，程序性 setBounds 不触发）逐帧钳制位置（`shared/floatLayout.ts` 的 `clampDragBounds` 纯函数）——底边完全不允许越过工作区底（拖不进任务栏），左右上允许部分越界但保留 8px 可见条带（兼顾跨显示器拖动）；拖动结束落盘前再用 `clampPoint` 兜底钳制并持久化，启动还原位置同样过 `clampPoint`（历史坏位置自动治愈）。
- **久跑自愈**：透明窗口在锁屏/休眠/显卡驱动重置后 DWM 合成表面可能失效（整窗透明"消失"，但 `isVisible()` 仍为 true，托盘 toggle 第一击反而执行隐藏），且 'floating' 置顶级别可能丢失。四层防护：`show()` 每次重新断言置顶并 `webContents.invalidate()` 强制重绘；`powerMonitor` resume/unlock-screen 与 GPU 进程崩溃（`child-process-gone`）触发 `heal()`（hide→show 重建表面）；悬浮窗自身页面崩溃（`render-process-gone`）经 10s 节流后**重建整个窗口**（重建前 `onDetachViews` 把站点视图摘下留缓存，新页面 boot 后 `floatStore.sync → setLayout` 自动重挂）；`display-removed`/`display-metrics-changed` 触发 `reclamp()` 把窗口夹回现存工作区。另有 `setVisibleOnAllWorkspaces(true)`：虚拟桌面切换/全屏应用不丢胶囊。
- **后台站点休眠（内存优化核心）**：站点视图（WebContentsView）一旦创建就是一整个 Chromium 渲染进程（100~300MB），久跑内存增长的大头。每站点可配置 `autoSleepMinutes`（0=永不休眠；内置默认写在 providers.default.json——DeepSeek 0、其余 5；用户层可覆盖，自定义站点缺省回退 `DEFAULT_AUTO_SLEEP_MINUTES=5`，设置页每站点下拉可调）。主进程每 60s 扫一遍 ViewManager：视图「可见」= 以非零矩形挂在宿主窗口上且窗口可见未最小化（折叠零矩形/被切走/窗口隐藏都算不可见）；不可见时长超过该站点阈值即销毁其 webContents（状态机走 `sleep` 事件 → `sleeping`，`render-process-gone` 处理器有 `views.get(id)===mv` 守卫防销毁瞬间误报 crashed）。切回该站点时 `ensureView` 自动重建并重载——**登录态保留在 persist 分区，但页面运行状态（滚动位置/未发送草稿）丢失**。
- **删除站点彻底清理**：`ProvidersRemove` 确认删除生效（自定义站点）后，ViewManager `discardProvider`（销毁视图 + 忘记注册，`discardView` 与 clearData/休眠共用一套摘除→延迟 close→广播流程）+ `providers.clearData` 清空分区存储，不残留孤儿分区。分区存储只由 `ProviderStore.clearData` 清一处。
- **ProviderStore 内存缓存（CPU 优化）**：`list()` 结果缓存（save/remove/init 失效）——`FViewSetLayout` 每次都调 `ensureProviders → providers.list()`，而浮窗 sync 在折叠/展开切换时会触发，原先等于频繁磁盘读+merge。`ProvidersSave`/`ProvidersList` 会把最新 Provider 快照同步注册进管理器（休眠阈值/UA 改动立即生效）。
- **dev watcher 防抖 + 守卫**：main/preload 的 `build.watch.buildDelay: 400` 合并快速连续编辑（rollup watch 对失败/空重建会删除上一轮产物，与重启竞态曾导致 out/main 写空、dev 死亡）；`scripts/patch-electron-vite.mjs`（postinstall 重放）给 electron-vite 重启逻辑加"入口产物缺失则跳过本次重启"的守卫。
- 透明窗口注意：`backgroundColor` 必须 `#00000000`；`ready-to-show` 后再 show（防 Windows 黑底）；折叠高度 64 是 Windows 非可调窗口的系统最小高度，设 48 会被静默抬升。

## 划词翻译（Ctrl+Q · 百度翻译 API）

依附悬浮窗的一条全局热键链路：

```
Ctrl+Q (globalShortcut, 系统级)
  └─ textCapture: 存剪贴板(文本+图片) → 清空文本位 → PowerShell SendKeys '^c'
                  → 读剪贴板 → 无条件还原        （全局取词,任意应用可用）
  └─ TranslateService: translate.user.json(appId/appKey/pair)
        GET fanyi-api.baidu.com/api/trans/vip/translate
        sign = MD5(appid+q+salt+key)；from='auto' 服务端检测
        请求串行 + 相邻间隔 ≥1.1s（免费版 QPS=1）；15s 超时；单次 5000 字
  └─ TranslatePopup: 平时隐藏的小窗，显示在悬浮窗正上方（8px 间距居中，
        上方放不下落到下方），showInactive 不抢焦点
```

- **方向解析**（`shared/translate.ts` 纯函数）：`auto` = 含 CJK（汉字/假名/谚文）→ 目标英文，否则 → 目标中文；显式语言对（中↔英/日/韩、中→俄/法/德/西）原样直传。
- **弹窗只显示译文**；点击译文复制；方向选择器切换即持久化（`translate:set-pair`）。
- **跟随与级联**：悬浮窗 move/折叠展开（防抖后）→ `onMoved` → 弹窗重定位；悬浮窗隐藏 → `onHide` → 弹窗隐藏；悬浮窗未创建时 Ctrl+Q 直接忽略。
- **显隐规则**：聚焦（如点击复制）取消自动隐藏；失焦不立即隐藏而是重排 10s 计时——原生 `<select>` 下拉会短暂夺走焦点，直接隐藏会让方向选择无法使用；无交互 10s 自动隐藏。Esc/✕ 随时关闭。弹窗隐藏后再闲置 10 分钟整体销毁释放渲染进程，下次划词重建（lastState 存主进程不丢失）。
- **凭据**：只在设置窗口填写，存 `userData/translate.user.json`，不进源码；请求只从主进程发起（渲染层 CSP 不放行外网）。
- 取词失败（无选区/该应用 Ctrl+C 非复制语义）静默不弹窗；剪贴板还原覆盖文本与图片，富文本/文件等格式为已知限制。

## 数据流

```
渲染层 (Vue/Pinia)                       主进程
─────────────────                       ─────────────
floatStore 计算 viewEntries    ──IPC──▶ ViewManager.setLayout()
  (活动站点矩形 = floatChatRect)          ├─ 懒创建 WebContentsView
                                          ├─ setBounds 定位
                                          └─ 不在布局中的视图移出窗口(缓存保留)

站点标题变化 / 焦点变化 / 崩溃  ◀─IPC──  webContents 事件 → hooks
  → 头部厂商点未读小红点 / 状态点

提示词「粘贴」：  设置窗口 clipboard.writeText → fview.paste()
                  → 主进程取悬浮窗活动站点 → focus + 60ms 后 paste()
```

## 配置合并（默认 + 用户层）

```
resources/providers.default.json ─┐
                                  ├─ mergeWithUserLayer() ─▶ 最终列表
userData/providers.user.json     ─┘   (覆盖 + 自定义 + 删除)
```

- 同一机制用于提示词库（`prompts.user.json`，多一个 deletedIds）。
- 写入原子化：先写 `.tmp` 再 rename（见 `jsonStore.ts`）。
- 内置默认不可真删，只能停用/覆盖；自定义条目附加在尾部。

## 状态机

### 1. 站点视图生命周期（`shared/viewState.ts`，纯函数，有单测）

```
idle ─attach─▶ loading ─load-success─▶ ready
                 │load-failed            │load-failed
                 ▼                       ▼
               failed ◀─────────────────┘
                 │reload                crash（任意态 → crashed）
                 ▼                       ▼
              loading ◀──reload────── crashed
detach（任意态 → idle，仅移出窗口）
sleep（任意态 → sleeping，视图已销毁释放内存，切回时经 attach 重建重载）
```

规则：`load-success` 只在 loading 态生效；`reload` 只在 failed/crashed 态转移；loading 中不允许再 reload（防竞态）；`attach` 从 idle/sleeping 都进入 loading（sleeping 的视图已销毁，由 ensureView 重建）。后台休眠判定 `shouldSleepNow` 是同文件纯函数：可见放行，不可见且距上次可见 ≥ 阈值即休眠，阈值 ≤0 永不休眠。

### 2. 悬浮窗状态机（`float/floatStore.ts`）

```
展开 ⇄ 折叠（药丸）：窗口尺寸切换，位置持久化
chat ⇄ prompts：站点视图矩形 ⇄ 零矩形隐藏挂载（HTML 提示词面板盖位）
活动站点：activate(id) → clearUnread + fview.setActive + sync
```

## 安全边界

- 渲染层 `contextIsolation: true, sandbox: true`，只经 contextBridge 拿到 `window.api`（接口见 `shared/api.ts`）。
- 站点视图：独立 `persist:provider-<id>` session；UA 统一伪装成 Chrome（去掉 Electron 标识）；权限请求全部拒绝；`window.open` 转到系统浏览器。
- 错误页 preload（`error.ts`）只暴露一个 `reload(id)`，不导入共享模块（保证 preload 单文件——沙箱不支持 chunk）。

## 目录说明

```
resources/            内置默认配置 + 错误页 + 托盘图标（打包时需 extraResources）
scripts/              开发期工具（make-icon.mjs 生成应用/托盘图标；patch-electron-vite.mjs 给 dev watcher 空重建打守卫补丁，postinstall 自动执行）
build/                打包资源（icon.ico，electron-builder 默认 buildResources 目录）
src/shared/           前后端共享：类型、IPC 常量、纯函数（merge/viewState/prompts/floatLayout/translate）、API 接口
src/main/             主进程：floatWindow、settingsWindow、translateWindow、translateService、textCapture、tray、ViewManager、IPC、两个 store
src/preload/          contextBridge：index.ts（主 API，悬浮窗/设置窗口/译文弹窗共用）、error.ts（错误页重试）
src/renderer/         界面：settings.html（设置窗口）+ float.html（悬浮窗）+ translate.html（译文弹窗）
src/renderer/src/float/     悬浮窗渲染层：floatStore + FloatApp/FloatHeader/FloatPrompts/FloatPill
src/renderer/src/settings/  设置窗口渲染层：SettingsApp（标签页壳,复用 components/ 下面板）
src/renderer/src/translate/ 译文弹窗渲染层：TranslatePopup
tests/                Vitest 单测（shared 纯函数 + 主进程 store/ViewManager（electron 打桩），102 个用例）
```

## 打包与分发（electron-builder）

`npm run dist` = `electron-vite build` + `electron-builder --win`，配置在 `electron-builder.yml`：

```
app.asar（out/** 打包）        安装目录/resources/（extraResources 平铺）
├─ out/main/index.js           ├─ providers.default.json   ← resourceFile() 读这里
├─ out/preload/{index,error}.js ├─ prompts.default.json       (process.resourcesPath)
└─ out/renderer/{settings,float,translate}.html
                               └─ error.html            ← viewManager.errorPagePath()
                                  └─ tray.png / tray@2x.png ← tray.ts 读这里
```

- 产物：`dist/ChatDeck-<ver>-Portable.exe`（免安装双击即用）与 `dist/ChatDeck-Setup-<ver>.exe`（一键安装，per-user）。
- 关键约束：extraResources 的 `to` 必须是 `.`（写成 `resources` 会多套一层，运行时读不到）。
- userData 不变（`%APPDATA%/chatdeck`），打包版与开发版登录态互通。
- 单实例锁在打包版同样生效：重复启动唤起悬浮窗。

体积控制（v0.3.1 起，三件套缺一不可）：
- `package.json` 的 `dependencies` 必须保持为空——vue/pinia 只被渲染层用且已由 vite 打进 bundle，若挪回 dependencies 会被 electron-builder 整树拷进 asar（曾把 asar 撑到 14.9MB，其中 @babel/parser、@vue/compiler-sfc 等编译器链全是死重）。主进程将来要引运行时依赖时才移回，并确认确有运行时 require。
- `compression: maximum`（7z/NSIS 最高 LZMA）。
- `afterPack: build/afterPack.js`：压缩归档前裁掉 locales/ 下除 en-US、zh-CN 外的全部 .pak（Chromium 内置 UI 字符串，缺失语言回退英文，页面渲染无关）；v0.3.3 起另删 `vk_swiftshader.dll`、`vk_swiftshader_icd.json`、`vulkan-1.dll`（SwiftShader/Vulkan 软件渲染兜底，正常 GPU 机器走 ANGLE D3D11 用不到）。`d3dcompiler_47.dll` 必须保留——它是 ANGLE 运行时编译 D3D 着色器用的，删了任何机器都会渲染异常。代价：GPU 进程崩溃后无法软件渲染续命、无 Vulkan 驱动时 WebGPU 不可用、RDP/虚拟机可能白屏。

## 持久化位置（%APPDATA%/chatdeck/）

- `providers.user.json` / `prompts.user.json`：用户配置层
- `float-state.json`：悬浮窗位置 x/y、展开态、活动站点
- `translate.user.json`：百度翻译 APPID/KEY、语言方向对
- `Partitions/provider-*`：各站点的登录数据（cookie/localStorage）
- `ui-state.json`：已废弃（桌面版布局残留），不再读写；可手动删除
