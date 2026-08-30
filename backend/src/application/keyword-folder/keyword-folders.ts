import type {
  ChatDto,
  ChatFolderDto,
  KeywordFolderInput,
  MessageDto,
  UpdateKeywordFolderInput,
} from "../../../../contracts/src/ipc";
import {
  KEYWORD_FOLDERS_MAX,
  KeywordFolder,
  messageBodyMatchesKeyword,
  nextKeywordFolderId,
} from "../../domain/keyword-folder/keyword-folder";
import type {
  KeywordFolderChatSource,
  KeywordFolderRepository,
} from "../../domain/keyword-folder/keyword-folder-ports";

const CHAT_SCAN_LIMIT = 100;

export class KeywordFolderService {
  private membership = new Map<string, number[]>();
  private chatUnread = new Map<string, number>();
  private cached: ReadonlyArray<KeywordFolder> = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly folders: KeywordFolderRepository,
    private readonly telegram: KeywordFolderChatSource,
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async list(): Promise<ReadonlyArray<KeywordFolder>> {
    this.cached = await this.folders.list();
    return this.cached;
  }

  async create(input: KeywordFolderInput): Promise<ChatFolderDto> {
    const existing = await this.folders.list();
    if (existing.length >= KEYWORD_FOLDERS_MAX) {
      throw new Error(
        `At most ${KEYWORD_FOLDERS_MAX} keyword folders can be saved`,
      );
    }
    const folder = KeywordFolder.create({
      id: nextKeywordFolderId(existing),
      title: input.title,
      query: input.query,
    });
    await this.folders.save(folder);
    this.cached = [...existing, folder];
    await this.rebuild();
    this.notify();
    return this.toDto(folder);
  }

  async update(input: UpdateKeywordFolderInput): Promise<ChatFolderDto> {
    const existing = await this.folders.list();
    const current = existing.find((folder) => folder.id === input.id);
    if (!current) throw new Error("Unknown keyword folder");
    const folder = current.update({ title: input.title, query: input.query });
    await this.folders.save(folder);
    this.cached = existing.map((entry) =>
      entry.id === folder.id ? folder : entry,
    );
    await this.rebuild();
    this.notify();
    return this.toDto(folder);
  }

  async remove(id: number): Promise<void> {
    const existing = await this.folders.list();
    if (!existing.some((folder) => folder.id === id)) {
      throw new Error("Unknown keyword folder");
    }
    await this.folders.remove(id);
    this.cached = existing.filter((folder) => folder.id !== id);
    await this.rebuild();
    this.notify();
  }

  /**
   * Merges native Telegram folders with projected keyword folders. Keyword
   * unread is the sum of matching chats' unread counts.
   */
  async mergeNative(
    native: ReadonlyArray<ChatFolderDto>,
  ): Promise<ReadonlyArray<ChatFolderDto>> {
    await this.rebuild();
    return [...native, ...this.cached.map((folder) => this.toDto(folder))];
  }

  annotate(chat: ChatDto): ChatDto {
    const keywordFolderIds = this.membership.get(chat.id) ?? [];
    this.chatUnread.set(chat.id, chat.unreadCount);
    return keywordFolderIds.length > 0 ? { ...chat, keywordFolderIds } : chat;
  }

  /**
   * Incremental match: a newly arrived (or edited) body can pull a chat into
   * a keyword folder without waiting for a full search rebuild.
   */
  noteMessage(message: MessageDto): void {
    for (const folder of this.cached) {
      if (!messageBodyMatchesKeyword(message.body, folder.query)) continue;
      const ids = this.membership.get(message.chatId) ?? [];
      if (!ids.includes(folder.id)) {
        this.membership.set(message.chatId, [...ids, folder.id]);
      }
    }
  }

  private async rebuild(): Promise<void> {
    this.cached = await this.folders.list();
    const chats = (await this.telegram.listChatPage({ limit: CHAT_SCAN_LIMIT }))
      .items;
    this.chatUnread = new Map(chats.map((chat) => [chat.id, chat.unreadCount]));
    const membership = new Map<string, number[]>();
    for (const folder of this.cached) {
      const result = await this.telegram.searchGlobal(folder.query);
      for (const message of result.messages) {
        if (!messageBodyMatchesKeyword(message.body, folder.query)) continue;
        const ids = membership.get(message.chatId) ?? [];
        if (!ids.includes(folder.id)) {
          membership.set(message.chatId, [...ids, folder.id]);
        }
      }
    }
    this.membership = membership;
  }

  private toDto(folder: KeywordFolder): ChatFolderDto {
    let unreadCount = 0;
    for (const [chatId, ids] of this.membership) {
      if (!ids.includes(folder.id)) continue;
      unreadCount += this.chatUnread.get(chatId) ?? 0;
    }
    return {
      id: folder.id,
      title: folder.title,
      unreadCount,
      kind: "keyword",
      query: folder.query,
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
