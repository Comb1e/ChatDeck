# 迭代记录

## v0.3.6（2026-09-20）

形态重构（用户需求）：悬浮窗为主形态——启动默认显示悬浮窗、删除大主窗界面、设置等入口移到托盘右键菜单。

### 上版问题

- 产品形态仍是「主窗 + 悬浮窗」双宿主：主窗常驻一个完整渲染层（侧栏/工作区/抽屉），内存与维护成本高；悬浮窗才是用户高频入口。
- 用户需求明确：默认显示悬浮窗、删除大界面、设置等放托盘右键。

### 方法（根因）

- **删除主窗**：`index.ts` 不再创建 `BrowserWindow` 主窗、删除主窗侧 `ViewManager` 实例与其 emit 桥；`floatViews` 成为站点视图唯一宿主。IPC 剪除主窗专属通道（`view:set-layout/set-active/reload/back/forward/open-external/paste`、`state:get/save`、主窗事件 `ev:title-changed` 等），`StateStore`（ui-state.json）、`stores/layout.ts`、`shared/layout.ts`、`App.vue`/`Sidebar`/`Workspace`/`Drawer` 及 `index.html` 入口整体删除。托盘左键与二次启动改为唤起悬浮窗；`window-all-closed` 改为 no-op（托盘常驻应用，防悬浮窗崩溃重建间隙误退出），退出只走托盘「退出」。
- **设置窗口**：新增 `settingsWindow.ts`（普通有框窗口 880×660，惰性创建、关闭即销毁、已开则聚焦），渲染层新入口 `settings.html` + `settings/SettingsApp.vue`（顶部「设置 / 提示词库」标签页，复用原 Drawer 下的 SettingsPanel/PromptPanel/PromptEditor/PromptFill 组件与 stores，并承载原 Workspace 的 toast 展示）。入口三处：托盘「设置…」（新增菜单项）、悬浮窗头部齿轮按钮、`app:open-settings` IPC。
- **悬浮窗补齐原主窗能力**：头部厂商点显示未读小红点（`providers.unread`，标题变化接线、切回即清）；`Ctrl+1~9` 切换站点迁移到悬浮窗渲染层；提示词「粘贴」目标改为悬浮窗当前活动站点——新增 `fview:paste`（无参，主进程经 `floatWin.getActiveProvider()` 解析，`FloatWindowController` 补 getter），设置窗口里的 PromptPanel/PromptFill 走此通道。
- 顺手修正文案：翻译热键错误提示与 translateService 提示不再指"主窗口"。

### 验证结果

- 回归：typecheck 通过；102/102 单测通过（118 − 已随 layout store 删除的 16 个布局用例，无新增纯逻辑）。
- dev 冒烟：启动仅 5 个 electron 进程，唯一可见窗口「ChatDeck 悬浮窗」（Win32 EnumWindows 核实），主窗不复存在；临时钩子驱动 `settingsWin.show()` →「ChatDeck 设置」窗口出现、渲染进程 5→6、用户目视确认内容渲染正常（钩子验证后已删除，grep 临时=0）。
- 打包：v0.3.6 双包 68.1/68.3MB（与 v0.3.5 持平——删除的主窗渲染层本就由同一份组件代码打包，入口减少但组件仍在，体积不变在预期内）；打包版启动冒烟通过（进程/窗口级：仅悬浮窗一个可见窗口，主窗不复存在）。

### 遗留问题

- 提示词「粘贴」目标只认悬浮窗当前活动站点；悬浮窗折叠（药丸）时站点视图零矩形挂载仍可粘贴，但若活动站点已被休眠则先重建加载、粘贴可能落在加载完成的输入框之前（罕见时序，遇到时先展开悬浮窗等待加载完成）。
- 悬浮窗 360×620 窄面板适配移动端 UA 站点；个别站点移动端布局异常时暂无桌面宽版选项（悬浮窗 UA 策略不变）。
- v0.3.5 遗留照旧：休眠丢失页面运行状态（草稿/滚动）、后台音频中止、孤儿分区磁盘清理未做；v0.3.4/v0.3.3/v0.3.1 遗留照旧。
- `ui-state.json` 为历史残留文件，应用不再读写，可手动删除（未做启动清理）。

## v0.3.5（2026-09-20）

性能优化：内存为主（后台站点自动休眠 + 删除站点彻底清理），兼顾 CPU（逐帧磁盘读写消除）与 GPU（药丸辉光合成器化）。

