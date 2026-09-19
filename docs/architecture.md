# ChatDeck 架构

> 用最简单的话说：ChatDeck 是一个「套壳浏览器」，左边一列站点列表，右边显示对应的 LLM 网页。每个站点用自己的独立存储保存登录状态，互不干扰。

## 技术栈

Electron（主进程 + WebContentsView）+ Vue 3 + TypeScript + Pinia + electron-vite + Vitest。

## 整体结构

```
┌────────────────────────────────────────────────────────┐
│ BrowserWindow (主窗口)                                  │
│                                                        │
│ ┌────────┐ ┌──────────────────────────┐ ┌───────────┐ │
│ │Sidebar │ │ Workspace                │ │ Drawer    │ │
│ │(HTML)  │ │  ┌────────────────────┐  │ │ (HTML)    │ │
│ │站点列表 │ │  │ 窗格头 (HTML)       │  │ │ 提示词库 / │ │
│ │        │ │  ├────────────────────┤  │ │ 设置      │ │
│ │        │ │  │ WebContentsView    │  │ │           │ │
│ │        │ │  │ (站点原生视图)      │  │ │           │ │
│ │        │ │  └────────────────────┘  │ │           │ │
│ └────────┘ └──┴────────────────────┴──┘ └───────────┘ │
└────────────────────────────────────────────────────────┘
```

**关键点：WebContentsView 是原生层，永远盖在 HTML 上面。** 所以 UI 划分为两类：

1. **永不被遮挡的区域**（纯 HTML）：侧边栏、工具条、窗格头、右侧抽屉。所有交互控件都在这些区域。
2. **站点区域**：主进程把 WebContentsView 放在渲染层算出来的矩形里。加载失败时在视图内部加载本地 `resources/error.html`（重试按钮走 error preload 的 IPC），**而不是**用 HTML 盖上去（盖不住）。

## 双窗口：桌面版 + 悬浮窗

应用内有两个窗口、两个 ViewManager 实例，共用同一批站点会话分区：

```
app（单实例 + 托盘常驻）
├─ MainWindow  桌面版  ── ViewManager#main  ◀─ view:* 通道（桌面 UA）
└─ FloatWindow 悬浮窗  ── ViewManager#float ◀─ fview:* 通道（移动端 UA）
     frame:false + transparent + alwaysOnTop('floating') + skipTaskbar
     渲染层是独立入口 float.html；窗口由 FloatWindowController 惰性创建，
     创建后经 onWindowCreated 回调把 floatViews attach 上去（不 attach 则 setLayout 静默跳过）
```

- **登录态互通**：两个 ViewManager 用同名分区 `persist:provider-<id>`，同名 partition 即同一 session。
- **窄屏适配**：悬浮窗视图用 `webContents.setUserAgent()`（视图级）盖移动端 UA，**不能**用 `session.setUserAgent`（会污染桌面版同分区视图）。厂商自带 `userAgent` 配置优先。
- **隐藏不刷新**：折叠成药丸或切到提示词模式时，站点视图用**零矩形** `{0,0,0,0}` 保持挂载（`setLayout([])` 会 detach→重挂→整页刷新）；悬浮窗关闭主窗时主窗隐藏到托盘，托盘「退出」才真正退出。
- **独立持久化**：悬浮窗位置/展开态/活动站点存 `float-state.json`，与 `ui-state.json` 分文件，避免渲染层整包写 ui-state 时互相覆盖。
- 透明窗口注意：`backgroundColor` 必须 `#00000000`；`ready-to-show` 后再 show（防 Windows 黑底）；折叠高度 64 是 Windows 非可调窗口的系统最小高度，设 48 会被静默抬升。

## 划词翻译（Ctrl+Q · 百度翻译 API）

依附悬浮窗的第三个窗口 + 一条全局热键链路：

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
- **显隐规则**：聚焦（如点击复制）取消自动隐藏；失焦不立即隐藏而是重排 10s 计时——原生 `<select>` 下拉会短暂夺走焦点，直接隐藏会让方向选择无法使用；无交互 10s 自动隐藏。Esc/✕ 随时关闭。
- **凭据**：只在主窗口设置界面填写，存 `userData/translate.user.json`，不进源码；请求只从主进程发起（渲染层 CSP 不放行外网）。
- 取词失败（无选区/该应用 Ctrl+C 非复制语义）静默不弹窗；剪贴板还原覆盖文本与图片，富文本/文件等格式为已知限制。

## 数据流

