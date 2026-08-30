# 产品差距

对照「能整天当日常客户端用」和「消息级助手能作用在当前这条消息上」，按执行顺序拆成可勾选项。
原生 Telegram 能力的全量账本另记；本文件只收 **必须补才能当日常客户端**、**消息级 AI 写回**、以及 **交互 / 动画接到聊天主路径** 的项。

判据：用户能否把 Telo 整天开着处理真实对话，并在同一条消息上「翻译 / 起草 / 发出去」，而不跳到 ChatGPT 或其它客户端。现在两条都不成立。

## 不做

这些是另一条产品线，且与 Telo「Agent 不代操作 Telegram」冲突。不要当差距补。

- [ ] ~~多链钱包 / 托管 / dApp / Stars / NFT~~
- [ ] ~~AI Token 经济 / Agent Marketplace~~
- [ ] ~~通话录音 / 替代通话通道~~
- [ ] ~~隐藏账号 / 隐藏会话（P0）~~ — 工作区定位可后置，不当第一批
- [ ] ~~通话、群组通话、屏幕共享、Stories、Secret Chats、论坛 Topics、频道评论、机器人 / Mini Apps~~ — 默认 P2，见 Wave 7

## Wave 1 — 同步与文本会话正确性

没有这些，后面 UI 都是空壳。

- [x] 订阅 Teleproto typing / draft / mute / pin 更新（folder 级更新留给 Wave 2 文件夹项）
- [x] 映射真实用户、会话、发送者、头像；Saved Messages 与 mute 用服务端状态（侧栏不要只画 initials）
- [x] 每会话记住滚动位置
- [x] 乐观发送：稳定临时 ID、`sending/sent/read/failed`；失败时气泡以 `failed` 留在消息流（不回填 composer，不吞错）
- [x] 发送失败后的一键重试（失败气泡右键 Resend 重发同一 body；成功归位 sent，失败保持 failed；Delete 保留）
- [x] 本地 / 云端草稿；切聊天不丢输入
- [x] 输入状态：顶栏 + 会话列表行（已接事件，动效用已有 `MessageTyping`）
- [x] 未读消息桌面通知：mute / 焦点 / 点进对应会话（`shell.notify` 已接收件通知与点击选中会话）
- [x] 日期分隔、点击回复条跳到源消息
- [x] 未读分界线（`ChatDto.lastReadMessageId` ← teleproto `readInboxMaxId`；`MessageMarker` 标在首条未读前；界标未加载时自动向上分页直至找到或耗尽）
- [x] 同步脊柱的 application / IPC / Vitest / Playwright 覆盖

## Wave 2 — 能当主客户端的最低线

`MessageDto.body: string` 必须扩成实体模型（`contracts/src/ipc.ts`）。没有媒体就没有可给 Agent 看的上下文。

