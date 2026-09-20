# ChatDeck

国内大模型聚合工作台：一个桌面应用，把国内主流 LLM 网页版（DeepSeek、Kimi、豆包、通义千问、智谱清言、腾讯元宝、文心一言、讯飞星火、海螺AI、秘塔AI搜索）装进同一个窗口。

- **简洁**：Claude 风格界面，米白底色、赤陶色点缀，左侧站点列表，右侧即所即所得的网页。
- **悬浮窗**：暗色玻璃科幻风置顶小窗，展开 = 内嵌站点对话（移动版布局）+ 厂商切换，底部提示词速查（搜索/填空/一键复制）；可折叠成小药丸、可拖动，位置记忆。登录态与桌面版互通。
- **划词翻译**：任意应用里划选文字按 Ctrl+Q，悬浮窗正上方弹出译文小窗（只显示译文，点击可复制）；默认中⇄英自动互译，弹窗上可切换方向（中↔英/日/韩、中→俄/法/德/西），走百度翻译 API（非 LLM）。APPID/KEY 在「设置 → 划词翻译」填写。
- **登录态隔离**：每个站点独立持久存储，互不干扰，重启后无需重新登录。
- **分屏对比**：支持双屏/三屏并排，同题对比各家回答；分割条可拖动。
- **提示词库**：内置 26 条预设（翻译、代码审查、周报、深度分析……），支持占位符填空、一键复制/粘贴到当前站点，可自由增删改。
- **可配置**：站点可在设置中启停、自定义添加（名称 + 网址 + 图标色）；所有配置本地保存。

## 运行

**直接使用**：双击 `dist/ChatDeck-<版本>-Portable.exe`（免安装单文件），或运行 `dist/ChatDeck-Setup-<版本>.exe` 一键安装（自动创建桌面快捷方式）。exe 未做代码签名，首次运行若遇 SmartScreen 提示，点「更多信息 → 仍要运行」。

**悬浮窗**：主窗口左侧栏底部「悬浮窗」按钮或托盘菜单「显示 / 隐藏悬浮窗」唤起；头部可拖动，「—」收起成小药丸，药丸上「⤢」展开；关闭主窗口时应用隐藏到托盘，托盘「退出 ChatDeck」才真正退出。

**划词翻译**：先在「设置 → 划词翻译」填入百度翻译 APPID/KEY（[fanyi-api.baidu.com](https://fanyi-api.baidu.com) 注册获取，免费标准版 QPS=1，凭据仅存本机）；之后在任意应用划选文字按 Ctrl+Q，译文弹窗出现在悬浮窗正上方，Esc 或 ✕ 关闭，无操作约 10 秒自动隐藏。注意：应用运行期间 Ctrl+Q 为全局快捷键，会覆盖其他软件的同名快捷键。

## 开发

```bash
npm install
npm run dev        # 开发运行
npm test           # 单元测试（95 个）
npm run typecheck  # 类型检查
npm run build      # 构建产物（out/）
npm start          # 运行构建产物
npm run dist       # 打包 Windows exe（portable + 安装器，输出到 dist/）
npm run icon       # 重新生成应用图标（build/icon.ico）与托盘图标（resources/tray*.png）
```

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| Ctrl + 1~9 | 切换到第 N 个启用的站点 |
| Ctrl + V | 在站点输入框中粘贴（与提示词库的「粘贴」等效） |
| Ctrl + Q | 全局划词翻译（需在设置中配置百度翻译凭据） |

## 架构与迭代记录

- [docs/architecture.md](docs/architecture.md) — 架构、数据流、状态机
- [docs/iteration.md](docs/iteration.md) — 版本迭代记录

## 参考资料

- [ai-shifu/ChatALL](https://github.com/ai-shifu/ChatALL) — 多模型并发问答桌面应用（Electron + Vue）
- [LLM-God](https://levelup.gitconnected.com) — 内嵌多个 LLM 网页的桌面浏览器方案
- [Electron WebContentsView / session partition 文档](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron Custom Window Styles（透明/无边框窗口）](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles) / [BrowserWindow backgroundMaterial](https://www.electronjs.org/docs/latest/api/browser-window)
- [pykeio/vibe](https://github.com/pykeio/vibe) / [electron-acrylic-window](https://www.npmjs.com/package/electron-acrylic-window) — Windows acrylic 方案参考（本版未采用，与 transparent 互斥）
- [ChineseHoverTranslator](https://github.com/) — 本地参考项目（Chrome MV3 划词翻译扩展，`E:\Projects\ChineseHoverTranslator`），百度翻译 API 签名与调用范式来源
- [百度翻译开放平台 · 通用文本翻译 API](https://fanyi-api.baidu.com/doc/21)

## License

MIT
