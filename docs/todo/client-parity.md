# 第三方客户端细粒度功能差距

对照开源第三方客户端的实现,逐项核对 Telo 的细粒度聊天功能缺口。结论来源:

- **参考实现**:Telegram Desktop(`tdesktop`)、Unigram、Telegram Web K(`tweb`)、桌面 fork(64Gram / Kotatogram / Forkgram / AyuGram)、Android fork(Nekogram / Forkgram / Nicegram,见 [alignment](alignment.md))。以上均为开源代码,可直接核对实现。
- **Telo 现状**:[`contracts/src/ipc.ts`](../../contracts/src/ipc.ts)(IPC 面)、`backend/src/infrastructure/telegram/tdlib-telegram-repository.ts`(TDLib 调用)、frontend 渲染层,均以本仓源码为证据。
- **可行性闸门**:TDLib 1.8.67 内核(`@prebuilt-tdlib`)的方法清单。缺失项分「内核可做」与「内核缺方法」两类。

状态:**缺失** = IPC 与仓库层均无;**部分** = 后端映射但 UI/发送侧缺失;**内核限** = TDLib 1.8.67 缺少对应方法。

## 消息内容类型

| 能力                                 | 参考客户端行为                                   | Telo 现状                                                                             | 状态   |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------- | ------ |
| 投票 / 测验                          | tdesktop、Unigram、tweb 均可发送、投票、查看结果 | `messagePoll` 未映射(气泡 body 为空),无 `inputMessagePoll` 发送;TDLib 1.8.67 类型齐全 | 缺失   |
| 服务消息                             | 全部客户端渲染「X 加入群组」「修改标题」等       | mapper 对 service 类型返回 `body: ""`,渲染为空气泡                                    | 缺失   |
| 定位 / 实时定位 / 名片               | 全部客户端可收发                                 | 未映射,不可收发                                                                       | 缺失   |
| 骰子 / 掷字                          | 全部客户端渲染骰子动画                           | 未映射                                                                                | 缺失   |
| 定时消息                             | tdesktop、Unigram、tweb 可定时发送并管理         | `messageSendOptions.scheduling_state` 在 1.8.67 可用;Telo 无                          | 缺失   |
| 发送时引用局部文字                   | tdesktop 选中文字后回复,携带 quote               | 发送时仅传 `message_id`;接收侧 `mapReply` 已读 `reply.quote`(显示 OK)                 | 部分   |
| GIF 面板                             | tdesktop、tweb、Unigram 有 GIF 标签页与搜索      | 仅 `getSavedAnimations`;1.8.67 无 `searchGifs`,搜索需 animation search bot            | 内核限 |
| 自定义 emoji 反应                    | fork / 新客户端可收发自定义 emoji 反应           | `reactionTypeCustomEmoji` 在映射时被跳过,不显示                                       | 部分   |
| Bot 命令菜单 / via_bot / inline 查询 | 全部客户端有 inline bot 流程                     | 键盘按钮 callback/url/copy 可用,inline 查询无(1.8.67 无 `sendInlineQueryResult`)      | 内核限 |
| Fact check / 清单消息                | Unigram 已实现(新协议)                           | 1.8.67 无对应类型                                                                     | 内核限 |

## 消息操作

| 能力                  | 参考客户端行为                                 | Telo 现状                                                                                  | 状态 |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ---- |
| 置顶消息操作          | 全部客户端可 pin / unpin                       | 仅 `listPinnedMessages` + 顶栏展示;1.8.67 有 `pinChatMessage` / `unpinAllChatMessages`     | 缺失 |
| 复制消息链接          | tdesktop、Unigram、tweb 右键 Copy message link | 1.8.67 有 `getMessageLink`;Telo 无入口                                                     | 缺失 |
| 跳到开头 / 按日期跳转 | tdesktop、fork 有 Jump to first / calendar     | 1.8.67 有 `getChatMessageCalendar`;Telo 无                                                 | 缺失 |
| 已读名单 / 转发数     | tdesktop Info 面板、频道计数                   | `messageInteractionInfo.view_count` / `forward_count` 未映射;1.8.67 有 `getMessageViewers` | 缺失 |
| 按聊天设 TTL 自毁     | 全部客户端有 per-chat timer                    | 1.8.67 有 `setChatMessageAutoDeleteTime`;Telo 无                                           | 缺失 |
| 举报消息 / 聊天       | tdesktop、Unigram 有 report 流程               | 1.8.67 有 `reportChat` / `reportChatPhoto`;Telo 无                                         | 缺失 |
| 转发时不引用原消息    | tweb / fork「send without quote」              | 转发仅整条转发                                                                             | 缺失 |
| 按日期范围多选        | tdesktop Select messages by date               | 无                                                                                         | 缺失 |

