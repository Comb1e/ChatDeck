# ChatDeck 架构

> 用最简单的话说：ChatDeck 是一个常驻桌面的「悬浮小窗套壳浏览器」+ 一只小鲸鱼——平时鲸鱼在桌面上游，点一下它展开内嵌 LLM 网页的悬浮窗；收起后鲸鱼在悬浮窗原来的位置破水浮出。托盘右键放设置等入口；没有主窗口。

## 技术栈

Electron（主进程 + WebContentsView）+ Vue 3 + TypeScript + Pinia + electron-vite + Vitest。

鲸鱼（悬浮窗压缩形态）渲染层移植自 whale-pet 项目（纯 TypeScript 行为脚本，不用 Vue）。

## 整体结构

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│ FloatWindow (悬浮窗·展开态)  │        │ WhaleWindow (鲸鱼·压缩态)     │
│ 360×620 frame:false         │        │ 覆盖主显示器工作区            │
│ + transparent + alwaysOnTop │        │ 默认鼠标穿透(forward)         │
│ ┌────────────────────────┐ │        │ ┌──────────────────────────┐ │
│ │ FloatHeader (HTML)      │ │        │ │ SVG 鲸鱼 + Canvas 特效    │ │
│ ├────────────────────────┤ │        │ │ (水花/气泡/涟漪/Zzz/爱心) │ │
│ │ WebContentsView (站点)  │ │        │ ├──────────────────────────┤ │
│ │ 或 FloatPrompts (HTML)  │ │        │ │ 未读气泡(HTML,头顶跟随)  │ │
│ ├────────────────────────┤ │        │ └──────────────────────────┘ │
│ │ 底部提示词条 (HTML)      │ │        │ 悬停鲸鱼 → 开启窗口交互        │
│ └────────────────────────┘ │        │ 单击鲸鱼 → 展开悬浮窗          │
└────────────────────────────┘        └──────────────────────────────┘
        两种形态互斥显示（收起/展开由主进程编排）