- [x] 消息实体与富文本：完整 Teleproto 实体映射、UTF-16 范围校验、嵌套语义渲染、安全链接与 Spoiler；发送格式化控件仍在 Wave 6
- [x] 媒体接收：照片 / 视频 / 文件元数据、安全缓存下载、下载进度 / 取消 / 重试、BEUI 媒体卡片渲染
- [x] 媒体发送：照片 / 视频 / 文件选择与上传、上传进度 / 取消 / 失败重试、相册批量发送（`groupedId`，≤10 个，单文件 ≤2GB）
- [x] 媒体查看器（灯箱）、打开 / 另存、相册网格布局、缩略图预加载与缓存容量治理 — `shared/ui` 新原语 `MediaViewer`（缩略图原点缩放、Esc/点击关闭、方向键导航、reduced-motion 静态淡入）；新 IPC `saveMediaAs`（save 对话框 + 拷贝缓存文件）/`openMedia`（`shell.openPath`），经 `resolveMediaFile` 端口先下载；`groupedId` 连续视觉消息合成单相册网格（首格带说明）；IntersectionObserver 预加载照片 / 视频 / 链接预览缩略图（进度仅显式下载可见）；`media-cache.ts` LRU 512MB 上限（mtime + touch）；demo 媒体可下载（确定性 PNG + 内置 WebM，发送媒体拷原始字节），e2e 重新启用 telo-media 协议处理器
- [x] 链接预览（`MessageMediaWebPage` → `webpage` 媒体变体，`shared/ui` `LinkPreview` 卡片走安全外链；缩略图预加载归查看器项）
- [x] Telegram 原生文件夹 + Archive + 文件夹未读（关键词文件夹放 Wave 6）— `ChatFolderDto` + `ChatDto.folderId` + `listFolders`/`folders` 事件；teleproto 映射 `getDialogFilters`/filter 更新（`teleproto-folders.ts`），Archive = 文件夹 1；demo 有 Work 文件夹 + 一个归档会话；侧栏无动效文件夹页签（All / 文件夹 / Archive），未读角标取服务端计数，活动页签存于 chat-store（内存态）
- [x] 服务端全局搜索 + 会话内搜索 — `GlobalSearchResultDto`/`MessageSearchPageDto` + `searchGlobal`/`searchMessages` IPC；teleproto 走 `getMessages(undefined, { search })`（messages.searchGlobal）+ 标题过滤最近 200 个 dialog，会话内 `messages.Search`（newest-first ids + `count`）；demo 在 fixture 上复刻两者；侧栏搜索防抖 300ms 查服务端、分 Chats/Messages 两节，点消息结果走 reply-jump 同款 page-until-found 跳转并高亮（`bg-primary/10` 静态染色）；会话内搜索栏显示「n of total」，Enter/Shift+Enter + 上下按钮导航（缺页时自动取下一页），Esc 关闭并清掉高亮
- [x] 会话顶栏：头像、在线 / 输入中、搜索、置顶 — `ChatDto.presence`（teleproto `UserStatusOnline` 映射 + `UpdateUserStatus` → `chat-presence` 事件；demo 归档会话 Offsite Planning 为 online 单聊）；顶栏在输入中时显示 `MessageTyping`、否则 online 时显示状态行；搜索开关打开会话内搜索栏；置顶按钮走已有 `setChatPinned`（图标 fill/regular 表态）；按钮 ≥40px、无动效

## Wave 3 — 消息级 AI 写回 composer

Telo 该赢的面。账本「Telo workspace differentiation」目前全空。Agent 现在只有只读 `inspectWorkspace`；消息菜单只有 Reply / Edit / Copy / Forward / Delete。

