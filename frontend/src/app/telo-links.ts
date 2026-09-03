import { useEffect } from "react";

import { parseTeloLink } from "../../../contracts/src/ipc";
import { useChatStore } from "entities/chat";

/**
 * Makes `telo://` links work anywhere in the renderer. Agent replies cite
 * Telegram messages as ordinary anchors with an in-app href; one delegated
 * listener turns a click on any of them into the chat store's jump-to-message
 * flow (select the chat, page until found, highlight). Nothing else handles
 * the scheme, so the click is consumed here and never reaches navigation.
 * `onNavigate` lets the shell bring the conversation surface forward first.
 */
export function useTeloLinks(onNavigate: () => void): void {
  useEffect(() => {
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      const href = anchor?.getAttribute("href");
      if (!href) return;
      const link = parseTeloLink(href);
      if (!link) return;
      event.preventDefault();
      onNavigate();
      void useChatStore
        .getState()
        .requestJumpToMessage(link.chatId, link.messageId);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [onNavigate]);
}