```

**关键点：WebContentsView 是原生层，永远盖在 HTML 上面。** 所以悬浮窗 UI 划分为两类：

1. **永不被遮挡的区域**（纯 HTML）：悬浮窗头部、提示词面板、底部条。所有交互控件都在这些区域。
2. **站点区域**：主进程把 WebContentsView 放在渲染层算出来的矩形里。加载失败时在视图内部加载本地 `resources/error.html`（重试按钮走 error preload 的 IPC），**而不是**用 HTML 盖上去（盖不住）。

## 窗口形态：鲸鱼 + 悬浮窗 + 设置窗口 + 译文弹窗

应用没有主窗口，四个窗口各司其职、共用同一批站点会话分区：

```
app（单实例 + 托盘常驻,窗口全关也不退出,退出只走托盘「退出」）
├─ WhaleWindow    鲸鱼窗口(压缩形态,启动默认显示)  ── 无站点视图
├─ FloatWindow    悬浮窗(展开形态,站点唯一宿主)     ── ViewManager ◀─ fview:* 通道（移动端 UA）
├─ SettingsWindow 设置窗口(惰性创建,关闭即销毁)      ── 无站点视图,承载设置/提示词库面板
└─ TranslatePopup 译文弹窗(依附悬浮窗位置,见下节)    ── 无站点视图
```

- **形态互斥**：鲸鱼可见 ⇔ 悬浮窗隐藏，反之亦然。切换由主进程 `index.ts` 的 `expandFloat()` / `collapseToWhale()` 编排（IPC `whale:expand` / `float:collapse`、托盘「悬浮窗 ⇄ 鲸鱼」、头部收起按钮都走同一对函数）。
  - **展开**（鲸鱼 → 悬浮窗）：鲸鱼渲染层单击后把世界姿态经 `whale:expand` 上报，主进程把鲸鱼点换算成屏幕坐标 → 悬浮窗以「水平居中于鲸鱼、顶部在鲸鱼上方约 120px」落位（`clampPoint` 夹进工作区），显示悬浮窗并隐藏鲸鱼。
  - **收起**（悬浮窗 → 鲸鱼）：取悬浮窗中心屏幕坐标 → 隐藏悬浮窗、显示鲸鱼 → 发 `ev:whale-command {type:'surface'}`，鲸鱼在该点执行「破水浮出」过渡（与招牌动作的浮出视觉同一套编排），浮出后回到正常行为循环。
- **鲸鱼窗口**（`whaleWindow.ts`，规格与 whale-pet 一致）：透明无边框窗口**覆盖主显示器工作区**，鲸鱼完全在 Chromium 内游动（原生窗口不动，避免原生移动与渲染合成不同步）。默认 `setIgnoreMouseEvents(true, {forward: true})` **鼠标穿透**；渲染层 hitTest 命中鲸鱼/未读气泡时才 `setInteractive(true)` 接管鼠标（离开即恢复穿透）。渲染层初始化完成（`whale:ready`）后才显示，避免闪空。`display-metrics-changed` 时窗口跟随工作区并通知渲染层。
- **悬浮窗**：无边框透明置顶小窗，**只有展开态 360×620**（旧的 148×64 药丸形态已删除，由鲸鱼取而代之）。启动时以 `ensureCreated()` **隐藏创建**——渲染层保持存活，站点视图加载、未读统计、快速展开都依赖它；`floatStore.sync` 只把**当前活动站点**以非零矩形挂载，其余站点视图按休眠策略销毁/保留。
- **设置窗口**：普通有框窗口（`settingsWindow.ts`），渲染层入口 `settings.html`，顶部标签页「设置 / 提示词库」，内部复用 `SettingsPanel`/`PromptPanel`/`PromptEditor`/`PromptFill` 组件（与悬浮窗共用 stores）。入口三处：托盘「设置…」、悬浮窗头部齿轮、`app:open-settings` IPC；已开则聚焦。
- **登录态互通**：站点视图与历史桌面版用同名分区 `persist:provider-<id>`，同名 partition 即同一 session，历史登录数据直接沿用。
- **移动端 UA**：悬浮窗视图用 `webContents.setUserAgent()`（视图级）盖移动端 UA 匹配 360 宽面板，**不能**用 `session.setUserAgent`（会污染同分区其他视图）。厂商自带 `userAgent` 配置优先。
- **隐藏不刷新**：切到提示词模式时，站点视图用**零矩形** `{0,0,0,0}` 保持挂载（`setLayout([])` 会 detach→重挂→整页刷新）。
- **独立持久化**：悬浮窗位置与活动站点存 `float-state.json`，不与其它配置混写。
- **拖动硬钳制**：`will-move`（手动拖动落地前触发，程序性 setBounds 不触发）逐帧钳制位置（`shared/floatLayout.ts` 的 `clampDragBounds` 纯函数）——底边完全不允许越过工作区底（拖不进任务栏），左右上允许部分越界但保留 8px 可见条带（兼顾跨显示器拖动）；拖动结束落盘前再用 `clampPoint` 兜底钳制并持久化，启动还原位置同样过 `clampPoint`（历史坏位置自动治愈）。
- **久跑自愈**：透明窗口在锁屏/休眠/显卡驱动重置后 DWM 合成表面可能失效（整窗透明"消失"，但 `isVisible()` 仍为 true，托盘 toggle 第一击反而执行隐藏），且 'floating' 置顶级别可能丢失。四层防护（鲸鱼窗口与悬浮窗同款）：`show()` 每次重新断言置顶并 `webContents.invalidate()` 强制重绘；`powerMonitor` resume/unlock-screen 与 GPU 进程崩溃（`child-process-gone`）触发 `heal()`（hide→show 重建表面）；悬浮窗自身页面崩溃（`render-process-gone`）经 10s 节流后**重建整个窗口**（重建前 `onDetachViews` 把站点视图摘下留缓存，新页面 boot 后 `floatStore.sync → setLayout` 自动重挂）；`display-removed`/`display-metrics-changed` 触发 `reclamp()`/`syncWorkarea()` 把窗口夹回现存工作区。另有 `setVisibleOnAllWorkspaces(true)`：虚拟桌面切换/全屏应用不丢窗口。
- **后台站点休眠（内存优化核心）**：站点视图（WebContentsView）一旦创建就是一整个 Chromium 渲染进程（100~300MB），久跑内存增长的大头。每站点可配置 `autoSleepMinutes`（0=永不休眠；内置默认写在 providers.default.json——DeepSeek 0、其余 5；用户层可覆盖，自定义站点缺省回退 `DEFAULT_AUTO_SLEEP_MINUTES=5`，设置页每站点下拉可调）。主进程每 60s 扫一遍 ViewManager：视图「可见」= 以非零矩形挂在宿主窗口上且窗口可见未最小化（提示词模式零矩形/被切走/窗口隐藏/鲸鱼形态都算不可见）；不可见时长超过该站点阈值即销毁其 webContents（状态机走 `sleep` 事件 → `sleeping`，`render-process-gone` 处理器有 `views.get(id)===mv` 守卫防销毁瞬间误报 crashed）。切回该站点时 `ensureView` 自动重建并重载——**登录态保留在 persist 分区，但页面运行状态（滚动位置/未发送草稿）丢失**。
- **删除站点彻底清理**：`ProvidersRemove` 确认删除生效（自定义站点）后，ViewManager `discardProvider`（销毁视图 + 忘记注册，`discardView` 与 clearData/休眠共用一套摘除→延迟 close→广播流程）+ `providers.clearData` 清空分区存储，不残留孤儿分区。分区存储只由 `ProviderStore.clearData` 清一处。
- **ProviderStore 内存缓存（CPU 优化）**：`list()` 结果缓存（save/remove/init 失效）——`FViewSetLayout` 每次都调 `ensureProviders → providers.list()`；`ProvidersSave`/`ProvidersList` 会把最新 Provider 快照同步注册进管理器（休眠阈值/UA 改动立即生效）。
- **开机自启**：设置窗口「通用 → 开机自动启动」开关（默认关闭），走 `app:get/set-autostart` IPC → `app.setLoginItemSettings`。Windows 落在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`，值指向**当前 exe**——portable exe 移动位置后需重新开关一次以刷新路径；注册表读写可能被安全软件拦截，开关状态以 `getLoginItemSettings()` 回读为准。
- **dev watcher 防抖 + 守卫**：main/preload 的 `build.watch.buildDelay: 400` 合并快速连续编辑（rollup watch 对失败/空重建会删除上一轮产物，与重启竞态曾导致 out/main 写空、dev 死亡）；`scripts/patch-electron-vite.mjs`（postinstall 重放）给 electron-vite 重启逻辑加"入口产物缺失则跳过本次重启"的守卫。
- 透明窗口注意：`backgroundColor` 必须 `#00000000`；`ready-to-show` 后再 show（防 Windows 黑底）；悬浮窗 `resizable:false` 避免破坏透明合成；鲸鱼窗口 `backgroundThrottling:false`（隐藏期间同步/未读链路照常）。