## 会话级操作

| 能力                             | 参考客户端行为                      | Telo 现状                                                                                                             | 状态 |
| -------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---- |
| 退出 / 删除会话与历史            | 全部客户端核心项                    | 侧栏菜单仅 read/pin/mute/archive + 本地移除;1.8.67 有 `deleteChatHistory` / `leaveChat` / `deleteChat`                | 缺失 |
| 屏蔽用户                         | 全部客户端有 block                  | 1.8.67 有 `setMessageSenderBlockList` / `getBlockedMessageSenders`;Telo 无                                            | 缺失 |
| 编辑会话资料(标题 / 头像 / 简介) | tdesktop、Unigram 群组编辑          | 1.8.67 有 `setChatTitle` / `setChatPhoto` / `setChatDescription`;Telo 无                                              | 缺失 |
| 成员管理(列表 / 禁言 / 提权)     | tdesktop、Unigram 管理面板          | chat-profile 无成员列表;1.8.67 有 `getChatAdministrators` / `setChatMemberStatus` / `addChatMember` / `banChatMember` | 缺失 |
| 邀请链接                         | tdesktop、Unigram 管理 invite links | 1.8.67 有 `createChatInviteLink` 等;Telo 无                                                                           | 缺失 |
| 会话统计                         | tdesktop 频道 / 群统计              | 1.8.67 有 `getChatStatistics` / `getChatMessageCount`;Telo 无                                                         | 缺失 |
| 搜索并加入公开会话               | 全部客户端 join by username/link    | 1.8.67 有 `searchPublicChat` + `joinChat`;Telo 无加入流程                                                             | 缺失 |
| 按会话设壁纸 / 主题              | tdesktop、fork per-chat background  | 1.8.67 有 `setChatBackground` / `setChatTheme`;Telo 仅全局壁纸                                                        | 缺失 |
| 全部标记已读                     | tdesktop、fork 有 mark all read     | 1.8.67 有 `readAllChatMentions`;Telo 仅单会话已读                                                                     | 缺失 |
| 未读提及徽标                     | 全部客户端 @ 徽标                   | `unread_mention_count` 未映射进 `ChatDto`                                                                             | 缺失 |

## 文件夹与搜索

| 能力                    | 参考客户端行为                                                 | Telo 现状                                                                                                                                     | 状态 |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 服务端文件夹增删改排序  | tdesktop、Unigram、tweb 可编辑 folders                         | 服务端 folder 只读映射;1.8.67 有 `createChatFolder` / `editChatFolder` / `deleteChatFolder` / `reorderChatFolders` / `getChatFolderChatCount` | 缺失 |
| 手动把会话加入文件夹    | tdesktop、tweb include/exclude 编辑                            | 适配器按第一个匹配 filter 归位,无手动归组                                                                                                     | 缺失 |
| 共享媒体标签页          | tdesktop、Unigram Audio/Voice/Rounds/GIF/Links/Mentions 全标签 | 仅 Photo&Video、Documents、Pinned;1.8.67 有 `searchMessagesFilterAudio` 等全部 filter                                                         | 部分 |
| 按发送者 / 日期过滤搜索 | tdesktop in-chat 高级过滤                                      | 仅关键词                                                                                                                                      | 缺失 |

## 设置与通用