- [x] 消息菜单动作：翻译 / 润色 / 起草回复（语气可选）；**结果插入 composer，不停在右侧面板** — 气泡菜单新增 Translate / Rewrite / Draft reply（Neutral / Friendly / Formal 三项语气，BEUI 无子菜单原语，用 inset 项 + `ContextMenuLabel`），仅对 `sent/read` 且有正文的消息显示；`RunAgentInput.action` 走已有 `agent.run` 通道，后端新用例 `RunMessageActionService` 组装带 `[[telo-action:*]]` / `[[telo-tone:*]]` / `[[telo-input]]` 标记的结构化 prompt（不写 thread）；结果以 CUSTOM AG-UI 事件 `message-action` 回流，chat-store `runMessageAction` 增量写入 composer draft（translate/rewrite 替换、draft-reply 追加在已有文本换行后），`draftStream` 信号同步进 textarea（发送/上传流程不受影响），保存走既有 500ms 防抖；流式期间菜单项禁用 + 转圈图标，错误内联显示在 composer 上方；`DemoAgentGateway`（`TELO_DEMO_WORKSPACE=1` 时替换 AiSdk 网关）确定性应答，e2e `message-ai.spec.ts` 覆盖三条路径
- [x] 摘要未读；citation 可滚到原消息 — `runChatSummary` IPC + `RunChatSummaryService`（`[[telo-action:summarize]]` + `unread` scope，载荷主进程装配 / 脱敏 / 审计；`promptLabel` 让 transcript 显示动作名而非机器 prompt）；面板动作行「Summarize unread」（无未读文本时禁用）；回复中 `[[telo-cite:id]]` 由 `parseCitations` 剥成编号 chip，点击走 `requestJumpToMessage` 翻页跳转 + 高亮，chat 未知（历史线程）时 chip 禁用 + tooltip；demo gateway 确定性摘要，e2e `agent-summary.spec.ts` 覆盖摘要 → citation 跳转
- [x] 显式上下文范围：选中消息 / 未读 / 当前文件夹；预览即将发给模型的内容 — `RunAgentInput.scope`（`AgentContextScopeInput`：selected / unread / folder）；主进程 `AgentContextService` 经 `TelegramRepository` 装配（unread = 会话最近 `unreadCount` 条 incoming，与 demo 读界设计一致；folder = 活动文件夹各会话未读，null = All 排除 Archive；selected = 指定 id 翻页取全）；面板 composer 区分段选择器（无回复目标时 Selected 禁用 + tooltip，多选归 Wave 4 批量项），默认 Unread（面板本就面向当前会话，最不出乎意料）；「Payload preview」用 `AgentDisclosure` 展开显示脱敏后的逐条 sender / body / message id（WYSIWYG），e2e `agent-context.spec.ts` 覆盖 folder 与 selected（回复目标）两条路径
- [x] 发送前：范围、脱敏字段、本地审计（BYOK 更该把边界做清楚）— 域层纯函数 `agent-redaction.ts`（邮箱 / 电话 / API-key 形 token 三类占位符 + 计数；电话需 ≥10 位或 `+` 前缀 ≥7 位，避免误伤日期 / id），装配即脱敏，预览所见即所发；载荷以 `[[telo-input]]` + `id: <id> | <sender>: <body>` 行嵌进 prompt（沿用 chat-action 约定，demo gateway 与 citation 标记直通）；每次 run 追加 `agent-audit.jsonl`（`FileAgentAuditRepository`，0o600）：timestamp / action / scope / message ids / 脱敏计数 / model / 完整 prompt 的 SHA-256（不存原文），装配失败不审计（无载荷出设备）；面板「Recent runs」折叠列出近 5 条（scope · 消息数 · 脱敏数 · 时间），`agentAuditList` IPC 取近 50 条
- [x] 决策 / 待办 / 未答问题抽取（可与摘要共用引用跳转）— `runChatExtraction` IPC + `RunChatExtractionService`（`[[telo-action:extract]]`，Decisions / Open questions / Action items 分组）；面板「Extract decisions & todos」与摘要共用 scope、citation 解析与跳转；demo gateway 同摘要输出，e2e 覆盖抽取 → citation 跳转

## Wave 4 — 桌面交互密度

桌面主路径应对齐 Telegram Desktop：悬停动作、键盘、文件夹条。Telo 主路径几乎只有右键 / 长按 520ms；产品快捷键基本只有 `Cmd+B`。布局是死的 `280px | 1fr | 380px`。