## 鲸鱼形态（悬浮窗压缩态）实现

移植自 whale-pet（`E:\Projects\whale`），渲染层在 `src/renderer/src/whale/`，全部为纯 TypeScript 模块，行为/物理/视觉与原项目逐行一致；与 ChatDeck 的接缝只有 4 处显式胶水。

### 渲染层模块与数据流

```
主进程 WhaleWindowController                     鲸鱼渲染层（whale.html）
├─ 光标轮询 33ms ──ev:whale-cursor──▶ acceptCursor（视线跟随/悬停判定/拖拽）
├─ 工作区变化   ──ev:whale-workarea─▶ 复位姿态与特效取景
├─ 行为命令     ──ev:whale-command──▶ jumpDive（托盘招牌动作）/ surface（收起时定点浮出）
├─ 未读数       ──ev:whale-unread───▶ 头顶气泡显隐与数字
└─ setInteractive(悬停命中) ◀──whale:set-interactive── 渲染层
   move/resize 常驻                ──whale:expand(姿态)─▶ 展开悬浮窗
```

```
whale/app.ts（编排:主循环/行为大脑/输入/接线）
  ├─ whale/states.ts   11 个行为状态（idle/swim/jumpDive/spin/sleep/happy/surface
  │                    + held/dragged/falling/bouncing/landing）
  ├─ whale/whale.ts    SVG 构成/姿态合成/命中测试/水线裁剪/表情/眨眼/视线
  ├─ whale/particles.ts Canvas 粒子（水花/涟漪/气泡/Zzz/爱心,对象池化）
  ├─ whale/runtime.ts  计时/输入/运动原语（弹簧精确解/曲线路径/帧调度器）
  ├─ whale/tween.ts    补间与可取消等待    whale/fsm.ts  有限状态机 + 逐帧循环表
  └─ whale/badge.ts    未读气泡（头顶跟随,点击展开）  whale/context.ts  App 数据单例
```

