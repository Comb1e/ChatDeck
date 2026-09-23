# AGENTS.md — ChatDeck 工作区说明

国内大模型聚合工作台（Windows 桌面应用）：Electron 33 + Vue 3 + Pinia + TypeScript，把多个 LLM 网页版装进一个悬浮窗；平时以鲸鱼桌宠形态常驻，双向换形动画展开/收起。仅面向 Windows（透明窗口 + DWM 合成强相关）。

## 常用命令

```bash
npm run dev        # 开发运行（electron-vite dev --watch）
npm test           # vitest run（提交前必须全绿）
npm run typecheck  # 三个 tsconfig 工程都要过（node / web / test）
npm run build      # 构建产物到 out/
npm start          # 运行构建产物
npm run dist:dir   # 打包冒烟（不出安装器）
npm run dist       # 打包 portable + 安装器到 dist/（走 npmmirror 镜像）
```

## 目录与入口

- `src/main/` — Electron 主进程：窗口控制器（floatWindow / whaleWindow / settingsWindow / translateWindow / balance/）、FormController（形态切换协调）、ipc.ts（全部 IPC 注册）、store/（JSON 持久化）。
- `src/preload/` — index.ts（DeckApi 桥）+ error.ts（站点错误页 preload）。
- `src/shared/` — 主进程/渲染层/测试三方共用的**纯逻辑**：类型、IPC 通道名、状态机（viewState、formTransition）、几何/布局纯函数（floatLayout、whaleSkin、whaleGeometry）、合并/翻译等。保持无 Node/Electron 依赖，逻辑尽量写在这里并配单测。
- `src/renderer/` — 6 个 HTML 入口（float / whale / settings / balance / billing / translate），在 `electron.vite.config.ts` 显式列出；新增窗口必须加入口。
- `tests/` — vitest，只测纯逻辑（shared + 主进程可注入部分），`npm test` 全量跑。
- `docs/architecture.md` — 改窗口/形态切换/视图管理相关代码前**先读**；改完同步更新。`docs/iteration.md` 每个版本追加条目。

## 分层规则

- 渲染层不直接碰 Node：一切经 preload 的 `DeckApi`（`src/shared/api.ts`）。新增 IPC 能力要改四处：`shared/ipc.ts`（通道名）→ `shared/api.ts`（接口）→ `preload/index.ts`（桥）→ `main/ipc.ts`（handler）。
- 原生窗口可见性只归 `FormController`（main）管：鲸鱼 ⇄ 悬浮窗换形走 preparing → animating → handoff 状态机，渲染层只画动画（FormStage）。**不要**在别处随意 show/hide 鲸鱼窗口或悬浮窗——透明窗口的 DWM 显示过渡是历史闪烁根因。
- 站点 WebContentsView 的生命周期只经 `ViewManager` + `@shared/viewState` 状态机；先挂载（非零矩形）后加载是不变量。
- 透明窗口铁律：`backgroundColor: '#00000000'`、`resizable: false`、等 `*-ready` 再 show；焦点/穿透用 `ignoreMouseEvents + forward`。

## 已知坑

- electron-vite 的 HMR 对 `src/shared/` 模块不可靠——改了 shared 必须**重启 dev 进程**，别信热更新。
- 版本号要同步两处：`package.json` 和 `SettingsPanel.vue` 的「关于」文案。
- 用户凭据只存 `%APPDATA%\chatdeck\*.user.json`（balance/translate 等），**绝不进 git、绝不打印内容**；API key 由用户在设置界面填写，禁止引入 .env。
- 本机同时可能跑着打包版 ChatDeck.exe（用户的正式实例）：清理测试进程只 `taskkill /IM electron.exe`，**绝不动 ChatDeck.exe**。
- 悬浮窗坐标一律 DIP，落屏前用 shared 里的 clamp/工作区夹取函数；布局尺寸主进程与 Vue 常量必须同源（`shared/floatLayout.ts`）。
- 换形/闪烁类 GUI 验证：`CHATDECK_WHALE_PINNED=1` 钉住鲸鱼 + `scripts/grab-frames.ps1`（屏幕区域连拍）+ `scripts/analyze-frames.mjs`（亮度曲线/突陷检测）；透明窗口不吃 CDP screencast，必须抓屏幕。

# 要求

- 每个版本都需要进行一次打包。
