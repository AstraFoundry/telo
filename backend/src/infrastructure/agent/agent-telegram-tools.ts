import { tool } from "ai";
import { z } from "zod";

import type { MessageDto } from "../../../../contracts/src/ipc";
import { redactAgentText } from "../../domain/agent/agent-redaction";
import type { TelegramRepository } from "../../domain/telegram/telegram-ports";

/**
 * Tool output is forwarded to the model provider, so sender names and
 * message bodies pass through the same redaction as the scoped-payload
 * pipeline before they leave the main process.
 */
function mapMessage(message: MessageDto) {
  return {
    messageId: message.id,
    senderName: redactAgentText(message.senderName).text,
    body: redactAgentText(message.body).text,
    sentAt: message.sentAt,
    outgoing: message.outgoing,
  };
}

/**
 * Read-only Telegram tools for the agent: list chats, read history, and
 * search. Sending stays out of reach here — delivery is owned by the
 * automation runner's draft/auto-send pipeline.
 */
export function createAgentTelegramTools(telegram: TelegramRepository) {
  return {
    listChats: tool({
      description:
        "List the account's Telegram chats, most recently active first. Returns id, title, kind, unreadCount, muted, and folderId (null when the chat is not in a folder).",
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum chats to return; defaults to 50."),
      }),
      execute: async ({ limit }) => {
        const page = await telegram.listChatPage({ limit: limit ?? 50 });
        return page.items.map((chat) => ({
          id: chat.id,
          title: chat.title,
          kind: chat.kind,
          unreadCount: chat.unreadCount,
          muted: chat.muted,
          folderId: chat.folderId ?? null,
        }));
      },
    }),

    readChatHistory: tool({
      description:
        "Read the most recent messages of one chat. Emails, phone numbers, and API tokens in sender names and bodies are masked.",
      inputSchema: z.object({
        chatId: z.string().describe("Chat id from listChats."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum messages to return; defaults to 30."),
      }),
      execute: async ({ chatId, limit }) => {
        const page = await telegram.listMessagePage(chatId, {
          limit: limit ?? 30,
        });
        return page.items.map(mapMessage);
      },
    }),

    searchChatMessages: tool({
      description:
        "Search one chat's full history server-side. Returns matching message ids (newest first) and the total match count; use readChatHistory to read around a match.",
      inputSchema: z.object({
        chatId: z.string().describe("Chat id from listChats."),
        query: z.string().describe("Server-side search term."),
      }),
      execute: async ({ chatId, query }) => {
        const page = await telegram.searchMessages(chatId, query, {
          limit: 20,
        });
        return {
          messageIds: page.messageIds,
          totalCount: page.totalCount,
        };
      },
    }),

    searchGlobal: tool({
      description:
        "Search across all chats server-side by chat title or message body. Sender names and bodies are masked like readChatHistory.",
      inputSchema: z.object({
        query: z.string().describe("Server-side search term."),
      }),
      execute: async ({ query }) => {
        const result = await telegram.searchGlobal(query);
        return {
          chats: result.chats.map((chat) => ({
            id: chat.id,
            title: chat.title,
            kind: chat.kind,
            unreadCount: chat.unreadCount,
            muted: chat.muted,
            folderId: chat.folderId ?? null,
          })),
          messages: result.messages.map(mapMessage),
        };
      },
    }),
  };
}
