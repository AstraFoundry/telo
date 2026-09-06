import type { ChatDto } from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";

/**
 * TDLib titles Saved Messages with the account's own name. The workspace
 * always shows the product label, including search and the forward picker.
 */
export function displayChatTitle(
  chat: Pick<ChatDto, "kind" | "title">,
): string {
  return chat.kind === "saved" ? copy.savedMessages : chat.title;
}

/** Saved Messages stays at the top of a picker so it is not buried in 200 rows. */
export function chatsForPicker(
  chats: ReadonlyArray<ChatDto>,
  query: string,
): ChatDto[] {
  const term = query.trim().toLocaleLowerCase();
  const filtered = term
    ? chats.filter((chat) =>
        displayChatTitle(chat).toLocaleLowerCase().includes(term),
      )
    : [...chats];
  return filtered.sort((left, right) => {
    if (left.kind === "saved" && right.kind !== "saved") return -1;
    if (right.kind === "saved" && left.kind !== "saved") return 1;
    return 0;
  });
}