- [x] 消息悬停动作条：Reply / AI（翻译、起草）— 绝对定位 overlay（不挤布局），仅 `pointer-fine` hover 与 focus-within 显示，≤100ms opacity 淡入（reduced-motion 无过渡），按钮 ≥40px；AI 为 MorphPopover（Translate / Rewrite / Draft reply 三语气，与右键菜单同一 `runMessageAction`）；右键菜单仍是完整动作列表；album 气泡无 rail（与其现无右键菜单一致）。**反应位暂缓**：contracts / teleproto / demo 均无 reactions 支持，按「不 ship 死按钮」省略该槽位，待 Teleproto reactions 接入后补
- [x] 快捷键 — `shared/lib/use-hotkeys.ts`（无新依赖；输入框内不触发，除 Esc / Cmd+K / Cmd+F；有 overlay 打开时让位）：`Cmd/Ctrl+K` 全局搜索 palette（BEUI Combobox，挂 app 层、仅打开时挂载，即时开关无 morph；结果 = Wave 2 服务端全局搜索 chats+messages，Enter 打开会话 / 跳消息，Esc 关闭）；`Cmd/Ctrl+F` 打开并聚焦会话内搜索（顶栏 tooltip 标注）；空 composer `ArrowUp` 编辑最后一条 outgoing（Telegram Desktop 惯例）；`R` 回复 / `Delete` 批量删除均绑定多选模型（无歧义才生效）；`Esc` 依次退出 selection → reply/edit → 会话内搜索；聊天列表 `ArrowUp/Down` 夹取式导航即打开（自动滚入视野），`Enter` 聚焦 composer
- [x] Composer：拖放 / 粘贴附件、emoji、静音发送（现在是单行 `PromptInput` + 回复 / 编辑预览条）— 拖放 / 粘贴 / 文件选择共用同一 `addFiles` 入口与 10 个上限校验，粘贴截图确定性改名 `screenshot-<timestamp>.<ext>`；拖入高亮为静态 token（`border-primary/60 bg-primary/5`，transition-colors）；`SendMessageInput.silent` 端到端（teleproto `silent:true`，demo 静音发送不触发 typing / 自动回复，e2e 可观测），发送按钮右键 / 长按 BEUI ContextMenu「Send without sound」（有附件或编辑时禁用，silent 只走文本路径）；emoji 选择器为 BEUI MorphPopover + 分类页签 + 搜索 + Frequently used（`recentEmojis` 偏好持久化，backend 域去重 cap 24），数据集为手工精选 Unicode 子集（非全量目录），光标处插入并恢复 caret；`PromptInput` 新增 `inputRef` / `sendMenuContent` / `sendMenuLabel` props
- [x] 转发：目标搜索、多条、保留 / 隐藏发送者 — `ForwardMessageInput.hideSender`（可选、向后兼容；teleproto 映射 `forwardMessages` 的 `dropAuthor`）；`MessageDto.forwardedFrom`（teleproto 从 `fwdFrom.fromName` / `fromId` 实体解析，demo 默认记录原发送者、链式转发保留原作者，hideSender 置 null；气泡（含相册）已渲染「Forwarded from」归属行；picker 重写：标题过滤已加载会话列表、多目标选择（行内圆形选中指示，`aria-pressed`）、「Hide sender」Switch、底部 Forward 逐目标循环发送（批量助手即循环，契约保持单条）；失败内联 `role=alert` 留在对话框
- [x] 删除：Delete for me / everyone — `DeleteMessageInput.scope`（`DeleteMessageScope`："me" | "everyone"；省略 = everyone，保持历史行为：teleproto 一直 `revoke:true`，现 `revoke: scope !== "me"`）；application 层校验 scope 取值；demo 强制语义：for-everyone 全删，for-me 仅本地隐藏（记录保留、listMessagePage / searchGlobal / searchMessages 过滤）；对话框对 outgoing 给两项（RadioGroup，默认 everyone 对齐旧行为），incoming 仅 for me（Telegram 规则），批量含 incoming 时同样仅 for me
- [x] 列宽可调；窄窗压成会话列表 ↔ 会话 — 三列 drag handle（pointer 1:1、双击复位、方向键微调），宽度经 `sidebarWidth` / `agentPanelWidth` 偏好持久化（backend 域 200–480 / 280–600 clamp）；≤768px 窄窗单列列表 ↔ 会话（返回按钮），agent 面板隐藏；`minWidth` 降到 420 让窄布局可达；断点常量 `NARROW_WORKSPACE_BREAKPOINT_PX`（pages/workspace/model/layout.ts）
- [x] 多选消息；批量转发 / 删除 — 右键「Select」进入选择模式，per-bubble 勾选钮（≥40px、fill/regular 表态、固定在行首侧），composer 区换成静态动作条（计数 `n selected` / Forward / Delete / X 关闭）；批量 Forward 逐条循环既有 `forwardMessage` 契约（不改契约；目标选择用独立的 `ForwardSelectedDialog` — 单条 picker 归转发工作流，暂不能共用，后续可合并）；批量 Delete 逐条串行调用（防洪限），本地移除与单条共用 `removeMessagesLocally`；Esc / X 退出，切聊天或远端删除自动清理选择；选择模式解锁 `R`（单选回复）与 `Delete` 键；album 消息暂不可选（与其无单条动作一致）
- [x] 置顶区在会话列表可见分组 — 每个文件夹视图内 pinned 会话渲染在顶部「Pinned」标签分组，未置顶在其下（纯渲染，无 regroup 动效）；分组在 folder 过滤之后，All 视图保留自定义文件夹会话于未置顶区（与 Telegram All 列表一致）
- [x] 资料页、共享媒体、置顶消息导航、返回栈 — 新 widget `widgets/chat-profile`（右栏复用 agent 面板列宽与 offcanvas AnimatedSidebar，宽窗与 agent 面板互斥——widget 内 zustand 订阅双向关闭；窄窗替换会话列）：头部 Avatar / 标题 / online 或会话类型副标题；`listSharedMedia` + `listPinnedMessages` 新 IPC（teleproto 双 media filter `InputMessagesFilterPhotoVideo`+`InputMessagesFilterDocument` 合并去重分页、`InputMessagesFilterPinned`；demo 确定性 fixtures：design 5 条媒体 + 2 条置顶）；主视图分节预览（Shared media 前 6、Pinned 前 3）→ 节视图全量，widget 内 back stack 记录各视图 scrollTop，Back 恢复滚动位；媒体格点击开既有 `MediaViewer`（下载走 chat-store 管线），文件节走 `MessageMedia` 卡片；置顶消息点击复用 `requestJumpToMessage` 跳转 + 高亮；顶栏「Chat info」按钮经 `features/toggle-chat-profile`（conversation-view 仅两行接入）