### 上版问题

- 站点视图（WebContentsView）一旦打开永不销毁：`setLayout` 只 detach 保留缓存、悬浮窗隐藏用零矩形常驻挂载、`views` Map 无上限。每个站点渲染进程 100~300MB，久跑内存持续增长。
- 删除自定义站点只改 `providers.user.json`：两侧视图与 `persist:provider-<id>` 分区存储全部残留（自定义 id 带时间戳，同名重建生成新分区，旧分区成永久孤儿）。
- `ViewSetLayout` 每次调用 `ensureProviders → providers.list()` 都重读 `providers.user.json` + JSON.parse + merge；而 `layout.sync()` 在窗口缩放的每个 ResizeObserver tick 都触发——拖拽缩放窗口 = 每帧一次磁盘读。
- 悬浮药丸辉光直接动画 box-shadow（无法合成器加速），透明置顶窗口全天持续重绘；翻译弹窗首次使用后隐藏常驻不销毁，多占一个渲染进程。

### 方法（根因）

- **后台站点自动休眠（核心，用户确认默认值）**：`Provider` 增 `autoSleepMinutes`（0=永不；`providers.default.json` 内置默认 DeepSeek=0、其余=5；用户层可覆盖、自定义站点缺省回退 `DEFAULT_AUTO_SLEEP_MINUTES=5`）。`ViewManager.sweepSleep()` 每 60s 扫描两个管理器：可见（非零矩形挂载 且 宿主窗口可见未最小化）→ 刷新时间戳；不可见超过该站点阈值 → `discardView` 销毁 webContents（摘除→延迟 close→删 Map→广播 `sleeping`，clearData/删除站点/休眠三路共用）。状态机增 `sleeping` 态 + `sleep` 事件（`shouldSleepNow` 纯函数：可见放行、阈值 ≤0 永不休眠）。切回时 `ensureView` 自动重建重载——登录态保留在 persist 分区，页面运行状态（滚动/草稿）丢失。窗口 `show`/`restore` 时按 `lastLayout`（最近一次 setLayout 快照）自动重建被休眠视图，防止托盘唤回主窗后窗格空白。`render-process-gone` 加 `views.get(id)===mv` 守卫，防销毁瞬间误报 crashed。
- **删除站点彻底清理**：`ProvidersRemove` 确认删除生效（自定义站点；内置删除是 no-op 不误清）后，两侧 `discardProvider`（销毁视图+忘记注册）+ `providers.clearData`（清分区存储/缓存）；`viewManager.clearData` 原与 `providerStore.clearData` 重复清两次存储的路径去除。
- **CPU**：`ProviderStore.list()` 结果内存缓存（save/remove/init 失效），消除每帧磁盘读；`ProvidersSave`/`ProvidersList` 把最新快照同步注册进**两个**管理器（原先 floatViews 持过期快照，改休眠阈值/UA 对悬浮窗不生效）。
- **GPU**：药丸辉光改静态 box-shadow（`::after` 伪元素承载）+ 仅动画 opacity，视觉不变、合成器友好。
- **其他**：站点视图 `spellcheck: false`（省词典下载/内存）；翻译弹窗隐藏后再闲置 10 分钟销毁窗口、下次划词重建（lastState 存主进程不丢失）。
- **设置界面**：每站点行内「后台休眠」下拉（不休眠/1/5/10/15/30/60 分钟），即改即存、注册同步后双窗口立即生效。

### 验证结果

