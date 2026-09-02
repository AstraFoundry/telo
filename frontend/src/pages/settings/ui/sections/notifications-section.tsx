import { useId } from "react";

import {
  useCountMutedChats,
  useNotificationPreview,
  useNotificationSenderName,
  useNotificationsEnabled,
} from "entities/preferences";
import { copy } from "shared/config/copy";
import { SettingsGroup, SettingsRow, Switch } from "shared/ui";

export function NotificationsSection() {
  const enabled = useNotificationsEnabled();
  const senderName = useNotificationSenderName();
  const preview = useNotificationPreview();
  const countMuted = useCountMutedChats();

  const enabledId = useId();
  const enabledHintId = useId();
  const senderNameId = useId();
  const senderNameHintId = useId();
  const previewId = useId();
  const previewHintId = useId();
  const countMutedId = useId();
  const countMutedHintId = useId();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup>
        <SettingsRow
          label={copy.notificationsDesktop}
          description={copy.notificationsDesktopHint}
          labelFor={enabledId}
          descriptionId={enabledHintId}
        >
          <Switch
            id={enabledId}
            describedBy={enabledHintId}
            checked={enabled.value}
            onCheckedChange={enabled.select}
          />
        </SettingsRow>
        {/* Both rows describe what a notification says, so they depend on
            notifications being on at all and go disabled with it rather than
            disappearing - a row that vanishes reads as a missing feature. */}
        <SettingsRow
          label={copy.notificationSenderName}
          description={copy.notificationSenderNameHint}
          labelFor={senderNameId}
          descriptionId={senderNameHintId}
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
        >
          <Switch
            id={previewId}
            describedBy={previewHintId}
            disabled={!enabled.value}
            checked={preview.value}
            onCheckedChange={preview.select}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={copy.unreadMessages}>
        <SettingsRow
          label={copy.countMutedChats}
          description={copy.countMutedChatsHint}
          labelFor={countMutedId}
          descriptionId={countMutedHintId}
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
