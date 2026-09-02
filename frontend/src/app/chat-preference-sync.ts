import { useEffect } from "react";

import { useChatStore } from "entities/chat";
import {
  useCountMutedChats,
  useNotificationPreview,
  useNotificationSenderName,
  useNotificationsEnabled,
} from "entities/preferences";

/**
 * Feeds the chat store the preferences it reads outside React: the shape of a
 * desktop notification and whether muted chats count toward unread badges.
 * `entities/chat` cannot subscribe to `entities/preferences` — they are the
 * same layer — so the composition root carries the values across, and a
 * Settings toggle reaches the badges and the next notification immediately
 * rather than on the next workspace load.
 *
 * The push waits until every store has hydrated: before that a hook answers
 * with its own default, which would overwrite the store's deliberately
 * conservative boot state (no notifications until the persisted set asks for
 * them). `load()` still seeds the mirror, so this only carries changes.
 */
export function useChatPreferenceSync(): void {
  const applyPreferences = useChatStore((state) => state.applyPreferences);
  const notificationsEnabled = useNotificationsEnabled();
  const notificationSenderName = useNotificationSenderName();
  const notificationPreview = useNotificationPreview();
  const countMutedChats = useCountMutedChats();
  const hydrated =
    notificationsEnabled.loaded &&
    notificationSenderName.loaded &&
    notificationPreview.loaded &&
    countMutedChats.loaded;

  useEffect(() => {
    if (!hydrated) return;
    applyPreferences({
      notificationsEnabled: notificationsEnabled.value,
      notificationSenderName: notificationSenderName.value,
      notificationPreview: notificationPreview.value,
      countMutedChats: countMutedChats.value,
    });
  }, [
    applyPreferences,
    hydrated,
    notificationsEnabled.value,
    notificationSenderName.value,
    notificationPreview.value,
    countMutedChats.value,
  ]);
}
