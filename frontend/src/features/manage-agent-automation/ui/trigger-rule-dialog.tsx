import { useState } from "react";

import type {
  AgentTriggerRuleDto,
  SaveTriggerRuleInput,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  Checkbox,
  Input,
} from "shared/ui";

import { DeliveryModeRadio } from "./delivery-mode-radio";

interface RuleDraft {
  readonly name: string;
  readonly chatIds: string;
  readonly senderIds: string;
  readonly keywords: string;
  readonly pattern: string;
  readonly excludeMuted: boolean;
  readonly delivery: "draft-only" | "auto-send";
  readonly promptTemplate: string;
}

const EMPTY_DRAFT: RuleDraft = {
  name: "",
  chatIds: "",
  senderIds: "",
  keywords: "",
  pattern: "",
  excludeMuted: false,
  delivery: "draft-only",
  promptTemplate: "",
};

function draftFromRule(rule: AgentTriggerRuleDto | null): RuleDraft {
  if (!rule) return EMPTY_DRAFT;
  return {
    name: rule.name,
    chatIds: rule.match.chatIds.join(", "),
    senderIds: rule.match.senderIds.join(", "),
    keywords: rule.match.keywords.join(", "),
    pattern: rule.match.pattern ?? "",
    excludeMuted: rule.match.excludeMuted,
    delivery: rule.delivery,
    promptTemplate: rule.promptTemplate,
  };
}

/** Splits a comma-separated field, dropping blanks so empty fields stay unset. */
function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export interface TriggerRuleDialogProps {
  /** The rule being edited, null for create, undefined closes the dialog. */
  readonly rule: AgentTriggerRuleDto | null | undefined;
  onClose(): void;
  onSave(input: SaveTriggerRuleInput): Promise<void>;
}

export function TriggerRuleDialog({
  rule,
  onClose,
  onSave,
}: TriggerRuleDialogProps) {
  return (
    <CenterMorphModal
      open={rule !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={rule ? copy.editTriggerRule : copy.addTriggerRule}
        closeButtonLabel={copy.closeDialog}
      >
        {/* The content subtree only exists while the modal is open, so the
            form mounts fresh from the edited rule on every opening. */}
        {rule !== undefined ? (
          <RuleForm rule={rule} onClose={onClose} onSave={onSave} />
        ) : null}
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

interface RuleFormProps {
  readonly rule: AgentTriggerRuleDto | null;
  onClose(): void;
  onSave(input: SaveTriggerRuleInput): Promise<void>;
}

function RuleForm({ rule, onClose, onSave }: RuleFormProps) {
  const [draft, setDraft] = useState<RuleDraft>(() => draftFromRule(rule));
  const [error, setError] = useState<string | null>(null);

  const patch = (part: Partial<RuleDraft>) =>
    setDraft((current) => ({ ...current, ...part }));

  const submit = async () => {
    const chatIds = parseList(draft.chatIds);
    const senderIds = parseList(draft.senderIds);
    const keywords = parseList(draft.keywords);
    const pattern = draft.pattern.trim();
    if (!chatIds.length && !senderIds.length && !keywords.length && !pattern) {
      setError(copy.ruleNeedsMatch);
      return;
    }
    if (pattern) {
      try {
        new RegExp(pattern);
      } catch {
        setError(copy.invalidPattern);
        return;
      }
    }
    const input: SaveTriggerRuleInput = {
      ...(rule ? { ruleId: rule.ruleId } : {}),
      name: draft.name.trim(),
      match: {
        ...(chatIds.length ? { chatIds } : {}),
        ...(senderIds.length ? { senderIds } : {}),
        ...(keywords.length ? { keywords } : {}),
        ...(pattern ? { pattern } : {}),
        excludeMuted: draft.excludeMuted,
      },
      delivery: draft.delivery,
      promptTemplate: draft.promptTemplate.trim(),
    };
    try {
      await onSave(input);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.failed);
    }
  };

  return (
    <form
      className="flex max-h-[80dvh] flex-col gap-4 overflow-y-auto p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {/* deslop-ignore-next-line 12 */}
      <h2 className="text-base font-semibold">
        {rule ? copy.editTriggerRule : copy.addTriggerRule}
      </h2>
      <Input
        label={copy.ruleName}
        value={draft.name}
        onChange={(name) => patch({ name })}
        required
      />
      <div className="flex flex-col gap-1.5">
        <Input
          label={copy.matchKeywords}
          value={draft.keywords}
          onChange={(keywords) => patch({ keywords })}
        />
        <p className="px-1 text-xs text-muted-foreground">
          {copy.matchKeywordsHint}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Input
          label={copy.matchChatIds}
          value={draft.chatIds}
          onChange={(chatIds) => patch({ chatIds })}
        />
        <p className="px-1 text-xs text-muted-foreground">
          {copy.matchIdsHint}
        </p>
      </div>
      <Input
        label={copy.matchSenderIds}
        value={draft.senderIds}
        onChange={(senderIds) => patch({ senderIds })}
      />
      <Input
        label={copy.matchPattern}
        value={draft.pattern}
        onChange={(pattern) => patch({ pattern })}
      />
      <Checkbox
        checked={draft.excludeMuted}
        onCheckedChange={(excludeMuted) => patch({ excludeMuted })}
        label={copy.excludeMuted}
      />
      <DeliveryModeRadio
        value={draft.delivery}
        onValueChange={(delivery) => patch({ delivery })}
      />
      <label className="flex flex-col gap-1.5">
        <span className="px-1 text-sm font-medium text-foreground">
          {copy.promptTemplate}
        </span>
        <textarea
          value={draft.promptTemplate}
          onChange={(event) => patch({ promptTemplate: event.target.value })}
          required
          rows={3}
          className="rounded-xl border border-border bg-transparent px-3.5 py-2.5 text-base leading-6 text-foreground outline-none transition-colors duration-200 placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:ring-2 focus:ring-ring/40"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <CenterMorphModalClose>
          <Button type="button" variant="ghost">
            {copy.cancel}
          </Button>
        </CenterMorphModalClose>
        <Button type="submit" variant="primary">
          {copy.saveTriggerRule}
        </Button>
      </div>
    </form>
  );
}