侧栏选中保持 `pressScale={1}`：高频导航不加弹簧。

## Wave 5 — 接到已有动效

BEUI 里已有能力，产品没接到聊天主路径。Onboarding（横滑 + TextReveal + OTP 翻滚）不必再加。Agent 面板现有 offcanvas 弹簧够用，不要从 Sparkle 做 FLIP morph。

find-animation-opportunities（只读，全部落在本波清单；闸门四问已过）：

| #   | Location                                      | Today                                                                         | Purpose                     | Frequency                                    | Suggested motion                                                                                                                                              |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `conversation-view.tsx` transcript `Message`  | History, prepend, and live sends all mount still (`animateIn` default false)  | Preventing a jarring change | Occasional (live send / arrival), not paging | `animateIn` only for store-flagged new/just-sent ids; BEUI pop-up spring. Prepend stays `animateIn={false}`. Reduced-motion: BEUI opacity-only (no translate) |
| 2   | Header + `conversation-sidebar` `ChatListRow` | Dots **and** visible “Typing…” always                                         | State indication            | Tens/day                                     | Motion: `MessageTyping` three dots (`EASE_OUT` 1.05s loop). Reduced-motion: static `copy.typing` text, no dots                                                |
| 3   | Sidebar list order on pin / new-top           | Pin regroups instantly; new message patches in place (no bump)                | Preventing a jarring change | Tens/day                                     | Relocate the row (pinned → slot 0, unpinned → first unpinned). `opacity` 150ms `cubic-bezier(0.16, 1, 0.3, 1)` on that row only. **No** `layout` spring       |
| 4   | `MessageFooter` delivery glyph                | Instant `Checks` / `WarningCircle` swap; sending looks like sent              | State indication            | Tens/day                                     | Crossfade 140ms `EASE_OUT` in a fixed `size-4` slot (`mode="sync"`). Row does not move                                                                        |
| 5   | Theme (`hooks.ts` + `index.html`)             | Module applies `system` until IPC; users with a stored light/dark see a flash | Preventing a jarring change | Occasional (toggle); startup is not a reveal | Sync `telo:theme` cache + boot script (no motion). User toggle: View Transition circular `clip-path` 280ms from pointer, **no** `filter: blur()`              |
| 6   | `MediaViewer` via `ConversationMediaViewer`   | Origin scale already wired (`origin` from thumbnail rect)                     | Spatial consistency         | Occasional                                   | Keep origin-aware Motion enter/exit (interruptible transitions). Do not ship an empty lightbox                                                                |
| 7   | Voice / stickers                              | No voice notes or stickers in the product                                     | —                           | —                                            | **Skip** waveforms and looping playback until Wave 6 content exists                                                                                           |

Rejected (gate): chat-row / folder-tab springs (100+/day nav; `pressScale={1}` stays); history prepend motion (fights scroll compensation, user is reading); Agent Sparkle FLIP (Wave 5 intro); full-page theme blur (checklist forbids it); list `layoutId` (checklist forbids it).