- 回归：typecheck 通过；118/118 单测通过（新增：sleep 状态转移与越权事件、`shouldSleepNow` 边界（阈值 0/可见/恰达阈值）、`effectiveAutoSleepMinutes` 回退、ProviderStore 合并 + 缓存失效读盘打点、ViewManager 休眠扫描 electron 打桩集成 5 例）。
- **dev 自动化锤击**（临时 bootstrap 钩子驱动真实 `setLayout` 时间线，验证后已删除，grep 临时=0）：boot 挂 DeepSeek → +8s 切 Kimi（DS 转后台）→ +16s 切 ChatGLM（Kimi 转后台）。基线 4 渲染进程 / 总私有内存 **735.3MB**（DS 61.2 + Kimi 167.1 + ChatGLM 195.2 + 主页 32.7）；休眠扫描日志逐分钟正确（`deepseek threshold=0min` 永不休眠、`kimi threshold=5min` 递增）。约 6 分钟 Kimi 渲染进程退出：3 渲染进程 / 总私有内存 **533.8MB**，**净释放 ~201.5MB**，DS 与 ChatGLM 存活、主进程稳定。
- **remount 锤击**：隐藏窗口 → 挂载 kimi → 强制超阈值 sweep（kimi 与原活动站点均休眠销毁）→ `win.show()` → 日志确认按 lastLayout 自动重建 kimi 视图并重新加载。托盘唤回主窗不再出现空白窗格。
- 打包：v0.3.5 双包 68.1/68.3MB（与 v0.3.4 持平，本版为行为优化无体积变化）；afterPack 裁剪正常（locales 39.3MB + swiftshader/vulkan 6.1MB）；打包版启动冒烟通过（7 进程 / 2 渲染进程 = 主页 + 恢复的活动站点视图，总私有内存 509MB，进程级验证，UI 级以 dev 锤击为准）。
- 用户观察记录：验证期间用户报告"首次启动 LLM 页面盖住左侧栏"——经查为当时仍在运行的**临时验证钩子**把测试视图挂在 x:0 所致（原生视图层级高于 HTML），非产品代码问题；产品矩形由渲染层按工作区计算（boot 日志 `deepseek:1188x783` = 1440 − 侧栏 252），临时代码清除后干净启动无此现象。

### 遗留问题

- 休眠销毁的是"页面运行状态"：站点内未发送草稿、滚动位置、SPA 内页状态在休眠后丢失（登录态保留）。若某站点用户依赖草稿，可在设置中把该站点设为「不休眠」。
- 后台音频：被休眠/前台切走的站点若在播放音频，休眠会中止播放（预期行为）；未做"播放中禁止休眠"检测，待用户反馈再议。
- 孤儿分区磁盘清理（历史版本删除站点遗留的 `Partitions/provider-*` 目录）未做自动回收，可后续在启动时比对 provider 清单清理。
- v0.3.4 遗留照旧：heal 仅覆盖已知事件，真实过夜锁屏场景待用户日常验证；v0.3.3 遗留（SwiftShader 回滚开关、dev 图标、watcher 补丁锚点）与 v0.3.1 遗留（~68MB Electron 地板、跨显示器钳制细节）照旧。

## v0.3.4（2026-09-19）

修复：悬浮窗久跑自动消失、托盘右键唤醒失败（切到桌面再唤醒才有效）。

### 上版问题

- 用户报告：运行时间久了之后悬浮窗自动消失；从托盘菜单唤醒失败；切到桌面再唤醒才有效。

### 方法（根因）

- **根因**：悬浮窗是无边框**透明**窗口。Windows 上锁屏/休眠唤醒/显卡驱动重置后，DWM 对这类窗口的合成表面可能失效——窗口对象完好、`isVisible()` 仍为 true，但整窗透明不可见（=“消失”）。此时托盘「显示/隐藏悬浮窗」toggle 第一击反而执行了 hide；再 show 也不重绘（=“唤醒失败”）。切换桌面/Win+D 强制 DWM 重新合成，窗口“恢复”（=“切到桌面再唤醒才有效”）。伴生问题：'floating' 置顶级别也可能在同类事件后丢失，窗口被普通窗口压住。
- **修复四层**：
  1. `show()` 硬化：每次显示重新断言 `setAlwaysOnTop(true, 'floating')`，并 `webContents.invalidate()` 强制重绘；页面已崩溃（`isCrashed()`）时直接走窗口重建。
  2. 事件自愈 `heal()`：`powerMonitor` 的 resume / unlock-screen、GPU 进程崩溃（`app.on('child-process-gone')`）触发 hide→show 重建合成表面 + 重新置顶 + 强制重绘（窗口隐藏时不打扰）。
  3. 页面崩溃自动重建：悬浮窗自身 `render-process-gone` → 10s 节流（`RECREATE_GUARD_MS`，防崩溃循环）→ 销毁重建窗口；重建前 `onDetachViews`（= `floatViews.setLayout([])`）把站点视图从旧窗口摘下留缓存，新页面 boot 后 `floatStore.sync → FViewSetLayout` 自动重挂，位置尺寸从旧窗口 bounds 恢复。
  4. 显示器拓扑自愈：`display-removed` / `display-metrics-changed` → `reclamp()` 把窗口夹回现存工作区（防窗口留在已断开的显示器上）；`setVisibleOnAllWorkspaces(true)` 保证虚拟桌面切换/全屏应用不丢胶囊。

