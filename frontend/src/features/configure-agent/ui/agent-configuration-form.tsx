import { useEffect, useState } from "react";

import { useAgentStore } from "entities/agent";
import { copy } from "shared/config/copy";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatefulButton,
  Switch,
} from "shared/ui";

type SaveState = "idle" | "loading" | "success" | "error";

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
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!configuration) return;
    queueMicrotask(() => {
      setProvider(configuration.provider);
      setModel(configuration.model);
      setBaseUrl(configuration.baseUrl ?? "");
      setInstructions(configuration.instructions);
      setInspect(configuration.canInspectWorkspace);
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
      });
      setApiKey("");
      setSaveState("success");
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch {
      setSaveState("error");
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {copy.provider}
        <Select
          value={provider}
          onValueChange={(value) => setProvider(value as typeof provider)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">{copy.openAi}</SelectItem>
            <SelectItem value="openai-compatible">{copy.compatible}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <Input label={copy.model} value={model} onChange={setModel} required />
      <Input
        label={copy.baseUrl}
        value={baseUrl}
        onChange={setBaseUrl}
        placeholder={copy.optional}
      />
      <Input
        label={copy.apiKey}
        type="password"
        value={apiKey}
        onChange={setApiKey}
        placeholder={copy.apiKeyPlaceholder}
      />
      <Input
        label={copy.instructions}
        value={instructions}
        onChange={setInstructions}
        required
      />
      <Switch
        checked={inspect}
        onCheckedChange={setInspect}
        label={copy.inspectWorkspace}
      />
      <StatefulButton
        type="submit"
        state={saveState}
        loadingText={copy.saving}
        successText={copy.saved}
        errorText={copy.failed}
      >
        {copy.save}
      </StatefulButton>
    </form>
  );
}
