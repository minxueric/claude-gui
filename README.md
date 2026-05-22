# Claude GUI

> 一个本地运行的 Claude Code 图形化客户端：浏览所有历史会话、用 Claude 实时对话、查看工具调用与文件改动、和 CLI 并行工作。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Stack](https://img.shields.io/badge/stack-FastAPI%20%2B%20React%20%2B%20SQLite-orange)

![Claude GUI overview](docs/images/overview.png)

Claude GUI 把 Claude Code CLI 写到 `~/.claude/projects/` 的 JSONL 会话记录索引到 SQLite/FTS5，搭配一个完整的图形化聊天客户端，让你能像用网页版 Claude 一样开始 / 续接对话，但**所有数据和模型调用仍然在你本地**。同时与 CLI 共存：CLI 写入的会话会实时同步显示，GUI 启动的会话也能在 CLI 里 `/resume` 续接。

## 快速开始

### 1. 前置准备

确保下列工具已安装：

- **Python ≥ 3.11**（macOS: `brew install python@3.12`；建议用虚拟环境）
- **Node.js ≥ 18**（macOS: `brew install node`）
- **Claude Code CLI** 并完成认证：见 [docs.claude.com/claude-code](https://docs.claude.com/claude-code)
  - 首次使用 GUI 之前，**至少先在 CLI 里完成一次登录**（`claude` 命令启动一次），让 `~/.claude/` 目录初始化好

### 2. 克隆 & 安装

```bash
git clone https://github.com/minxueric/claude-gui.git
cd claude-gui

# 可选：用虚拟环境隔离 Python 依赖
python3 -m venv .venv
source .venv/bin/activate

# 一次性装好 Python + Node 依赖
make install
```

`make install` 会做：
- `pip install -e backend/`（FastAPI + claude-agent-sdk + 索引依赖）
- `cd frontend && npm install`（React + Vite + Tailwind）

### 3. 启动开发模式

```bash
make dev
```

会在前台同时启动两个进程：
- 后端 `uvicorn` 监听 **http://127.0.0.1:8765**（API + SSE）
- 前端 Vite dev server 监听 **http://127.0.0.1:5173**（带 HMR）

浏览器打开 **http://localhost:5173** 即可开始使用，默认进入 New Chat 页面。

> 第一次启动时后端会扫描 `~/.claude/projects/` 建立索引，可能要几秒到几十秒（取决于历史会话数量）。索引完成后 sidebar 的 Recent 会显示所有历史会话。

### 4. 第一次对话

1. 在 New Chat 页面填写 **Working directory**（你想让 Claude 操作的项目目录），可点旁边的文件夹图标用 Finder 选择
2. 可选：选择 **Model** / **Thinking effort** / **Permission mode**
3. 点 **Start chat →**，进入聊天界面
4. 在底部输入框输入消息，回车发送
5. 涉及文件操作时，会在工具行下方弹出橙色权限确认面板（CLI 风格）

### 5. 生产模式（可选）

如果想用单进程模式跑（无 HMR，前端走 dist）：

```bash
make run        # 浏览器访问 http://127.0.0.1:8765
```

`make run` 会先构建前端到 `frontend/dist/`，然后 FastAPI 直接 serve 静态文件 + API。

### 常见问题

| 问题 | 解决 |
|---|---|
| `make: pip not found` | 激活虚拟环境，或确认 Python 安装路径在 PATH 里 |
| 后端启动报 `claude-agent-sdk` 错 | 先在终端跑一次 `claude` 命令完成 CLI 认证 |
| 前端 5173 端口被占 | `pkill -f vite` 或改 `frontend/vite.config.ts` 里的 port |
| 想重建索引 | `make reindex`（后端需先启动） |
| 想清理全部 | `make clean`（删 dist / node_modules / 索引数据库） |

## 主要特性

### 📚 历史浏览与索引

- 自动索引 `~/.claude/projects/*/*.jsonl` 到 SQLite + FTS5
- `watchfiles` 监听 CLI 增量写入，**新消息几秒内出现在 GUI 侧栏**
- 启发式会话标题：跳过 `<local-command-…>` 等 meta 噪声，优先取第一条助手回复首行
- 侧栏 `Recent` 按项目分组，每条会话支持手动重命名 / 删除（同步删 jsonl 和索引）

### 💬 实时聊天客户端

- 接 `claude-agent-sdk`，SSE 流式输出 assistant / thinking / tool_use / tool_result / usage / permission
- **全局 store + 持久 SSE 连接**：离开聊天页 turn 继续推进，回来无缝看最新状态
- Lazy-start：打开历史会话不会立即占用后端 session（避免与 CLI 撞车），首次发送时才启动
- 后端重启自愈：陈旧 chatId 自动失效检测 → 清缓存 → 重建
- 5 秒一次自动轮询 JSONL，**与 CLI 同步**：CLI 端新消息会出现在 GUI

### 🔧 工具调用展示（CLI-style）

- `tool_use` 与 `tool_result` 通过 `tool_use_id` 配对，紧凑两行布局：`⚙ Bash command` / `⎿ output preview`
- 连续工具调用聚合成浅灰 "Tools" 次要面板，与正文 markdown 主轴分层
- 智能摘要：`Read 2 files · Bash 3 commands · Edit 1 file`（按工具类型分类）
- **Edit / Write / MultiEdit 显示左右并排 diff**（默认）、可切回 inline；行号 sticky；多行长行各自横向滚动

### 🛡 权限确认（内联，非 modal）

- 工具行下方就地弹出橙色权限面板，**不再全屏遮罩**
- 按钮与 CLI 一致：`No, tell Claude…` / `Allow once` / `Yes, allow for session`
- Edit/Write 触发时**直接显示 diff**（不是 raw JSON）
- "No, tell Claude…" 可展开输入框收集反馈一并发回 SDK

### 📁 文件管理面板

- 树形 + cwd 面包屑 + 顶部 "Reveal in Finder" 按钮
- **实时模糊搜索**（复用 `/api/files/match`）
- 右键菜单：Preview · `@mention` · Copy path · Reveal in Finder
- "Recent edits" 折叠区：当前会话最近 Edit/Write 文件一键预览
- **PDF / 图片 / Markdown / 文本各自渲染**（PDF 用 iframe，markdown 走 React Markdown）
- 拖动调整面板宽度（160-640 px）

### ✏️ Composer 输入框

- `/` 触发 slash command 菜单（builtin + user + project）
- `@` 触发文件提及菜单
- **图片粘贴 / 拖放上传**（base64 内联到消息块）
- **中文输入法保护**（compositionstart/end + keyCode 229，回车不会误发送）
- Permission mode 下拉：default / accept edits / plan / bypass（带说明）
- Thinking effort 下拉：default / low / medium / high / xhigh / max（运行时切换）
- "Working…" 拟人化指示器：33 个动词随机切换 + 中文翻译 + 经过秒数（`Honking 鸣笛中 (12s)`）

### 🟢 全局体验

- 侧栏小绿点：GUI 内 + CLI 内活跃会话同时检测（扫 jsonl mtime 5 分钟窗口）
- **Cmd+K 命令面板**：Pages / Sessions / Commands 模糊跳转
- **中文目录路径全程支持**（cwd 经 base64 透传，绕开 Vite proxy 的非 ASCII bug）
- 距底 200+px 时浮现"跳到最新"按钮
- 任何工具行的 file_path 可点击预览

## 技术栈

| 后端 | 前端 |
|---|---|
| Python 3.11+ | TypeScript |
| FastAPI + SSE | React 18 |
| claude-agent-sdk | Vite |
| SQLite + FTS5 | Tailwind CSS |
| watchfiles | React Query |
| Pydantic v2 | react-router-dom |

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `CLAUDE_HOME` | `~/.claude` | Claude Code 数据根目录 |
| `CLAUDE_GUI_HOME` | `~/.claude_gui` | GUI 自己的索引数据库位置 |

## 主要路由

- `/chat` — New Chat / 默认落地页（resume 时 lazy-start）
- `/sessions/:sessionId` — 单会话深链查看
- `/search` — 全文检索 + 维度过滤
- 侧栏 "More" 菜单：`/todos` `/tasks` `/plans` `/stats` `/memory`

## API 速览

详见 `backend/app/routers/`，或启动后访问 `http://127.0.0.1:8765/docs`（FastAPI 自动生成的 OpenAPI 文档）。

## 项目结构

```
backend/
  app/
    indexer/         # JSONL 解析 + SQLite 增量同步 + watchfiles 监听
    routers/         # FastAPI 路由（chat / files / search / sessions / …）
    services/        # claude_session.py（SDK 桥接 + SSE pump）
    main.py
  pyproject.toml
frontend/
  src/
    pages/           # ChatPage / SearchPage / SessionPage / TodosPage / …
    components/
      chat/          # AssistantTurnGroup / Composer / PermissionPrompt / FileTreePanel / …
      blocks/        # EditDiffBlock / MarkdownBlock / ThinkingBlock / …
    hooks/           # useChatStream (global SSE store) / useCwdFiles / …
    lib/             # api.ts (typed fetch client)
  package.json
  vite.config.ts
Makefile
README.md
```

## 开发

```bash
make install    # 安装依赖
make dev        # 前端 :5173 + 后端 :8765，HMR
make build      # 仅构建前端
make run        # 生产模式（单进程 :8765）
make reindex    # 强制重建索引
make clean      # 清掉 dist / node_modules / 索引数据库
```

## License

[MIT](LICENSE) © 2026 xumin
