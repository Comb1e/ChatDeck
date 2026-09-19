# ChatDeck

国内大模型聚合工作台：一个桌面应用，把国内主流 LLM 网页版（DeepSeek、Kimi、豆包、通义千问、智谱清言、腾讯元宝、文心一言、讯飞星火、海螺AI、秘塔AI搜索）装进同一个窗口。

- **简洁**：Claude 风格界面，米白底色、赤陶色点缀，左侧站点列表，右侧即所即所得的网页。
- **登录态隔离**：每个站点独立持久存储，互不干扰，重启后无需重新登录。
- **分屏对比**：支持双屏/三屏并排，同题对比各家回答；分割条可拖动。
- **提示词库**：内置 26 条预设（翻译、代码审查、周报、深度分析……），支持占位符填空、一键复制/粘贴到当前站点，可自由增删改。
- **可配置**：站点可在设置中启停、自定义添加（名称 + 网址 + 图标色）；所有配置本地保存。

## 开发

```bash
npm install
npm run dev        # 开发运行
npm test           # 单元测试（49 个）
npm run typecheck  # 类型检查
npm run build      # 构建产物（out/）
npm start          # 运行构建产物
```

## 快捷键

| 快捷键 | 作用 |
| --- | --- |
| Ctrl + 1~9 | 切换到第 N 个启用的站点 |
| Ctrl + V | 在站点输入框中粘贴（与提示词库的「粘贴」等效） |

## 架构与迭代记录

- [docs/architecture.md](docs/architecture.md) — 架构、数据流、状态机
- [docs/iteration.md](docs/iteration.md) — 版本迭代记录

## 参考资料

- [ai-shifu/ChatALL](https://github.com/ai-shifu/ChatALL) — 多模型并发问答桌面应用（Electron + Vue）
- [LLM-God](https://levelup.gitconnected.com) — 内嵌多个 LLM 网页的桌面浏览器方案
- [Electron WebContentsView / session partition 文档](https://www.electronjs.org/docs/latest/api/web-contents-view)

## License

MIT
