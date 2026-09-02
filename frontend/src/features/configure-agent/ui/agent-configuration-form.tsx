import { useEffect, useId, useState } from "react";

import {
  AGENT_HISTORY_LIMIT_MAX,
  AGENT_HISTORY_LIMIT_MIN,
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  AGENT_TEMPERATURE_MAX,
  AGENT_TEMPERATURE_MIN,
} from "../../../../../contracts/src/ipc";
import { useAgentStore } from "entities/agent";
import { copy } from "shared/config/copy";
import {
  Input,
  RangeSlider,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsGroup,
  SettingsRow,
  SettingsStackedRow,
  StatefulButton,
  Switch,
} from "shared/ui";

type SaveState = "idle" | "loading" | "success" | "error";

/** One decimal is the finest step worth exposing for sampling temperature. */
const TEMPERATURE_STEP = 0.1;

export function AgentConfigurationForm() {
  const configuration = useAgentStore((state) => state.configuration);
  const load = useAgentStore((state) => state.loadConfiguration);
  const save = useAgentStore((state) => state.saveConfiguration);
  const [provider, setProvider] = useState<"openai" | "openai-compatible">(
    "openai",
  );
  const [model, setModel] = useState("gpt-4.1-mini");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instructions, setInstructions] = useState("");
  const [inspect, setInspect] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxSteps, setMaxSteps] = useState(4);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const inspectId = useId();
  const inspectHintId = useId();

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!configuration) return;
    queueMicrotask(() => {
      setProvider(configuration.provider);
      setModel(configuration.model);
      setBaseUrl(configuration.baseUrl ?? "");
      setInstructions(configuration.instructions);
      setInspect(configuration.canInspectWorkspace);
      setTemperature(configuration.temperature);
      setMaxSteps(configuration.maxSteps);
      setHistoryLimit(configuration.historyLimit);
    });
  }, [configuration]);

  const submit = async () => {
    setSaveState("loading");
    try {
      await save({
        provider,
        model,
        baseUrl: baseUrl || null,
        apiKey: apiKey || undefined,
        instructions,
        canInspectWorkspace: inspect,
        temperature,
        maxSteps,
        historyLimit,
      });
      setApiKey("");
      setSaveState("success");
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch {
      setSaveState("error");
    }
  };

  return (
    // Credentials and a system prompt are not a switch: they are a coherent
    // form that has to be committed deliberately, so this section keeps an
    // explicit Save while the rest of Settings writes on change.
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <SettingsGroup title={copy.agentProviderGroup}>
        <SettingsRow label={copy.provider}>
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value as typeof provider)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">{copy.openAi}</SelectItem>
              <SelectItem value="openai-compatible">
                {copy.compatible}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsStackedRow label={copy.model}>
          <Input
            value={model}
            onChange={setModel}
            aria-label={copy.model}
            required
          />
        </SettingsStackedRow>
        <SettingsStackedRow label={copy.baseUrl}>
          <Input
            value={baseUrl}
            onChange={setBaseUrl}
            aria-label={copy.baseUrl}
            placeholder={copy.optional}
          />
        </SettingsStackedRow>
        <SettingsStackedRow label={copy.apiKey}>
          <Input
            type="password"
            value={apiKey}
            onChange={setApiKey}
            aria-label={copy.apiKey}
            placeholder={copy.apiKeyPlaceholder}
          />
        </SettingsStackedRow>
      </SettingsGroup>

      <SettingsGroup title={copy.agentBehaviourGroup}>
        <SettingsStackedRow label={copy.instructions}>
          <Input
            value={instructions}
            onChange={setInstructions}
            aria-label={copy.instructions}
            required
          />
        </SettingsStackedRow>
        <SettingsRow
          label={copy.inspectWorkspace}
          labelFor={inspectId}
          descriptionId={inspectHintId}
        >
          <Switch
            id={inspectId}
            describedBy={inspectHintId}
            checked={inspect}
            onCheckedChange={setInspect}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={copy.agentTuningGroup}>
        <SettingsStackedRow
          label={copy.agentTemperature}
          description={copy.agentTemperatureHint}
          value={temperature.toFixed(1)}
        >
          <RangeSlider
            min={AGENT_TEMPERATURE_MIN}
            max={AGENT_TEMPERATURE_MAX}
            step={TEMPERATURE_STEP}
            value={temperature}
            onValueChange={setTemperature}
            aria-label={copy.agentTemperature}
          />
        </SettingsStackedRow>
        <SettingsStackedRow
          label={copy.agentMaxSteps}
          description={copy.agentMaxStepsHint}
          value={`${maxSteps}`}
        >
          <RangeSlider
            min={AGENT_MAX_STEPS_MIN}
            max={AGENT_MAX_STEPS_MAX}
            step={1}
            value={maxSteps}
            onValueChange={setMaxSteps}
            aria-label={copy.agentMaxSteps}
          />
        </SettingsStackedRow>
        <SettingsStackedRow
          label={copy.agentHistoryLimit}
          description={copy.agentHistoryLimitHint}
          value={`${historyLimit}`}
        >
          <RangeSlider
            min={AGENT_HISTORY_LIMIT_MIN}
            max={AGENT_HISTORY_LIMIT_MAX}
            step={1}
            value={historyLimit}
            onValueChange={setHistoryLimit}
            aria-label={copy.agentHistoryLimit}
          />
        </SettingsStackedRow>
      </SettingsGroup>

      <div className="flex justify-end">
        <StatefulButton
          type="submit"
          state={saveState}
          loadingText={copy.saving}
          successText={copy.saved}
          errorText={copy.failed}
        >
          {copy.save}
        </StatefulButton>
      </div>
    </form>
  );
}
