import type {
  ChatPageDto,
  ChatPageInput,
  GlobalSearchResultDto,
} from "../../../../contracts/src/ipc";
import type { KeywordFolder } from "./keyword-folder";

export interface KeywordFolderRepository {
  list(): Promise<ReadonlyArray<KeywordFolder>>;
  save(folder: KeywordFolder): Promise<void>;
  remove(id: number): Promise<void>;
}

/**
 * The Telegram surface the keyword-folder projector needs: chat unread for
 * badges, and global search as a candidate set that the domain matcher then
 * filters by case-insensitive body substring.
 */
export interface KeywordFolderChatSource {
  listChatPage(input: ChatPageInput): Promise<ChatPageDto>;
  searchGlobal(query: string): Promise<GlobalSearchResultDto>;
}
