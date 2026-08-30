import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChatDto,
  ChatPageCursorDto,
  ChatPageDto,
  ChatPageInput,
} from "../../../../contracts/src/ipc";
import type {
  TelegramDialogSnapshot,
  TelegramDialogSnapshotRepository,
} from "../../domain/telegram/telegram-ports";

const SNAPSHOT_VERSION = 1 as const;

export class FileTelegramDialogSnapshotRepository
  implements TelegramDialogSnapshotRepository
{
  constructor(private readonly filePath: string) {}

  async get(): Promise<TelegramDialogSnapshot | null> {
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8")) as {
        readonly version?: unknown;
        readonly chats?: unknown;
        readonly folders?: unknown;
        readonly nextCursor?: unknown;
      };
      if (stored.version !== SNAPSHOT_VERSION) return null;
      if (!Array.isArray(stored.chats) || !Array.isArray(stored.folders)) {
        return null;
      }
      return {
        version: SNAPSHOT_VERSION,
        chats: stored.chats as TelegramDialogSnapshot["chats"],
        folders: stored.folders as TelegramDialogSnapshot["folders"],
        nextCursor: (stored.nextCursor ?? null) as ChatPageCursorDto | null,
      };
    } catch (error) {
      if (isMissingFile(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async save(snapshot: TelegramDialogSnapshot): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        chats: snapshot.chats.map(persistableChat),
        folders: snapshot.folders,
        nextCursor: snapshot.nextCursor,
      }),
      { mode: 0o600 },
    );
  }

  async clear(): Promise<void> {
    try {
      await rm(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }
}

export class MemoryTelegramDialogSnapshotRepository
  implements TelegramDialogSnapshotRepository
{
  private value: TelegramDialogSnapshot | null = null;

  async get(): Promise<TelegramDialogSnapshot | null> {
    return this.value;
  }

  async save(snapshot: TelegramDialogSnapshot): Promise<void> {
    this.value = {
      version: SNAPSHOT_VERSION,
      chats: snapshot.chats.map(persistableChat),
      folders: snapshot.folders,
      nextCursor: snapshot.nextCursor,
    };
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

export function dialogSnapshotPage(
  snapshot: TelegramDialogSnapshot,
  input: ChatPageInput,
): ChatPageDto {
  const limit = input.limit ?? 50;
  if (!input.cursor) {
    return {
      items: snapshot.chats.slice(0, limit),
      nextCursor:
        snapshot.chats.length > limit
          ? cursorOf(snapshot.chats[limit - 1]!)
          : snapshot.nextCursor,
    };
  }
  const index = snapshot.chats.findIndex(
    (chat) => chat.id === input.cursor?.chatId,
  );
  const start = index >= 0 ? index + 1 : snapshot.chats.length;
  const items = snapshot.chats.slice(start, start + limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      start + items.length < snapshot.chats.length && last
        ? cursorOf(last)
        : null,
  };
}

function persistableChat(chat: ChatDto): ChatDto {
  return { ...chat, avatarDataUrl: null, typing: false };
}

function cursorOf(chat: ChatDto): ChatPageCursorDto {
  return {
    chatId: chat.id,
    topMessageId: chat.lastReadMessageId ?? chat.id,
    updatedAt: chat.updatedAt,
  };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