- [x] 仅对**新到达 / 刚发送**开 `Message animateIn`；历史分页保持无动画（现有 prepend 补偿保留）— `chat-store.animateInMessageIds`；`select` / `load` / prepend 不写入
- [x] 顶栏 + 列表行 `MessageTyping` 三个点；reduced-motion 用「Typing」文字
- [x] 对话列表重排：置顶 / 新消息上顶 ≤150ms opacity，或不动；禁止整表 layout 弹簧 — 行 `data-promote` 150ms opacity，无 layout
- [x] 投递状态字形交叉淡入（pending → sent/read/failed），120–160ms，行本身不动 — 140ms opacity，固定槽位
- [x] 主题切换：避免启动闪系统主题；可选 Telegram 式圆形揭示，不要全页 blur — `telo:theme` 同步缓存 + 圆形 View Transition
- [x] 有媒体之后再做灯箱（缩略图 → 全屏，可打断）；没内容不做空动画 — Wave 2 `MediaViewer` 已原点缩放，可打断；无新媒体动画
- [x] 有语音 / 贴纸后再做波形与循环播放 — 暂无语音/贴纸，跳过
- [x] reduced-motion：高频路径能关则关；补 typing / 新消息的静态替代（无位移淡入）— Typing 文案；新消息无位移；列表 promote / 投递淡入降为瞬时

## Wave 6 — 工作区定位增强

符合 Telo 工作区，而不是再做一个通用聊天客户端。

- [x] 关键词文件夹 / 关键词追踪（搜词 → 自动归集未来匹配）— `ChatFolderDto.kind: "keyword"` 与 native 分型；匹配规则为消息 `body` 的大小写不敏感子串；未读随 workspace 事件重算；CRUD 走 settings 对话框 + DDD 持久化；demo 预置 Spacing 文件夹匹配 Telo Design
- [x] 快捷回复 / 模板（与 Agent「起草」共用 composer）— `MessageTemplateDto` 存进 `UserPreferencesDto.messageTemplates`，域层 `normalizeMessageTemplates` 兜住形状与上限（50 条 / 标题 80 / 正文 2000，缺 id 补 uuid，空白项丢弃）；`TemplatePicker` 为 BEUI MorphPopover：列表 + 新建 / 编辑 / 删除表单，选中经 `insertAtCaret` 插在光标处并恢复 caret——与 emoji 和 Agent 起草回流是同一条 draft 写入路径（共用 composer 的要求即此）；列表行走 `shared/ui` 新原语 `OptionRow`
- [ ] 语音 / 视频笔记与转写——已调研，未开工。**结论：不是贴纸那种情况，协议层全支持**：teleproto 的 `sendFile` 直接收 `voiceNote` / `videoNote` 布尔（`teleproto/client/uploads.d.ts:86-88`），`DocumentAttributeAudio.waveform` 与 `DocumentAttributeVideo.roundMessage` 均已导出，Telegram 自带的 `messages.TranscribeAudio` 也在（`tl/generated/api.d.ts:30079-30087`）。所以没有任何部分需要因协议而暂缓，分三波推进：
  - [ ] Wave A（收 + 放）— 接收映射已做了一半：`teleproto-message-media.ts:58-74` 的 kind 阶梯把 videoNote / voice 排在 video / audio 之前，duration 也已填充；但渲染端只有个带 `FileAudio` 图标的通用下载卡，无 `<audio>`、无播放 / 拖动 / 波形，duration 拿到了却不显示。本波：contracts 补 `waveform` / `title` / `performer`、adapter 读 5 bit 打包波形、`shared/ui` 新音频原语、圆形视频笔记气泡、demo 固件、共享媒体 Voice 分区，并把「能预加载」从「是视觉媒体」里拆出来（语音要预加载但不进灯箱）。开工提示：那三个字段设为必填会打穿 7 个文件里的 19 处固件字面量，须连同固件一并改，别半途留下红色 typecheck
  - [ ] Wave B（录 + 发）— 录制基础设施全仓为零（搜 MediaRecorder / getUserMedia 只撞到两个 emoji 关键词）。两个真存疑问：Telegram 是否直接收 Chromium 的 Ogg/Opus，以及圆视频的 H.264 是否迫使引入 ffmpeg（`demo-media-assets.ts:6-9` 已记录 Chromium 无 H.264 解码）；若编解码结论不利，语音发送与圆视频发送应就地拆开。还需 `setPermissionRequestHandler` 与 mac `NSMicrophoneUsageDescription`（`package.json` 的 `build.mac` 现无 `extendInfo`，打包才爆、开发期看不到）。好消息：preload 已有 `bytes` 分支，MediaRecorder 产物走现有传输链零修改
  - [ ] Wave C（转写）— 严格依赖 Wave A（`MsgVoiceMissingError`），但**不**依赖 Wave B：别人发来的语音无需会录制即可转写。路线 A（Telegram 自带 RPC）更小且不新增隐私面，但受 Premium 限制，UI 必须诚实降级（`trialRemainsNum` 可给文案真实依据）；路线 B（自带模型）需新 `TranscriptionGateway` 端口（`AgentGateway.stream` 仅文本），且 Wave 3 的脱敏机制管不了音频——属于隐私边界决策，不能当实现细节夹带