### 验证结果

- **dev 锤击**（临时注入 Ctrl+Shift+K → `webContents.forcefullyCrashRenderer()`，验证后已删除）：崩溃 → 旧窗销毁 → 新窗口**同位置同尺寸**自动重建（window_id 1510448 → 1575984），electron 进程与主窗存活；采样新窗口内容区像素为站点页面深色系（非 float.html 米色底 #FAF9F5），证明站点视图已随新窗口重挂。
- 回归：typecheck 通过；95/95 单测通过；清除临时代码后再次 typecheck 通过。
- 打包：v0.3.4 双包 68.1/68.3MB（与 v0.3.3 持平，本版为行为修复无体积变化）；打包版启动、进程/窗口枚举正常。
- 打包冒烟说明：验证期间用户正在使用机器（前台为资源管理器窗口），UI 级点击/像素采样被干扰，故打包版冒烟止步于进程/窗口级，交互级验证以 dev 锤击为准；托盘唤醒路径与 v0.3.3 冒烟一致（toggle → show，show 内部新增的两个调用不影响路径结构），待用户日常使用确认。

### 遗留问题

- `heal()` 只在已知事件（锁屏/解锁/GPU 崩溃/显示器变化）后触发；若存在其他导致透明表面失效的路径（如驱动热重置不经 GPU 进程重启），仍需切桌面恢复——真实长时间运行场景（锁屏/休眠过夜）待用户日常使用验证。
- v0.3.3 遗留照旧：已放弃 SwiftShader 兜底（虚拟机/RDP 白屏可从 afterPack `DROP_RUNTIME` 回滚）；dev 任务栏 electron.exe 默认图标、watcher 补丁锚点、v0.3.1 各项。

## v0.3.3（2026-09-19）

打包产物删除 SwiftShader/Vulkan 软件渲染兜底文件，exe 再减 ~1.5MB（v0.3.2 遗留项落地）。

### 上版问题

- v0.3.2 分析结论待定夺：删 `vk_swiftshader.dll` / `vk_swiftshader_icd.json` / `vulkan-1.dll` 对有 GPU 的机器零性能影响，可再省体积；用户确认删除。

### 方法（根因）

- `build/afterPack.js` 新增 `DROP_RUNTIME` 清单（`vk_swiftshader.dll`、`vk_swiftshader_icd.json`、`vulkan-1.dll`），打包后、压缩归档前删除，便携包/安装包同步受益（解压共释放 6.1MB，压缩后每包约 -1.5MB）。
- `d3dcompiler_47.dll` 明确保留：正常 GPU 渲染路径（ANGLE → D3D11）运行时编译着色器必需，删除会让所有机器渲染异常。
- 版本 bump 至 0.3.3：v0.3.2 的 exe 已交付，避免同名不同内容的两份产物。

### 验证结果

- win-unpacked 抽查：三个文件已消失，`d3dcompiler_47.dll`/`libEGL.dll`/`libGLESv2.dll`（ANGLE）完整，locales 仍为 2 个 .pak。
- 打包冒烟：`dist/win-unpacked/ChatDeck.exe` 启动 → 主窗与 Kimi webview 完整渲染（GPU/ANGLE 路径无恙）；侧栏"悬浮窗"按钮触发 → 折叠胶囊（148×64）在保存位置正常显示（透明窗口合成正常）。
- 体积实测：Portable 69.6 → 68.1MB，Setup 69.8 → 68.3MB（v0.3.0 起累计 78.2 → 68.1，−13%）。
- 回归：typecheck 通过；95/95 单测通过。

### 遗留问题

- 已放弃的兜底：GPU 进程崩溃后无法软件渲染续命（渲染异常需重启应用）、无 Vulkan 驱动的机器上 WebGPU 不可用、RDP/无 GPU 虚拟机可能白屏。若用户在虚拟机/RDP 场景遇到白屏，从 afterPack 的 `DROP_RUNTIME` 移除对应条目重打包即可回滚。
- v0.3.2 遗留照旧：dev 任务栏 electron.exe 默认图标、watcher 补丁锚点随大版本升级需人工重对；v0.3.1 遗留照旧：~68MB Electron 地板、垂直双屏向下跨屏被钳、顶部任务栏 8px 条带、v0.3.0/v0.1.x 各项。

## v0.3.2（2026-09-19）

应用图标重设计（黑底亮蓝原子轨道）+ 根治 dev watcher 写空 out/main 的问题。