- **固定窗口 + 内部游动**：原生窗口不动（唯一例外是显示器拓扑变化时同步工作区），所有运动都是渲染层内的一次 transform 合成——避免「原生移动」与「Chromium 合成」不同步的竞态。
- **单写者渲染**：每帧先推进补间与逐帧循环，再合成一次姿态快照（量化到 0.1，呼吸 0.001），SVG transform / 命中测试 / 入水几何全部用同一快照；变换串与上次比对相同则跳过 DOM 写入；隐藏期跳过全部 DOM 写。
- **鼠标穿透 + 悬停接管**：窗口默认 `ignoreMouseEvents(true, {forward:true})`（鼠标移动仍转发渲染层），渲染层每帧 `hitTest`（反演合成变换，跟随朝向/压缩/倾斜/随动）+ 气泡矩形判定；命中才开启交互，离开立即恢复穿透。

### 与 whale-pet 的四点差异（本轮全部为 ChatDeck 集成胶水，均已确认）

1. **单击鲸鱼 → 展开悬浮窗**（原为「开心跳」）：快速点击判定（<350ms、位移<10px）成立即上报姿态展开；拖拽/投掷、按压冻结姿态等其余输入行为不变。
2. **鼠标悬浮鲸鱼 → 触发「开心跳」**（替代原单击触发）：悬停上升沿（非按压、非 jumpDive/surface 中）触发，与悬停接管鼠标的同一套判定。
3. **头顶未读气泡**：未读站点数 >0 时在鲸鱼上方显示计数气泡（药丸时代红点的等价物），位置每帧跟随、可点击展开、计入交互接管区；数据源是悬浮窗渲染层的 `providers.unread`（`float:unread-count` 推送 → 主进程转发）。
4. **surface 定点浮出状态**：新增第 12 个状态，复用招牌动作的入水/浮出编排（水线裁剪 + 涟漪 + outBack 上浮 + 压缩回正），在悬浮窗原位置破水而出。

其余（游动规划、招牌动作起跳下潜、睡觉 Zzz、转圈、拖拽投掷与落地形变、视线跟随、眨眼、呼吸/随动、帧调度模式）与原项目一致。

### 状态机

```
行为状态机（whale/fsm.ts + states.ts,切换即取消上一状态的等待/补间/逐帧循环）
  idle ⇄ swim ⇄ jumpDive ⇄ spin ⇄ sleep（行为大脑按权重随机挑选,1.2~4.2s 间隔）
  held ──拖拽阈值──▶ dragged ──释放──▶ falling ──落地──▶ landing
  landing ──弹跳阈值──▶ bouncing ──▶ falling        landing ──▶ idle
  happy（悬浮触发,可被按压打断）    surface（收起交接,定点浮出后回 idle）
  任意状态 ──按压──▶ held（立即冻结姿态,取消上一个运动写者）
```

