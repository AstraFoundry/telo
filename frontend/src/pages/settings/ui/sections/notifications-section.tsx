import { useId } from "react";

import { useChatStore } from "entities/chat";
import {
  useCountMutedChats,
  useNotificationPreview,
  useNotificationSenderName,
  useNotificationSound,
  useNotificationsEnabled,
  useNotifyChannels,
  useNotifyDirectChats,
  useNotifyGroupChats,
} from "entities/preferences";
import { copy } from "shared/config/copy";
import { SettingsGroup, SettingsRow, Switch } from "shared/ui";

import { NotificationPreview } from "../previews/notification-preview";

export function NotificationsSection() {
  const enabled = useNotificationsEnabled();
  const senderName = useNotificationSenderName();
  const preview = useNotificationPreview();
  const sound = useNotificationSound();
  const countMuted = useCountMutedChats();
  const directChats = useNotifyDirectChats();
  const groupChats = useNotifyGroupChats();
  const channels = useNotifyChannels();

  const enabledId = useId();
  const enabledHintId = useId();
  const senderNameId = useId();
  const senderNameHintId = useId();
  const previewId = useId();
  const previewHintId = useId();
  const soundId = useId();
  const soundHintId = useId();
  const countMutedId = useId();
  const countMutedHintId = useId();
  const directChatsId = useId();
  const groupChatsId = useId();
  const channelsId = useId();

  // The banner is assembled from a real chat when there is one, so the
  // preview shows what the reader's own next notification would say.
  const sampleChat = useChatStore(
    (state) => state.chats.find((chat) => !chat.muted) ?? null,
  );

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup>
        <SettingsRow
          label={copy.notificationsDesktop}
          description={copy.notificationsDesktopHint}
          labelFor={enabledId}
          descriptionId={enabledHintId}
          settingId="notifications-desktop"
        >
          <Switch
            id={enabledId}
            describedBy={enabledHintId}
            checked={enabled.value}
            onCheckedChange={enabled.select}
          />
        </SettingsRow>
      </SettingsGroup>

      {/* Everything below shapes a message notification, so it all depends on
          notifications being on at all and goes disabled with the master
          switch rather than disappearing - a row that vanishes reads as a
          missing feature. */}
      <SettingsGroup title={copy.messageNotifications}>
        <div className="p-2">
          <NotificationPreview
            chatTitle={sampleChat?.title ?? null}
            body={sampleChat?.preview.trim() || copy.previewIncomingMessage}
            senderName={senderName.value}
            preview={preview.value}
            sound={sound.value}
            muted={!enabled.value}
          />
        </div>
        <SettingsRow
          label={copy.notificationSenderName}
          description={copy.notificationSenderNameHint}
          labelFor={senderNameId}
          descriptionId={senderNameHintId}
          settingId="notification-sender-name"
        >
          <Switch
            id={senderNameId}
            describedBy={senderNameHintId}
            disabled={!enabled.value}
            checked={senderName.value}
            onCheckedChange={senderName.select}
          />
        </SettingsRow>
        <SettingsRow
          label={copy.notificationPreview}
          description={copy.notificationPreviewHint}
          labelFor={previewId}
          descriptionId={previewHintId}
          settingId="notification-preview"
        >
          <Switch
            id={previewId}
            describedBy={previewHintId}
            disabled={!enabled.value}
            checked={preview.value}
            onCheckedChange={preview.select}
          />
        </SettingsRow>
        <SettingsRow
          label={copy.notificationSound}
          description={copy.notificationSoundHint}
          labelFor={soundId}
          descriptionId={soundHintId}
          settingId="notification-sound"
        >
          <Switch
            id={soundId}
            describedBy={soundHintId}
            disabled={!enabled.value}
            checked={sound.value}
            onCheckedChange={sound.select}
          />
        </SettingsRow>
      </SettingsGroup>

      {/* The chat-kind split both reference clients expose. Saved Messages is
          this account's own chat and has no incoming traffic, so it rides with
          the private-chat switch instead of earning a fourth row. */}
      <SettingsGroup title={copy.chats}>
        <SettingsRow
          label={copy.notifyDirectChats}
          labelFor={directChatsId}
          settingId="notify-direct-chats"
        >
          <Switch
            id={directChatsId}
            disabled={!enabled.value}
            checked={directChats.value}
            onCheckedChange={directChats.select}
          />
        </SettingsRow>
        <SettingsRow
          label={copy.notifyGroupChats}
          labelFor={groupChatsId}
          settingId="notify-group-chats"
        >
          <Switch
            id={groupChatsId}
            disabled={!enabled.value}
            checked={groupChats.value}
            onCheckedChange={groupChats.select}
          />
        </SettingsRow>
        <SettingsRow
          label={copy.notifyChannels}
          labelFor={channelsId}
          settingId="notify-channels"
        >
          <Switch
            id={channelsId}
            disabled={!enabled.value}
            checked={channels.value}
            onCheckedChange={channels.select}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={copy.unreadMessages}>
        <SettingsRow
          label={copy.countMutedChats}
          description={copy.countMutedChatsHint}
          labelFor={countMutedId}
          descriptionId={countMutedHintId}
          settingId="count-muted-chats"
        >
          <Switch
            id={countMutedId}
            describedBy={countMutedHintId}
            checked={countMuted.value}
            onCheckedChange={countMuted.select}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
