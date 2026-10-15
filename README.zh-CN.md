# Telo

由 AstraFoundry 打造的隐私优先 Telegram 桌面客户端，在对话旁内置具备工作区上下文感知能力的 AI 智能体。

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square)](package.json)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square)](package.json)

![展示聊天列表、会话视图与 AI 智能体面板的 Telo 桌面演示界面](docs/readme/hero.png)

![来自 AstraFoundry 产品页的 Telo 桌面端脚本化交互演示](docs/readme/demo.gif)

_上方截图与动图展示的是来自 AstraFoundry 产品页的 Telo 桌面演示模型（包含聊天列表、会话视图与智能体面板）及其脚本化演示流程，并非已登录真实 Telegram 账号的实时会话。_

## 核心特性

- **原生 TDLib 客户端内核**：在 Electron 主进程中运行 `tdl` 与 `prebuilt-tdlib`（TDLib 1.8.67），为每个账号维护经 `safeStorage` 密钥加密的独立 SQLite 数据库；支持多账号切换（最多 3 个账号）、加密私密聊天（Secret Chats）、服务端与本地关键词文件夹、投票、定时消息、语音消息、贴纸与动画表情。（`prebuilt-tdlib` 不支持 Windows arm64。）
- **工作区上下文感知 AI 智能体**：常驻可折叠右侧面板（`Cmd/Ctrl + B`），基于 AG-UI 事件协议流式传输响应；支持总结未读讨论、提炼决策与待办事项、在输入框内直接翻译或改写/起草回复、通过 `telo://message/...` 链接引用原始消息、解析 `@Name` 提及，并提供触发规则与定时任务自动化（默认 `draft-only` 仅生成草稿，或配置为 `auto-send` 自动发送）。
- **自带账号接入（BYOA）**：基于 AI SDK 原生支持 OpenAI、Anthropic、Google、Groq、xAI、Kimi、DeepSeek 与 Mistral（OpenAI、Anthropic、Google、xAI、Kimi 支持桌面 OAuth 登录；Groq、DeepSeek、Mistral 使用 API Key），并支持任意兼容 OpenAI 协议的 HTTPS 接口作为回退方案。
- **零信任进程边界**：强制开启 `contextIsolation: true`、`sandbox: true` 与 `nodeIntegration: false`。API Key、OAuth 令牌与 Telegram 凭据均由主进程通过操作系统钥匙串（`safeStorage`）加密存储，绝不越过类型化 IPC 边界（`contracts/src/ipc.ts`）进入渲染进程。发送给智能体的上下文会自动脱敏邮箱、手机号与疑似密钥，并将请求提示词的 SHA-256 摘要记录至本地 `agent-audit.jsonl`。
- **精致桌面交互与实时预览设置**：基于 React 19、Electron 44、Tailwind CSS v4、Motion 与 BEUI 组件构建；提供跟随系统 / 浅色 / 深色主题、5 套强调色、12px–18px 消息字号缩放、由主题令牌驱动的聊天背景、支持精确跳转与实时外观/通知预览的设置搜索，以及按会话类型和媒体类型细分的通知与自动下载控制。

## 快速开始

### 环境要求

- **Node.js** `>= 22.0.0`
- **pnpm** `9.0.0` 或更高版本
- **GNU Make**
- **操作系统**：macOS、Windows（x64）或带有图形会话的 Linux

### 安装与运行

```sh
git clone https://github.com/astrafoundry/telo.git
cd telo
make install
make dev
```

若无需登录真实 Telegram 账号或配置 AI 服务商，直接体验内存演示工作区与确定性演示智能体：

```sh
make dev DEMO=1
```

### Telegram 与 OAuth 凭据配置