```
渲染层 (Vue/Pinia)                       主进程
─────────────────                       ─────────────
layout store 计算 viewEntries  ──IPC──▶ ViewManager.setLayout()
  (矩形 = 窗格 - 34px 头)                 ├─ 懒创建 WebContentsView
                                          ├─ setBounds 定位
                                          └─ 不在布局中的视图移出窗口(缓存保留)

站点标题变化 / 焦点变化 / 崩溃  ◀─IPC──  webContents 事件 → hooks
  → 侧边栏小红点 / 高亮活动窗格 / 状态更新

提示词「粘贴」：  渲染层 clipboard.writeText → 关抽屉 → view.paste(活动站点)
                  → 主进程 webContents.focus() + 60ms 后 paste()
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
```

规则：`load-success` 只在 loading 态生效；`reload` 只在 failed/crashed 态转移；loading 中不允许再 reload（防竞态）。

### 2. 布局状态机（`stores/layout.ts`）

```
single ⇄ split2 ⇄ split3
```

- 进入分屏：现有窗格保留，缺位按启用列表顺序补齐；启用的站点数不够则按钮禁用。
- 退回单屏：保留活动窗格。
- 分屏下点侧边栏：替换「活动窗格」的站点；若站点已在其他窗格则两个窗格互换（`assignPane` 纯函数，保证同一站点不重复出现在两个窗格）。
- 拖分割条：以拖动开始的比例为基准（`beginDrag` 快照），`adjustRatios` 纯函数保证最小窗格宽度 280px。

### 3. 矩形计算（`shared/layout.ts`，纯函数，有单测）

`computeRects(container, specs, {gap, minPaneWidth})`：ratio ∈ [0,1] 夹取后归一化；容器小于 min×n 时退化为等分；宽度 0 返回零宽矩形。

## 安全边界

- 渲染层 `contextIsolation: true, sandbox: true`，只经 contextBridge 拿到 `window.api`（接口见 `shared/api.ts`）。
- 站点视图：独立 `persist:provider-<id>` session；UA 统一伪装成 Chrome（去掉 Electron 标识）；权限请求全部拒绝；`window.open` 转到系统浏览器。
- 错误页 preload（`error.ts`）只暴露一个 `reload(id)`，不导入共享模块（保证 preload 单文件——沙箱不支持 chunk）。

## 目录说明

```
resources/            内置默认配置 + 错误页 + 托盘图标（打包时需 extraResources）
scripts/              开发期工具（make-icon.mjs 生成应用图标与托盘图标）
build/                打包资源（icon.ico，electron-builder 默认 buildResources 目录）
src/shared/           前后端共享：类型、IPC 常量、纯函数（merge/layout/viewState/prompts/floatLayout/translate）、API 接口
src/main/             主进程：窗口、floatWindow、translateWindow、translateService、textCapture、tray、ViewManager、IPC、三个 store
src/preload/          contextBridge：index.ts（主 API，桌面版/悬浮窗/译文弹窗共用）、error.ts（错误页重试）
src/renderer/         界面：index.html（桌面版）+ float.html（悬浮窗）+ translate.html（译文弹窗）
src/renderer/src/float/  悬浮窗渲染层：floatStore + FloatApp/FloatHeader/FloatPrompts/FloatPill
src/renderer/src/translate/  译文弹窗渲染层：TranslatePopup
tests/                Vitest 单测（只测 shared 纯函数，88 个用例）
```

## 打包与分发（electron-builder）

`npm run dist` = `electron-vite build` + `electron-builder --win`，配置在 `electron-builder.yml`：

```
app.asar（out/** 打包）        安装目录/resources/（extraResources 平铺）
├─ out/main/index.js           ├─ providers.default.json   ← resourceFile() 读这里
├─ out/preload/{index,error}.js ├─ prompts.default.json       (process.resourcesPath)
└─ out/renderer/{index,float,translate}.html
                               └─ error.html            ← viewManager.errorPagePath()
                                  └─ tray.png / tray@2x.png ← tray.ts 读这里
```

- 产物：`dist/ChatDeck-<ver>-Portable.exe`（免安装双击即用）与 `dist/ChatDeck-Setup-<ver>.exe`（一键安装，per-user）。
- 关键约束：extraResources 的 `to` 必须是 `.`（写成 `resources` 会多套一层，运行时读不到）。
- userData 不变（`%APPDATA%/chatdeck`），打包版与开发版登录态互通。
- 单实例锁在打包版同样生效：重复启动只聚焦已有窗口。

## 持久化位置（%APPDATA%/chatdeck/）

- `providers.user.json` / `prompts.user.json`：用户配置层
- `ui-state.json`：活动站点、布局模式、窗格比例（桌面版）
- `float-state.json`：悬浮窗位置 x/y、展开态、活动站点
- `translate.user.json`：百度翻译 APPID/KEY、语言方向对
- `Partitions/provider-*`：各站点的登录数据（cookie/localStorage），桌面版与悬浮窗共享
