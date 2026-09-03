# Telo

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](README.md)
[![简体中文](https://img.shields.io/badge/README-简体中文-red?style=flat-square)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/README-日本語-green?style=flat-square)](README.ja.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square)](https://github.com/ProjectKumo/telo)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

> 现代化、注重隐私的 Telegram 桌面工作区，内置具备工作区上下文感知能力的全局 AI 智能体。

---

## 概述

**Telo** 是一款基于 **React 19**、**Electron 44** 与 **AI SDK** 构建的高性能 Telegram 桌面客户端。它将实时 Telegram 聊天体验与自主 AI 助手无缝融合——AI 智能体可感知当前可见的会话上下文，帮助用户快速总结长篇对话、起草上下文回复、跨语言实时翻译以及提炼待办事项。

Telo 从架构根基上严格遵循隐私与零信任安全规范：所有凭据与 Telegram 会话密钥均驻留在 Electron 主进程中并通过系统级钥匙串（`safeStorage`）加密存储；前端渲染层运行在完全无特权的沙箱隔离环境中，无法接触到任何原始 API Key 或会话机密。

```text
+-------------------+----------------------------------+------------------------+
|    会话列表侧栏   |          当前活动会话            |      全局 AI 智能体    |
|                   |                                  |                        |
| • 单聊 / 群组 / 频道| • 引用回复预览                   | • AG-UI 事件流式输出   |
| • 未读计数与静音状态| • 原地消息编辑                   | • 思考中微光动效       |
| • 置顶对话管理     | • 消息转发与确认删除             | • 工作区上下文感知工具 |
| • 对话搜索过滤     | • 现代化 Markdown 消息输入框     | • 多会话历史记录切换   |
| • 快捷右键操作菜单 | • 气泡右键菜单（复制/回复/编辑） | • 系统级后台完成通知   |
+-------------------+----------------------------------+------------------------+
```

---

## 核心特性

### ⚡ 纯 TypeScript MTProto 客户端内核

- **轻量高效**：基于 `teleproto` 实现纯 TypeScript 的 Telegram MTProto 有线协议，无需引入庞大的 C++ 原生动态库或复杂的 TDLib 编译工具链。
- **顺畅登录流程**：标准手机号登录，支持短信 / Telegram 应用内验证码，以及两步验证云密码（2FA）。
- **零登录演示模式（Demo Workspace）**：使用 `make dev DEMO=1` 启动即可体验完整界面与智能体，无需登录。界面上没有演示入口按钮。

### 🤖 工作区上下文感知全局智能体

- **多模型服务商接入**：原生支持 OpenAI（如 `gpt-4o`、`o3-mini`）及任何兼容 OpenAI 接口协议的服务商（如 DeepSeek、OpenRouter、Groq、Ollama、LM Studio 等）。
- **工作区上下文感知（`inspectWorkspace`）**：智能体可按需读取当前可见的聊天元数据与消息流，基于真实上下文完成问答与任务处理。
- **AG-UI 协议事件流**：遵循 AG-UI 协议进行实时事件流式传输，提供流畅的 `ThinkingShimmer` 思考状态指示、工具调用执行步骤呈现、Token 流式渐显以及友好的异常回退机制。
- **多会话持久化（Threads）**：支持创建与切换多个独立的智能体对话流，会话数据持久保存在本地 `agent-threads.json` 中。
- **智能后台系统通知**：当应用处于非活动或后台最小化状态时，AI 任务完成后将自动触发原生系统桌面通知。

### 🛡️ 零信任安全架构与凭据隔离

- **严格的沙箱与上下文隔离**：开启 `contextIsolation: true` 与 `sandbox: true`，禁用 `nodeIntegration`。禁止不受控的外部页面跳转，外部链接一律通过操作系统默认浏览器安全打开。
- **系统钥匙串加密（`safeStorage`）**：API Key 与 Telegram 登录 Session 写入磁盘前均通过系统安全钥匙串进行加密。
- **渲染层零机密接触**：前端渲染进程仅通过严格类型约束的 IPC 接口与主进程通信，绝不接收任何敏感原始密钥。

### 🎨 匠心打磨的桌面级交互体验

- **丝滑流畅动效**：基于 Motion（Framer Motion v13）与 BEUI 动效组件库构建，包含变形模态框（Morphing Modal）、弹出层与平滑收展侧边栏。
- **全方位个性化定制**：
  - 主题切换：**跟随系统**、**浅色模式** 与 **深色模式**。
  - 5 款精致主题强调色：**经典蓝（Blue）**、**翡翠绿（Green）**、**优雅紫（Purple）**、**珊瑚红（Red）** 与 **活力橙（Orange）**。
  - 动态消息字号调节滑块（**12px – 18px**）。
  - 时间展示格式：**系统默认**、**12 小时制** 与 **24 小时制**。
  - 灵活的发送快捷键：支持配置 `Enter` 发送或 `Cmd/Ctrl + Enter` 发送。
  - 全局快捷键：`Cmd/Ctrl + B` 一键快速展开 / 收起 AI 智能体面板。

### 💬 完善的消息与会话操作

- **引用回复**：可视化引用快照，清晰回溯上下文。
- **消息原地编辑**：已发送消息即时编辑，并展示 `edited` 修改状态标记。
- **跨会话转发**：支持将消息转发至目标会话，并实时更新侧边栏对话预览。
- **安全删除**：带确认对话框的安全消息删除。
- **会话管理**：置顶 / 取消置顶、开启 / 关闭静音通知、标记已读 / 未读。

---

## 架构设计与工程规范

Telo 采用业界成熟的分层与模块化架构设计：

```text
+-------------------------------------------------------------------------+
|                       前端：React 19 (特性切片设计 FSD)                  |
|    app  -->  pages  -->  widgets  -->  features  -->  entities  --> shared|
+-------------------------------------------------------------------------+
                                    |
                    严格类型约束的 IPC 通信层 (contextBridge)
                    contracts/src/ipc.ts (TeloDesktopApi)
                                    |
+-------------------------------------------------------------------------+
|                    后端：Electron 主进程 (领域驱动设计 DDD)              |
|     interfaces  -->  application  -->  domain  <--  infrastructure     |
+-------------------------------------------------------------------------+
          |                         |                        |
     [Teleproto]                [AI SDK]             [safeStorage]
   (Telegram MTProto)      (OpenAI / 兼容接口)     (系统钥匙串加密本地存储)
```

- **前端（Feature-Sliced Design）**：清晰的单向依赖流，从高层到低层依次为 `app`、`pages`、`widgets`、`features`、`entities`、`shared`。
- **后端（Domain-Driven Design）**：纯净无框架依赖的 `domain` 核心业务逻辑，通过 `application` 编排用例，并在 `infrastructure` 中对接具体适配器。
- **类型安全 IPC 契约**：主进程与渲染进程之间的所有调用与事件均在 `contracts/src/ipc.ts` 中完成端到端类型定义。

---

## 快速上手

### 环境要求

- **Node.js**：`v22.0.0` 或更高版本
- **包管理器**：`pnpm` `v9.0.0` 或更高版本
- **构建工具**：`GNU Make`
- **操作系统**：macOS、Windows 或带有图形界面的 Linux

### 安装与启动

1. **克隆代码仓库**：

   ```sh
   git clone https://github.com/ProjectKumo/telo.git
   cd telo
   ```

2. **安装项目依赖**：

   ```sh
   make install
   ```

3. **启动开发环境**：

   ```sh
   make dev
   ```

### 注入自定义 Telegram 凭据运行

如需登录正式 Telegram 账号，请在启动时注入从 [my.telegram.org](https://my.telegram.org) 申请的 API 凭据：

```sh
TELO_TELEGRAM_API_ID=1234567 TELO_TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef make dev
```

Google 账号登录需要 Google Cloud 的桌面应用 OAuth 客户端 ID（启用 Generative Language API，并允许回环 `http://127.0.0.1`）：

```sh
TELO_GOOGLE_OAUTH_CLIENT_ID=123456789.apps.googleusercontent.com make dev
```

OpenAI、Anthropic、xAI 和 Kimi 的 Connect 使用各厂商公开的原生 OAuth 客户端。如需覆盖，可设置 `TELO_OPENAI_OAUTH_CLIENT_ID`、`TELO_ANTHROPIC_OAUTH_CLIENT_ID`、`TELO_XAI_OAUTH_CLIENT_ID`、`TELO_KIMI_OAUTH_CLIENT_ID`。

如需打开内存演示工作区而非引导页：

```sh
make dev DEMO=1
```

_注：若构建时未提供 API 凭据，正式包会显示凭据缺失提示而非登录表单。演示工作区是本地启动参数，不是回退方案。_

---

## 质量保障与测试体系

Telo 配备了严格的端到端与单元测试流水线：

```sh
# 运行完整质量把关门禁 (格式化、ESLint、类型检查、单元测试覆盖率、文档检查、E2E 测试)
make check

# 运行 Vitest 单元与集成测试（带覆盖率统计）
make test

# 运行 Playwright Electron 端到端自动化测试
make test-e2e

# 运行代码规范检查与格式化
make lint
make format
```

- **Vitest**：运行前后端单元与集成测试，强制执行严格的代码覆盖率标准（行数、函数、语句不低于 80%，分支不低于 75%）。
- **Playwright**：在真实的打包 Electron 环境中运行端到端测试，全面覆盖新手引导、消息收发、设置持久化、智能体问答与异常熔断等关键业务旅程。

---

## 常用命令一览

| 命令            | 说明                                                            |
| --------------- | --------------------------------------------------------------- |
| `make install`  | 按 lockfile 安装项目依赖并下载 Electron 二进制                  |
| `make dev`      | 先安装依赖，再启动开发模式并开启热更新（Hot Reload）            |
| `make check`    | 运行完整的发布前检查（格式化、Lint、类型、单元测试、文档、E2E） |
| `make test`     | 运行基于 Vitest 的单元与集成测试，并输出覆盖率报告              |
| `make test-e2e` | 运行基于 Playwright 的 Electron 端到端全流程测试                |
| `make lint`     | 运行 ESLint 并校验 Feature-Sliced Design 架构层级边界           |
| `make format`   | 使用 Prettier 自动格式化源码与文档                              |
| `make docs`     | 使用 markdownlint 校验所有 Markdown 文档规范                    |
| `make build`    | 使用 electron-vite 编译主进程、Preload 与渲染层代码             |
| `make package`  | 构建未打包的应用程序产物目录                                    |
| `make reset`    | 删除 Electron 用户数据，下次启动回到首次运行                    |

---

## 配置与本地数据存储

Telo 将所有用户数据与配置持久化在 Electron 的系统 `userData` 目录下：

| 文件名称             | 作用说明                                      | 存储加密方式                    |
| -------------------- | --------------------------------------------- | ------------------------------- |
| `agent.json`         | AI 智能体模型配置、加密 API Key 与 OAuth 令牌 | 经 `safeStorage` 加密           |
| `agent-threads.json` | 历史智能体对话流记录与当前活动会话 ID         | 明文 JSON                       |
| `telegram.session`   | Telegram MTProto 登录鉴权 Session 密钥        | 经 `safeStorage` 系统钥匙串加密 |
| `telegram.profile`   | 当前登录用户信息与头像缓存                    | 经 `safeStorage` 加密           |
| `dialogs.json`       | 会话列表与文件夹角标快照，供恢复登录时使用    | 明文 JSON                       |
| `preferences.json`   | 主题、强调色、字体大小、时间格式与快捷键偏好  | 明文 JSON                       |

_在无桌面钥匙串的无头 Linux CI 环境中，可通过配置 `TELO_PLAINTEXT_SECRETS=1` 启用 base64 回退模式进行自动化测试。_

---

## 打包与跨平台发布

为目标操作系统生成开箱即用的安装包与可执行文件：

```sh
# 构建跨平台发行包
pnpm release
```

- **macOS**：Apple Silicon (arm64) 与 Intel (x64) 的 DMG 安装包及 ZIP 压缩包（`.dmg`, `.zip`）
- **Windows**：NSIS 安装引导程序（`.exe`）
- **Linux**：通用 AppImage 与 Debian 安装包（`.AppImage`, `.deb`）

---

## 技术文档索引

欲深入了解系统设计与实现细节，请参阅 [`docs/`](docs/) 目录下的技术文档：

- [系统架构设计 (Architecture)](docs/project/architecture.md) — 模块边界、数据流转与 IPC 通信设计。
- [AI 智能体与 AG-UI 协议 (Agent & AG-UI)](docs/project/agent.md) — AG-UI 事件协议、工作区快照机制与多会话管理。
- [前端开发规范 (FSD Guidelines)](docs/frontend/README.md) — Feature-Sliced Design 架构规范、层级划分与组件使用约定。
- [后端开发规范 (DDD Guidelines)](docs/backend/README.md) — 领域驱动设计实践、仓储接口与用例编排。
- [本地开发指南 (Local Development)](docs/operations/local-dev.md) — 详细环境配置、凭据调试与常见问题。
- [测试策略规范 (Testing Strategy)](docs/quality/testing.md) — Vitest 覆盖率要求与 Playwright Electron 测试装置。
- [构建与发布流程 (Release Process)](docs/operations/deployment.md) — 构建矩阵、代码签名、应用公证与发布回滚。

---

## 免责声明

Telo 是一个独立的第三方开源客户端，**未**与 Telegram FZ-LLC 或 Telegram Messenger Inc. 建立隶属、关联、授权、认可或以任何方式正式连接的关系。

---

## 开源协议

本项目采用 [MIT 许可证](LICENSE) 进行开源。