- [ ] 多账号：Telegram 级 3 个即可，不追求无限账号——已调研，**阻在三个产品决策上，需人工拍板**：Agent 是否跨账号（`agent-audit.jsonl` 存在就是为了记录什么离开了设备，共享后就说不清某次负载来自哪个账号）、未读是否跨账号汇总、关键词文件夹与消息模板是否每账号独立。技术上最难的两处反而已经是对的：`TeleprotoRepository` 本就是 per-client 实例（状态全为实例字段，13 个 handler 注在该 client 上），秘密存储的 `filePath` 是构造参数，改成每账号路径是注入而非重写。真正难的是渲染层：`chat-store.ts` 1615 行，`messages` 是只装当前会话的平数组，drafts / scrollPositions 仅以 chatId 为键——而两个账号同在一个群时 chatId 相同，草稿会静默串号并被 `scheduleDraftSave` 写到错的账号。拆波沿现有 `TelegramRepository` 端口缝：
  - [ ] Wave A — 只多路复用后端（注册表 / 每账号秘密路径 / coordinator 改 Map / 修 `beginLogin` 拿旧 session 种新账号的 bug / 事件加 accountId 信封），保持单账号可见，靠 demo repository 就能双账号并行验证
  - [ ] Wave B — 渲染层分账号与切换器（`features/account-menu` 已就位，`Avatar` + `OptionRow` 即可，无需新 BEUI 组件）
- [x] 表情 / 贴纸 / GIF 选择器、格式化、mention — 表情选择器在 Wave 4 已落地；格式化为 `composer-entities.ts` 的 UTF-16 实体运算（`diffEdit` / `shiftEntities` / `toggleFormat` / `insertAt` / `trimOutgoingMessage`，受控 textarea 只报新值，故用前后缀 diff 推出改动区间再迁移实体），`FormattingToolbar` 六项（粗 / 斜 / 下划线 / 删除线 / 等宽 / 剧透）带 `aria-pressed` 与 40px 命中区，`SendMessageInput.entities` 端到端（teleproto `mapMessageEntitiesForSend` 只映射用户显式授权的 span，不做自动解析；demo 存回实体）；mention 为 `mention-query.ts`（光标处 `@` 查询 / 成员过滤 / 插入）+ 新 `ChatMemberDto` 与 `listChatMembers` IPC（teleproto `getParticipants`，demo 确定性成员），`MentionAutocomplete` 是 `OptionRow` 组成的 listbox，上下键 + Enter 选中、Esc 关闭。**贴纸 / GIF 暂缓**：contracts / teleproto / demo 均无 sticker / GIF 支持，按「不 ship 死按钮」省略入口（同 Wave 4 反应位的处理）

## Wave 7 — 默认不做

需要明确产品决策后再开。不要混进前面的波次。

- [ ] 一对一 / 群组通话、屏幕共享
- [ ] Stories、Secret Chats、论坛 Topics、频道评论
- [ ] 机器人、Mini Apps、Stars
- [ ] 隐藏账号、隐藏会话
- [ ] 钱包 / Web3 / 托管

## 质量门（每波都要过）