如需在本地开发时连接真实 Telegram 账号，请传入从 [my.telegram.org](https://my.telegram.org) 申请的应用凭据（或参考 `.env.example` 写入本地 `.env` 文件）：

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

如需启用 Google OAuth（`Connect account`），请提供已开启 Generative Language API 且允许本地回环重定向（`http://127.0.0.1`）的 Google Cloud 桌面端 OAuth 客户端 ID：

```sh
TELO_GOOGLE_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com make dev
```

OpenAI、Anthropic、xAI 与 Kimi 默认使用各厂商公开的原生 OAuth 客户端，也可通过 `TELO_OPENAI_OAUTH_CLIENT_ID`、`TELO_ANTHROPIC_OAUTH_CLIENT_ID`、`TELO_XAI_OAUTH_CLIENT_ID` 与 `TELO_KIMI_OAUTH_CLIENT_ID` 覆盖。未设置 `TELO_GOOGLE_OAUTH_CLIENT_ID` 时，Google 仍可通过 API Key 配置。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `make install` | 按 lockfile 安装依赖并下载 Electron 二进制文件 |
| `make dev` | 安装依赖并以热重载模式启动 Electron 应用 |
| `make dev DEMO=1` | 直接启动进入内存演示工作区 |
| `make reset` | 删除 Electron `userData` 目录并恢复为首次启动状态 |
| `make check` | 运行代码格式化检查、ESLint、TypeScript、单元覆盖率、TDLib 能力基线、Markdown 校验及 Playwright E2E 测试 |
| `make test` | 运行带覆盖率统计的 Vitest 单元与集成测试 |
| `make test-e2e` | 以 `e2e` 模式构建并运行 Playwright Electron 端到端测试 |
| `make test-live` | 运行需凭据解锁的真实 Telegram E2E 测试（需设置 `TELO_LIVE_E2E=1`） |
| `make lint` | 运行 ESLint（包含 Feature-Sliced Design 架构层级边界校验） |
| `make format` | 使用 Prettier 格式化源码与文档 |
| `make docs` | 使用 `markdownlint-cli2` 校验 `README*.md` 与 `docs/**/*.md` |
| `make build` | 使用 `electron-vite` 编译主进程、Preload 与渲染进程产物 |
| `make package` | 准备原生 TDLib 动态库并生成未打包的应用产物目录 |
| `make tdlib-smoke` | 在 `make package` 后校验打包产物中的 `libtdjson` 是否正常加载 |
| `pnpm release` | 使用 `electron-builder` 构建当前平台的安装包与发行产物 |

## 文档索引

- [文档总览](docs/README.md) — 顶层文档地图与使用指南。
- [项目概述](docs/project/README.md) — 产品目标与安全边界。
- [系统架构](docs/project/architecture.md) — 前端 FSD 分层、后端 DDD 分层、IPC 契约与核心数据流。
- [智能体与 AG-UI 集成](docs/project/agent.md) — 流式面板、消息引用、提及补全、BYOA 模型接入、脱敏审计与自动化。
- [Telegram 能力基线](docs/telegram/README.md) — TDLib 能力覆盖矩阵与客户端工作流。
- [前端开发规范 (FSD)](docs/frontend/README.md) — Feature-Sliced Design 规范与跨层导入规则。
- [后端开发规范 (DDD)](docs/backend/README.md) — 领域驱动设计分层、端口与用例编排。
- [本地数据持久化](docs/backend/database.md) — 加密 `userData` 存储文件与单账号 TDLib 数据库说明。
- [本地开发指南](docs/operations/local-dev.md) — 环境变量、运行时配置与调试方法。
- [构建与发布](docs/operations/deployment.md) — 打包流程、原生 TDLib 分发、CI 与发布产物。
- [测试策略](docs/quality/testing.md) — Vitest 覆盖率门禁与 Playwright Electron 端到端测试。
- [架构决策记录 (ADR)](docs/decisions/README.md) — 涵盖 IPC 边界、BYOA 服务商、自动化安全与 TDLib 内核的架构决策。

## 开源协议

本项目基于 [MIT 许可证](LICENSE) 开源。

Telo 是由 AstraFoundry 开发的独立第三方客户端，与 Telegram FZ-LLC 或 Telegram Messenger Inc. 不存在隶属、关联、赞助或官方认可关系。
