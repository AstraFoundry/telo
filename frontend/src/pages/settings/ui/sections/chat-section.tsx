import { useId } from "react";

import type { TimeFormatPreference } from "../../../../../../contracts/src/ipc";
import {
  useLoopStickers,
  useSendWithEnter,
  useTimeFormat,
} from "entities/preferences";
import { copy } from "shared/config/copy";
import {
  RadioGroup,
  RadioGroupItem,
  SettingsGroup,
  SettingsRow,
  SettingsStackedRow,
  Switch,
} from "shared/ui";

const TIME_FORMAT_CHOICES: readonly {
  readonly value: TimeFormatPreference;
  readonly label: string;
}[] = [
  { value: "system", label: copy.timeFormatSystem },
  { value: "12h", label: copy.timeFormat12h },
  { value: "24h", label: copy.timeFormat24h },
];

export function ChatSection() {
  const sendWithEnter = useSendWithEnter();
  const timeFormat = useTimeFormat();
  const loopStickers = useLoopStickers();
  const loopStickersId = useId();
  const loopStickersHintId = useId();

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={copy.messages}>
        <SettingsStackedRow label={copy.sendWithEnter}>
          <RadioGroup
            orientation="horizontal"
            value={sendWithEnter.value ? "enter" : "cmd-enter"}
            onValueChange={(value) => sendWithEnter.select(value === "enter")}
          >
            <RadioGroupItem value="enter" label={copy.sendWithEnterEnter} />
            <RadioGroupItem
              value="cmd-enter"
              label={copy.sendWithEnterCmdEnter}
            />
          </RadioGroup>
        </SettingsStackedRow>
        <SettingsStackedRow label={copy.timeFormat}>
          <RadioGroup
            orientation="horizontal"
            value={timeFormat.value}
            onValueChange={(value) =>
              timeFormat.select(value as TimeFormatPreference)
            }
          >
            {TIME_FORMAT_CHOICES.map((choice) => (
              <RadioGroupItem
                key={choice.value}
                value={choice.value}
                label={choice.label}
              />
            ))}
          </RadioGroup>
        </SettingsStackedRow>
      </SettingsGroup>

      <SettingsGroup title={copy.stickerPicker}>
        <SettingsRow
          label={copy.loopStickers}
          description={copy.loopStickersHint}
          labelFor={loopStickersId}
          descriptionId={loopStickersHintId}
        >
          <Switch
            id={loopStickersId}
            describedBy={loopStickersHintId}
            checked={loopStickers.value}
            onCheckedChange={loopStickers.select}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
