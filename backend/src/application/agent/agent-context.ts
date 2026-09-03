import {
  ARCHIVE_FOLDER_ID,
  type AgentContextMessageDto,
  type AgentContextPreviewDto,
  type AgentContextScopeInput,
  type ChatDto,
  type ChatPageCursorDto,
  type MessageDto,
} from "../../../../contracts/src/ipc";
import { teloMessageLink } from "../../../../contracts/src/ipc";
import {
  AGENT_INPUT_CLOSE,
  AGENT_INPUT_OPEN,
  AGENT_REFERENCE_INSTRUCTION,
  agentPayloadLine,
} from "../../domain/agent/agent-actions";
import type {
  AgentScopedContext,
  AgentScopedMessage,
} from "../../domain/agent/agent-context";
import { redactAgentContext } from "../../domain/agent/agent-redaction";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

const PAGE_LIMIT = 100;

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * A media-only message has no text to send; the payload carries the media
 * kind as a bracketed descriptor so the preview and the model see the same
 * placeholder instead of a blank line.
 */
function payloadBody(message: MessageDto): string {
  if (message.body) return message.body;
  return message.media ? `[${message.media.kind}]` : "";
}

function toScopedMessage(
  message: MessageDto,
  chat: ChatDto,
): AgentScopedMessage {
  return {
    messageId: message.id,
    chatId: chat.id,
    chatTitle: chat.title,
    senderName: message.senderName,
    body: payloadBody(message),
    sentAt: message.sentAt,
  };
}

/**
 * Assembles the explicit context scope of an agent run. The same pipeline
 * backs the payload preview (`preview`) and the run itself (`assemble`), and
 * both read fresh workspace data in the main process, so what the preview
 * shows is exactly what a run at that moment would send — already redacted.
 *
 * "Unread" is defined by the server unread counter: the chat's most recent
 * `unreadCount` incoming messages. That matches Telegram's own accounting
 * and never depends on how much history the renderer happens to have loaded.
 */
export class AgentContextService {
  constructor(private readonly telegram: TelegramRepository) {}

  async preview(
    input: AgentContextScopeInput,
  ): Promise<AgentContextPreviewDto> {
    const context = await this.assemble(input);
    return {
      scope: context.scope,
      messages: context.messages.map(toDto),
      redactionCounts: context.redactionCounts,
    };
  }

  async assemble(input: AgentContextScopeInput): Promise<AgentScopedContext> {
    const messages = await this.collect(input);
    const { messages: redacted, counts } = redactAgentContext(messages);
    return { scope: input.scope, messages: redacted, redactionCounts: counts };
  }

  private collect(
    input: AgentContextScopeInput,
  ): Promise<ReadonlyArray<AgentScopedMessage>> {
    if (input.scope === "unread") {
      if (!input.chatId) {
        throw new Error('Agent scope "unread" requires a chatId.');
      }
      return this.collectUnread(input.chatId);
    }
    if (input.scope === "selected") {
      if (!input.chatId) {
        throw new Error('Agent scope "selected" requires a chatId.');
      }
      if (!input.messageIds || input.messageIds.length === 0) {
        throw new Error('Agent scope "selected" requires message ids.');
      }
      return this.collectSelected(input.chatId, input.messageIds);
    }
    return this.collectFolder(input.folderId ?? null);
  }

  private async collectUnread(
    chatId: string,
  ): Promise<ReadonlyArray<AgentScopedMessage>> {
    const chat = await this.findChat(chatId);
    return (await this.unreadMessages(chat)).map((message) =>
      toScopedMessage(message, chat),
    );
  }