### 上版问题

- 用户报告：悬浮窗收缩态可拖进任务栏底下且无法取回（v0.3.1 已修）。
- 用户报告：electron-vite dev watcher 偶发把 out/main 写空、报 "No electron app entry file found"，重启 dev 才恢复（本版开发期间遇到两次）。
- 用户要求：图标由橙白配色换成黑+蓝，最终明确为"参考 Electron 默认运行时标识（dev 任务栏/标题栏显示的那个）做新颖时尚的再设计"。

### 方法（根因）

- **图标**：`scripts/make-icon.mjs` 重写——深空径向渐变圆底 + 单条主轨道（被两个断口分为两段弧）+ 断口处两颗带柔光的电子（右上/左下对角）+ 中心亮核；轨道线色沿世界纵向做青蓝→蓝→蓝紫渐变；辉光一律平方衰减，不做硬边色块。负空间充足，小尺寸（托盘 16px）仍可读。
- **watcher 根因**（本版实测复现确认）：rollup watch 对失败/空重建会把上一轮产物**删除**（out/main/index.js 消失，语法错误注入实验复现）；electron-vite 的 watchHook 在重建结束后**无条件** kill+重启 electron，`startElectron` 内 `ensureElectronEntryFile` 在入口缺失时直接 throw → dev 会话死亡。
- **watcher 修复（两层）**：
  1. `electron.vite.config.ts` 给 main/preload 加 `build.watch.buildDelay: 400`——快速连续编辑合并为一次重建，消灭"背靠背重建竞态"这一触发条件；
  2. 新增 `scripts/patch-electron-vite.mjs`（package.json postinstall 自动执行、幂等）给 electron-vite 两份 chunk（ESM/CJS）打补丁：watchHook 重启 electron 前检查入口产物，缺失则跳过本次重启并告警（当前 electron 继续用旧代码跑，下一次有效重建正常重启）——空重建即便发生也只是"慢半拍"而非死亡。

### 踩坑

- **图标绘制单位混用**：电子/核的半径常量是相对值（0.038），绘制时直接与像素距离比较 → 两个"点"分支从未命中，前几版图标只有轨道没有点。排查手段：按公式计算电子应在的像素坐标、反读 PNG 采样值对照。教训：几何渲染里"相对单位/像素单位"必须显式换算。
- patch 锚点里的 `\n` 是 chunk 源码中的字面反斜杠+n（日志字符串），模板字面量会把它变成真换行导致锚点失配，需 `\\n`；补丁脚本对锚点失配做警告软失败，不阻塞 npm install。
- 主构建产物经 esbuild 压缩，源码注释不会进入 out/main/index.js——锤击测试用注释留痕验证产物时，grep 恒为 0 属预期。

### 验证结果

- 图标：`build/icon.ico`（7 尺寸）+ `icon-256.png` 预览人工确认（轨道断口、双电子、亮核、渐变、辉光均正确渲染）；`resources/tray.png`、`tray@2x.png` 同步再生。
- watcher 锤击：10 次快速交错编辑（main+shared 混合）→ 恰好合并为 1 次重建（buildDelay 生效），产物 48.10 kB 正常、electron 正常重启；3 轮分离突发（间隔 0.8s）→ 3 次串行重建全部健康，账目吻合（6 次构建/5 次重启/0 入口错误）；注入语法错误 → 构建失败不触发重启、electron 存活（old 代码继续跑），恢复后正常重启。
- 回归：typecheck 通过；95/95 单测通过。
- 打包：`npm run dist` 产出 v0.3.2 双 exe，体积与 v0.3.1 持平（~69.6MB），新图标嵌入 exe 与托盘。

### 遗留问题

- dev 模式下任务栏/标题栏显示 electron.exe 默认图标（无窗口级 icon），与本版新图标视觉同源但非同一文件；打包版显示新图标。需要时可给 BrowserWindow 显式配 icon。
- watcher 补丁随 node_modules 重装由 postinstall 重放；electron-vite 大版本升级导致锚点失配时补丁自动跳过（仅警告），需人工重对锚点。
- 删 vk_swiftshader/vulkan-1 再省 ~3MB 的方案已分析（对有 GPU 机器零性能影响），待用户定夺。
- v0.3.1 遗留照旧：~69MB Electron 地板、垂直双屏向下跨屏被钳、顶部任务栏 8px 条带、v0.3.0/v0.1.x 各项。

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
