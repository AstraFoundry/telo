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
- [x] 乐观发送：稳定临时 ID、`sending/sent/read`；失败时移除乐观气泡并把 body 回填 composer（不吞错）
- [ ] 发送失败后的一键重试（现状：body 已回填 composer，需要用户重新按发送）
- [x] 本地 / 云端草稿；切聊天不丢输入
- [x] 输入状态：顶栏 + 会话列表行（已接事件，动效用已有 `MessageTyping`）
- [x] 未读消息桌面通知：mute / 焦点 / 点进对应会话（`shell.notify` 已接收件通知与点击选中会话）
- [x] 日期分隔、点击回复条跳到源消息
- [ ] 未读分界线（`MessageMarker` 目前只标日期，不标首条未读消息）
- [x] 同步脊柱的 application / IPC / Vitest / Playwright 覆盖

## Wave 2 — 能当主客户端的最低线

`MessageDto.body: string` 必须扩成实体模型（`contracts/src/ipc.ts`）。没有媒体就没有可给 Agent 看的上下文。

- [ ] 消息实体与富文本（bold / mention / url），安全渲染
- [ ] 收发明细：照片 / 视频 / 文件 / 相册；下载进度、取消、重试、打开 / 另存
- [ ] 链接预览
- [ ] Telegram 原生文件夹 + Archive + 文件夹未读（关键词文件夹放 Wave 6）
- [ ] 服务端全局搜索 + 会话内搜索（现有搜索只滤已加载对话的 `title/preview`）
- [ ] 会话顶栏：头像、在线 / 输入中、搜索、置顶（现在只有标题 + Agent 开关）

## Wave 3 — 消息级 AI 写回 composer

Telo 该赢的面。账本「Telo workspace differentiation」目前全空。Agent 现在只有只读 `inspectWorkspace`；消息菜单只有 Reply / Edit / Copy / Forward / Delete。

- [ ] 消息菜单动作：翻译 / 润色 / 起草回复（语气可选）；**结果插入 composer，不停在右侧面板**
- [ ] 摘要未读；citation 可滚到原消息
- [ ] 显式上下文范围：选中消息 / 未读 / 当前文件夹；预览即将发给模型的内容
- [ ] 发送前：范围、脱敏字段、本地审计（BYOK 更该把边界做清楚）
- [ ] 决策 / 待办 / 未答问题抽取（可与摘要共用引用跳转）

## Wave 4 — 桌面交互密度

桌面主路径应对齐 Telegram Desktop：悬停动作、键盘、文件夹条。Telo 主路径几乎只有右键 / 长按 520ms；产品快捷键基本只有 `Cmd+B`。布局是死的 `280px | 1fr | 380px`。

- [ ] 消息悬停动作条：Reply / 反应位 / AI（翻译、起草）
- [ ] 快捷键：`Cmd+K` 搜聊天、会话内搜索、回复、编辑上一条、Esc 取消回复 / 编辑；列表上下移动 + Enter 打开
- [ ] Composer：拖放 / 粘贴附件、emoji、静音发送（现在是单行 `PromptInput` + 回复 / 编辑预览条）
- [ ] 转发：目标搜索、多条、保留 / 隐藏发送者（现在是单条 + 对话框选聊天）
- [ ] 删除：Delete for me / everyone（现在一句「不可撤销」）
- [ ] 列宽可调；窄窗压成会话列表 ↔ 会话
- [ ] 多选消息；批量转发 / 删除
- [ ] 置顶区在会话列表可见分组（不要只靠菜单状态）
- [ ] 资料页、共享媒体、置顶消息导航、返回栈

侧栏选中保持 `pressScale={1}`：高频导航不加弹簧。

## Wave 5 — 接到已有动效

BEUI 里已有能力，产品没接到聊天主路径。Onboarding（横滑 + TextReveal + OTP 翻滚）不必再加。Agent 面板现有 offcanvas 弹簧够用，不要从 Sparkle 做 FLIP morph。

- [ ] 仅对**新到达 / 刚发送**开 `Message animateIn`；历史分页保持无动画（现有 prepend 补偿保留）
- [ ] 顶栏 + 列表行 `MessageTyping` 三个点；reduced-motion 用「Typing」文字
- [ ] 对话列表重排：置顶 / 新消息上顶 ≤150ms opacity，或不动；禁止整表 layout 弹簧
- [ ] 投递状态字形交叉淡入（pending → sent/read/failed），120–160ms，行本身不动
- [ ] 主题切换：避免启动闪系统主题；可选 Telegram 式圆形揭示，不要全页 blur
- [ ] 有媒体之后再做灯箱（缩略图 → 全屏，可打断）；没内容不做空动画
- [ ] 有语音 / 贴纸后再做波形与循环播放
- [ ] reduced-motion：高频路径能关则关；补 typing / 新消息的静态替代（无位移淡入）

## Wave 6 — 工作区定位增强

符合 Telo 工作区，而不是再做一个通用聊天客户端。

- [ ] 关键词文件夹 / 关键词追踪（搜词 → 自动归集未来匹配）
- [ ] 快捷回复 / 模板（与 Agent「起草」共用 composer）
- [ ] 语音转写（依赖 Wave 2 语音消息）
- [ ] 多账号：Telegram 级 3 个即可，不追求无限账号
- [ ] 表情 / 贴纸 / GIF 选择器、格式化、mention
- [ ] 语音 / 视频笔记收发

## Wave 7 — 默认不做

需要明确产品决策后再开。不要混进前面的波次。

- [ ] 一对一 / 群组通话、屏幕共享
- [ ] Stories、Secret Chats、论坛 Topics、频道评论
- [ ] 机器人、Mini Apps、Stars
- [ ] 隐藏账号、隐藏会话
- [ ] 钱包 / Web3 / 托管

## 质量门（每波都要过）

- [ ] UI 只走 `shared/ui`；缺组件向上游 BEUI 补，不在产品 slice 再造一套
- [ ] 文案进 `shared/config/copy.ts`
- [ ] 高频聊天导航无 motion 或 ≤150ms 色/透明度
- [ ] 偶发浮层 / 对话框 / 面板：原点可打断；保留 reduced-motion 静态提示
- [ ] 桌面点击区域 ≥40px，命中不重叠
- [ ] `make check` 无被压制的架构 / 质量失败
- [ ] 慢放检查新增动画及其 reduced-motion 替代