```
帧调度模式（whale/runtime.ts FrameScheduler,至多一个待决回调）
  ACTIVE  有按压/补间/逐帧循环/快速粒子/未收敛弹簧 → 原生刷新率
  IDLE    鲸鱼可见但静止（呼吸+摆尾）           → 30fps 定时器 + 单帧
  SLEEP   睡觉中（仅 Zzz 粒子）                → 30fps
  DORMANT 不可见且无粒子（潜水/窗口隐藏）        → 无周期回调,新工作唤醒
  输入可取消低速率定时器并立即请求显示帧；稳定弹簧不维持原生刷新
```

### 未读气泡数据流

```
站点标题变化 → ViewManager hook → ev:f-title-changed → 悬浮窗 providersStore.onTitleChanged
  (非活动站点记未读) → providersStore.$subscribe → float:unread-count → 主进程
  → ev:whale-unread → 鲸鱼渲染层 badge.setUnread → 头顶气泡（隐藏窗口期间照常累计）
```

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
- **跟随与级联**：悬浮窗 move（防抖后）→ `onMoved` → 弹窗重定位；悬浮窗隐藏 → `onHide` → 弹窗隐藏；悬浮窗未创建时 Ctrl+Q 直接忽略。
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
  → 头部厂商点未读小红点 / 状态点 / 鲸鱼头顶气泡

提示词「粘贴」：  设置窗口 clipboard.writeText → fview.paste()
                  → 主进程取悬浮窗活动站点 → focus + 60ms 后 paste()

形态切换：鲸鱼单击(姿态) ──whale:expand──▶ 主进程换算屏幕坐标 → 悬浮窗落位显示 + 鲸鱼隐藏
          悬浮窗收起 ──float:collapse──▶ 主进程取窗中心 → 鲸鱼显示 + surface 定点浮出
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
- 鲸鱼的调参常量（行为权重/物理/动画/性能）是代码内配置：`src/shared/whaleConfig.ts`（逐值移植自 whale-pet `config.json`，类型化；主进程只读 `performance.cursorPollMs`）。

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

### 2. 形态状态机（`index.ts` forms + `float/floatStore.ts` + 鲸鱼行为状态机,见上文「鲸鱼形态」节）

```
展开 ⇄ 鲸鱼：互斥显示,展开时按鲸鱼姿态落位、收起时鲸鱼定点浮出
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
src/shared/           前后端共享：类型、IPC 常量、纯函数（merge/viewState/prompts/floatLayout/translate）、鲸鱼配置、API 接口
src/main/             主进程：floatWindow、whaleWindow、settingsWindow、translateWindow、translateService、textCapture、tray、ViewManager、IPC、两个 store
src/preload/          contextBridge：index.ts（主 API，四个渲染层共用）、error.ts（错误页重试）
src/renderer/         界面：whale.html（鲸鱼）+ float.html（悬浮窗）+ settings.html（设置窗口）+ translate.html（译文弹窗）
src/renderer/src/whale/     鲸鱼渲染层：app/states/whale/particles/runtime/tween/fsm/context/badge（纯 TS,无 Vue）
src/renderer/src/float/     悬浮窗渲染层：floatStore + FloatApp/FloatHeader/FloatPrompts
src/renderer/src/settings/  设置窗口渲染层：SettingsApp（标签页壳,复用 components/ 下面板）
src/renderer/src/translate/ 译文弹窗渲染层：TranslatePopup
tests/                Vitest 单测（shared 纯函数 + 主进程 store/ViewManager + 鲸鱼 runtime 与行为状态机移植套件，127 个用例）
```