| 能力                               | 参考客户端行为                 | Telo 现状                                                                                                                                                                    | 状态   |
| ---------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 二步验证管理                       | tdesktop、Unigram 完整密码流程 | 1.8.67 有 `setPassword` / `setRecoveryEmailAddress`;Telo 仅登录时输入密码                                                                                                    | 缺失   |
| 设备 / 会话管理                    | 全部客户端 sessions 列表与终止 | 1.8.67 有 `getActiveSessions` / `terminateSession`;Telo 无                                                                                                                   | 缺失   |
| 代理支持                           | 全部客户端 SOCKS5 / MTProto    | 1.8.67 有 `getProxies` / `addProxy`;Telo 无                                                                                                                                  | 缺失   |
| QR 登录                            | tdesktop、Unigram、tweb 均有   | 1.8.67 有 `requestQrCodeAuthentication`;Telo 仅手机号 + 验证码                                                                                                               | 缺失   |
| 界面语言                           | tdesktop 30+ 语言,i18n         | copy 单语言常量,无 i18n                                                                                                                                                      | 缺失   |
| 数据导出                           | tdesktop 本地导出工具          | 无;TDLib 无导出 API,属内核限                                                                                                                                                 | 内核限 |
| 自动更新                           | tdesktop、Unigram 有 updater   | 仅 electron-builder 打包,无 updater                                                                                                                                          | 缺失   |
| 托盘 / Dock 徽标                   | tdesktop 托盘 + 未读数         | 无托盘、无 dock badge                                                                                                                                                        | 缺失   |
| 拼写检查                           | tdesktop spellchecker          | 无                                                                                                                                                                           | 缺失   |
| 快捷键自定义                       | tdesktop、fork 快捷键编辑器    | 固定热键                                                                                                                                                                     | 缺失   |
| 趋势贴纸 / 安装搜索到的贴纸包      | 全部客户端 trending 页         | 已有 `setStickerSetInstalled`(收到的贴纸可装/卸);无 trending 页(1.8.67 有 `getTrendingStickerSets`)、无贴纸搜索安装入口                                                      | 部分   |
| 下载管理器                         | tdesktop、Unigram 全局下载队列 | 仅单消息级进度 / 取消                                                                                                                                                        | 部分   |
| 媒体查看器缩放 / 旋转 / 倍速 / PiP | tdesktop、tweb 均有            | `shared/ui/media-viewer.tsx` 仅左右切换 / 保存 / 打开;视频走原生 `controls`,无 zoom、rotate、倍速、PiP                                                                       | 缺失   |
| 网络统计 / 存储优化                | tdesktop、Unigram 设置页       | 有本地媒体缓存用量 / 上限 / 清空(`pages/settings/ui/sections/storage-section.tsx`);无 TDLib 侧用量与 `optimizeStorage`(1.8.67 有 `getNetworkStatistics` / `optimizeStorage`) | 部分   |

## 建议优先级

按「日常客户端阻断程度」排序,与 [gaps](gaps.md) 的 Wave 编号衔接:

- **P0(阻断日常使用)**:服务消息映射(空气泡不可接受)、退出 / 删除会话、pin/unpin、置顶与屏蔽之外的会话编辑(标题 / 头像)、未读提及徽标、复制消息链接。
- **P1(高频)**:定时发送、投票、共享媒体全标签、服务端文件夹编辑、按会话 TTL、成员管理、2FA 与会话管理、QR 登录。
- **P2(补齐体验)**:邀请链接、会话统计、举报、TTL 之外的引用转发变体、趋势贴纸、下载管理器、媒体查看器手势、代理、托盘徽标、自动更新。
- **内核限(不在 1.8.67 内解决)**:GIF 搜索、inline bot 查询、数据导出、fact check / 清单;升级内核前不投入。

fork 专属差异化(如自定义贴纸尺寸、隐藏 All chats、显示秒数)不作为对齐目标;个别低成本项(隐藏 All chats、跳到开头)可随 P0 顺带。

## 核对方法

TDLib 方法可用性来自 `@prebuilt-tdlib` 1.8.67 类型清单与 `td_api.tl` 全量方法枚举;参考客户端行为以各仓源码(字符串目录、controller / repository 实现)为准;Telo 现状逐条引用 `contracts/src/ipc.ts`、`tdlib-telegram-repository.ts`、`tdlib-mappers.ts` 与 frontend 渲染文件。更新本表时沿用同一核验方式,不凭记忆补条目。
