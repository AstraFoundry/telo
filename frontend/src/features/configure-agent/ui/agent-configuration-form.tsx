import { useEffect, useId, useState } from "react";

import {
  AGENT_COMPATIBLE_PROVIDER,
  AGENT_HISTORY_LIMIT_MAX,
  AGENT_HISTORY_LIMIT_MIN,
  AGENT_MAX_STEPS_MAX,
  AGENT_MAX_STEPS_MIN,
  AGENT_PROVIDER_DEFAULT_MODEL,
  AGENT_TEMPERATURE_MAX,
  AGENT_TEMPERATURE_MIN,
  agentOAuthIsConfigured,
  type AgentProvider,
  type ConnectAgentAccountInput,
} from "../../../../../contracts/src/ipc";
import { useAgentStore } from "entities/agent";
import { copy } from "shared/config/copy";
import {
  Input,
  RangeSlider,
  SettingsGroup,
  SettingsRow,
  SettingsStackedRow,
  StatefulButton,
  Switch,
} from "shared/ui";

import { ProviderPicker } from "./provider-picker";

type SaveState = "idle" | "loading" | "success" | "error";

/** One decimal is the finest step worth exposing for sampling temperature. */
const TEMPERATURE_STEP = 0.1;

export function AgentConfigurationForm() {
  const configuration = useAgentStore((state) => state.configuration);
  const load = useAgentStore((state) => state.loadConfiguration);
  const save = useAgentStore((state) => state.saveConfiguration);
  const connectAccount = useAgentStore((state) => state.connectAccount);
  const disconnectAccount = useAgentStore((state) => state.disconnectAccount);
  const [provider, setProvider] = useState<AgentProvider>("openai");
  const [model, setModel] = useState(AGENT_PROVIDER_DEFAULT_MODEL.openai);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instructions, setInstructions] = useState("");
  const [inspect, setInspect] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxSteps, setMaxSteps] = useState(4);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [connectState, setConnectState] = useState<SaveState>("idle");
  const [connectSuccess, setConnectSuccess] = useState<string>(
    copy.accountConnected,
  );

  const inspectId = useId();
  const inspectHintId = useId();
  const compatible = provider === AGENT_COMPATIBLE_PROVIDER;
  const oauthPath = agentOAuthIsConfigured(
    configuration?.configuredOAuthProviders ?? [],
    provider,
  );
  const connected =
    oauthPath &&
    configuration?.provider === provider &&
    configuration.authKind === "oauth";

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

  const changeProvider = (next: AgentProvider) => {
    setProvider(next);
    setModel(AGENT_PROVIDER_DEFAULT_MODEL[next]);
    if (next !== AGENT_COMPATIBLE_PROVIDER) setBaseUrl("");
  };

  const accountFields = (): ConnectAgentAccountInput => ({
    provider,
    model,
    baseUrl: compatible ? baseUrl || null : null,
    instructions,
    canInspectWorkspace: inspect,
    temperature,
    maxSteps,
    historyLimit,
  });

  const submit = async () => {
    setSaveState("loading");
    try {
      await save({
        ...accountFields(),
        apiKey: apiKey || undefined,
      });
      setApiKey("");
      setSaveState("success");
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch {
      setSaveState("error");
    }
  };

  const connect = async () => {
    const disconnecting = connected;
    setConnectState("loading");
    try {
      if (disconnecting) await disconnectAccount(accountFields());
      else await connectAccount(accountFields());
      setConnectSuccess(disconnecting ? copy.saved : copy.accountConnected);
      setConnectState("success");
      window.setTimeout(() => setConnectState("idle"), 1200);
    } catch {
      setConnectState("error");
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
        <SettingsStackedRow label={copy.provider}>
          <ProviderPicker value={provider} onValueChange={changeProvider} />
        </SettingsStackedRow>
        <SettingsStackedRow label={copy.model}>
          <Input
            value={model}
            onChange={setModel}
            aria-label={copy.model}
            required
          />
        </SettingsStackedRow>
        {compatible ? (
          <SettingsStackedRow label={copy.baseUrl}>
            <Input
              value={baseUrl}
              onChange={setBaseUrl}
              aria-label={copy.baseUrl}
              required
            />
          </SettingsStackedRow>
        ) : null}
        {oauthPath ? (
          <SettingsRow
            label={copy.account}
            value={
              connected ? (configuration?.accountLabel ?? undefined) : undefined
            }
          >
            <StatefulButton
              type="button"
              state={connectState}
              loadingText={copy.connectingAccount}
              successText={connectSuccess}
              errorText={copy.failed}
              onClick={() => void connect()}
            >
              {connected ? copy.disconnectAccount : copy.connectAccount}
            </StatefulButton>
          </SettingsRow>
        ) : (
          <SettingsStackedRow label={copy.apiKey}>
            <Input
              type="password"
              value={apiKey}
              onChange={setApiKey}
              aria-label={copy.apiKey}
              placeholder={copy.apiKeyPlaceholder}
            />
          </SettingsStackedRow>
        )}
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