  private async collectSelected(
    chatId: string,
    messageIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<AgentScopedMessage>> {
    const chat = await this.findChat(chatId);
    const wanted = new Set(messageIds);
    const found: MessageDto[] = [];
    let cursor: string | null = null;
    // Page-until-found, newest first — the same loader pattern the reply
    // jump and unread divider use renderer-side.
    do {
      const page = await this.telegram.listMessagePage(chatId, {
        limit: PAGE_LIMIT,
        beforeMessageId: cursor,
      });
      found.unshift(...page.items);
      cursor = page.nextCursor;
    } while (cursor && !containsAllIds(found, wanted));
    const selected = found.filter((message) => wanted.has(message.id));
    const missing = messageIds.filter(
      (id) => !selected.some((message) => message.id === id),
    );
    if (missing.length > 0) {
      throw new Error(
        `Unknown message id in chat ${chatId}: ${missing.join(", ")}`,
      );
    }
    return selected.map((message) => toScopedMessage(message, chat));
  }

  private async collectFolder(
    folderId: number | null,
  ): Promise<ReadonlyArray<AgentScopedMessage>> {
    // Mirrors the renderer's folder tabs: the implicit "All" view is every
    // chat that is not archived, a folder view is the chats whose folderId
    // matches the tab.
    const chats = (await this.listAllChats()).filter((chat) =>
      folderId === null
        ? chat.folderId !== ARCHIVE_FOLDER_ID
        : chat.folderId === folderId,
    );
    const scoped: AgentScopedMessage[] = [];
    for (const chat of chats) {
      for (const message of await this.unreadMessages(chat)) {
        scoped.push(toScopedMessage(message, chat));
      }
    }
    return scoped;
  }

  /**
   * The chat's most recent `unreadCount` incoming messages, chronological.
   * Pages backward until the counter is satisfied or history is exhausted.
   */
  private async unreadMessages(
    chat: ChatDto,
  ): Promise<ReadonlyArray<MessageDto>> {
    if (chat.unreadCount === 0) return [];
    const incoming: MessageDto[] = [];
    let cursor: string | null = null;
    do {
      const page = await this.telegram.listMessagePage(chat.id, {
        limit: PAGE_LIMIT,
        beforeMessageId: cursor,
      });
      incoming.unshift(...page.items.filter((message) => !message.outgoing));
      cursor = page.nextCursor;
    } while (cursor && incoming.length < chat.unreadCount);
    return incoming.slice(-chat.unreadCount);
  }

  /**
   * Page-until-found: the open chat is almost always on the first page,
   * which the repository serves from its dialog cache, so a single-chat
   * scope normally costs no `GetDialogs` round trip at all.
   */
  private async findChat(chatId: string): Promise<ChatDto> {
    let cursor: ChatPageCursorDto | null = null;
    do {
      const page = await this.telegram.listChatPage({
        limit: PAGE_LIMIT,
        cursor,
      });
      const chat = page.items.find((item) => item.id === chatId);
      if (chat) return chat;
      cursor = page.nextCursor;
    } while (cursor);
    throw new Error(`Unknown chat: ${chatId}`);
  }

  private async listAllChats(): Promise<ReadonlyArray<ChatDto>> {
    const chats: ChatDto[] = [];
    let cursor: ChatPageCursorDto | null = null;
    do {
      const page = await this.telegram.listChatPage({
        limit: PAGE_LIMIT,
        cursor,
      });
      chats.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return chats;
  }
}

function containsAllIds(
  messages: ReadonlyArray<MessageDto>,
  wanted: ReadonlySet<string>,
): boolean {
  return [...wanted].every((id) =>
    messages.some((message) => message.id === id),
  );
}

function toDto(message: AgentScopedMessage): AgentContextMessageDto {
  return { ...message };
}

/**
 * Builds the exact prompt handed to the gateway for a scoped panel run: the
 * redacted payload first (the same `[[telo-input]]` block and
 * `ref: <link> | <sender>: <body>` lines as the chat actions, so the demo
 * gateway and citation links work unchanged), then the reference
 * convention, then the user's question. A scope with no matching messages
 * sends the bare question — there is no payload to show or send.
 */
export function buildScopedPrompt(
  prompt: string,
  context: AgentScopedContext,
): string {
  if (context.messages.length === 0) return prompt;
  const chatTitles = new Set(
    context.messages.map((message) => message.chatTitle),
  );
  const lines: string[] = [];
  let currentChat: string | null = null;
  for (const message of context.messages) {
    if (chatTitles.size > 1 && message.chatTitle !== currentChat) {
      currentChat = message.chatTitle;
      lines.push(`chat: ${singleLine(message.chatTitle)}`);
    }
    lines.push(
      agentPayloadLine(
        teloMessageLink(message.chatId, message.messageId),
        singleLine(message.senderName),
        singleLine(message.body),
      ),
    );
  }
  return [
    AGENT_INPUT_OPEN,
    ...lines,
    AGENT_INPUT_CLOSE,
    AGENT_REFERENCE_INSTRUCTION,
    "",
    prompt,
  ].join("\n");
}