## 打包与分发（electron-builder）

`npm run dist` = `electron-vite build` + `electron-builder --win`，配置在 `electron-builder.yml`：

```
app.asar（out/** 打包）        安装目录/resources/（extraResources 平铺）
├─ out/main/index.js           ├─ providers.default.json   ← resourceFile() 读这里
├─ out/preload/{index,error}.js ├─ prompts.default.json       (process.resourcesPath)
└─ out/renderer/{whale,float,settings,translate}.html
                               └─ error.html            ← viewManager.errorPagePath()
                                  └─ tray.png / tray@2x.png ← tray.ts 读这里
```

- 产物：`dist/ChatDeck-<ver>-Portable.exe`（免安装双击即用）与 `dist/ChatDeck-Setup-<ver>.exe`（一键安装，per-user）。
- 关键约束：extraResources 的 `to` 必须是 `.`（写成 `resources` 会多套一层，运行时读不到）。
- userData 不变（`%APPDATA%/chatdeck`），打包版与开发版登录态互通。
- 单实例锁在打包版同样生效：重复启动唤起鲸鱼（压缩形态）。

体积控制（v0.3.1 起，三件套缺一不可）：
- `package.json` 的 `dependencies` 必须保持为空——vue/pinia 只被渲染层用且已由 vite 打进 bundle，若挪回 dependencies 会被 electron-builder 整树拷进 asar（曾把 asar 撑到 14.9MB，其中 @babel/parser、@vue/compiler-sfc 等编译器链全是死重）。主进程将来要引运行时依赖时才移回，并确认确有运行时 require。
- `compression: maximum`（7z/NSIS 最高 LZMA）。
- `afterPack: build/afterPack.js`：压缩归档前裁掉 locales/ 下除 en-US、zh-CN 外的全部 .pak（Chromium 内置 UI 字符串，缺失语言回退英文，页面渲染无关）；v0.3.3 起另删 `vk_swiftshader.dll`、`vk_swiftshader_icd.json`、`vulkan-1.dll`（SwiftShader/Vulkan 软件渲染兜底，正常 GPU 机器走 ANGLE D3D11 用不到）。`d3dcompiler_47.dll` 必须保留——它是 ANGLE 运行时编译 D3D 着色器用的，删了任何机器都会渲染异常。代价：GPU 进程崩溃后无法软件渲染续命、无 Vulkan 驱动时 WebGPU 不可用、RDP/虚拟机可能白屏。

## 持久化位置（%APPDATA%/chatdeck/）

- `providers.user.json` / `prompts.user.json`：用户配置层
- `float-state.json`：悬浮窗位置 x/y、活动站点
- `translate.user.json`：百度翻译 APPID/KEY、语言方向对
- `Partitions/provider-*`：各站点的登录数据（cookie/localStorage）
- `ui-state.json`：已废弃（桌面版布局残留），不再读写；可手动删除

## 测试

- `npm run typecheck`：`tsconfig.node.json`（主进程/preload/shared）+ `tsconfig.web.json`（渲染层）+ `tsconfig.test.json`（测试，含 DOM 类型）。
- `npm test`：127 用例。鲸鱼部分移植自 whale-pet 的 `runtime.test.js` / `animation.test.js`，用独立对照（临界阻尼解析解、RK4 积分、de Casteljau 曲线、细分离线弧长）与边界用例（0/负尺寸工作区、离屏起点、极值缩放、抖动刷新率）验证移植保真：
  - `tests/whaleRuntime.test.ts`：输入状态机、光标采样过期规则、弹簧/摆尾相位、泳路规划、投掷限幅、帧调度器、粒子轨迹与对象池、tween/FSM 取消语义。
  - `tests/whaleStates.test.ts`：编排过渡不跳变、按压取消不重置形状、泳路完成与中途取消、形变有界与命中几何、入水事件取消、水线同步清除、短弧旋转恢复、surface 定点浮出。