- [x] UI 只走 `shared/ui`；缺组件向上游 BEUI 补，不在产品 slice 再造一套 — Wave 6 的 mention / 模板列表原本各自手写 `<button>` 行，
      已收进 `shared/ui` 新原语 `OptionRow`（两种排版、`min-h-10`、press scale 0.96、显式 `aria-label` 免得两行文字连读，
      并在类型上 omit 掉 Motion 的 `layout` / `layoutId`——列表里的 layout 动画会和滚动打架）；
      收尾复查又清掉三处遗留自造控件：emoji 表情格与分类页签改用 `Button size="icon"`（本就是 `size-10 rounded-lg`，顺带白拿 press spring 与 ripple 关闭态），
      回复引用块改用新原语 `PressableBlock`（`Button` 的尺寸档表达不了「整块可按、自带左边框和两行富文本」，该原语只给按压弹簧 / 0.96 / focus ring，视觉全交调用方）；
      composer 的隐藏 `<input type=file>` 是平台机制，不算自造控件
- [x] press scale 全仓一律 0.96 — 收尾把漂移的 vendored BEUI 拉平：checkbox / radio 0.92、action-swap 0.97、animated-sidebar 四处 0.98，
      以及当前未被引用的 tool-approval 0.97 与 file-diff / tool-result / code-block 0.9 也一并归一，避免它们日后被引入时再把偏差带回来
- [x] 文案进 `shared/config/copy.ts` — Wave 5 / 6 新面全部经 `copy.*`，无硬编码用户可见文案
- [x] 高频聊天导航无 motion 或 ≤150ms 色/透明度 — 侧栏行 `pressScale={1}` 不变；新增只有列表 promote 150ms opacity 与投递字形 140ms 淡入
- [x] 偶发浮层 / 对话框 / 面板：原点可打断；保留 reduced-motion 静态提示 — 模板 / emoji 走 MorphPopover（原点感知），关键词文件夹走 CenterMorphModal（保持居中）；
      `OptionRow` 在 reduced-motion 下不做 press 缩放，`index.css` 的 reduced-motion 兜底覆盖动画 / 过渡 / View Transition
- [x] 桌面点击区域 ≥40px，命中不重叠 — BEUI `Button` 的 `sm` 由 32px 提到 40px（只在字号和内边距上保持紧凑），
      `PromptInput` 的发送 / 附件钮 32px → 40px，模板行去掉 `<li>` 上与行内按钮重叠的 hover 底色；
      收尾补了 `tests/e2e/hit-areas.spec.ts` 做运行时扫描——class 名 grep 证不了 40px：最终高度是 Tailwind merge 后谁胜出，
      外层 wrapper 可以把小图标垫成合格目标，`::before` 撑出来的命中区 `getBoundingClientRect` 又根本不报，
      所以改成从控件中心向外探点直到不再命中它本身，覆盖会话列表 / 会话内 / 打开的对话框三个面；
      这一扫就逮出真缺陷：composer 输入框按行数算高但盒模型含纵向 padding，单行算出 24px 而 scrollHeight 是 30px，
      每条消息的第一行其实一直在自己框里溢出滚动，把自身 padding 加回去后单行回到 40px（顺带过了点击区），composer 整体高 16px
- [x] `make check` 无被压制的架构 / 质量失败 — `format:check` / `lint --max-warnings=0` / `typecheck` / 799 unit / `docs:check` / 60 e2e 全绿；
      过程中修掉两个真问题：composer 两处 effect 内同步 setState（成员缓存改为按 chatId 派生，`@` 查询重置改成渲染期，与同文件 draft 镜像同一写法）
      和 caret 恢复的 `useLayoutEffect` 里 setState（收敛成 `queueCaret`，DOM 与 `selection` 状态一处写）；
      另修掉 `demo-telegram-repository` 上传取消测试的时序 flake（20ms 步进在并行满载下会在取消到达前跑完整个上传）
- [x] reduced-motion 替代已自动化 — 新增 `tests/e2e/reduced-motion.spec.ts`：在 `emulateMedia({ reducedMotion: "reduce" })` 下走 emoji 选取、
      媒体查看器开关、回复引用跳转，专门盯「只在过渡过程中才可见 / 可点的元素」在 `reduce` 下过渡不播时是否还成立
- [ ] 慢放（10%）人工观感走查 — 只剩审美判断这半：动画是否过冲、时长是否拖沓，需要人在跑起来的应用里眼看，无法自动化
