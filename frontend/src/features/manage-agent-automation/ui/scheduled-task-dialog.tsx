import { useState } from "react";

import type {
  AgentDeliveryMode,
  AgentScheduledTaskDto,
  SaveScheduledTaskInput,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import {
  Button,
  CenterMorphModal,
  CenterMorphModalClose,
  CenterMorphModalContent,
  ErrorRow,
  Input,
  RadioGroup,
  RadioGroupItem,
} from "shared/ui";

import { DeliveryModeRadio } from "./delivery-mode-radio";

type ScheduleKind = "cron" | "once";
type ContextChoice = "none" | "unread" | "folder";

interface TaskDraft {
  readonly name: string;
  readonly scheduleKind: ScheduleKind;
  readonly cron: string;
  /** `datetime-local` value, local wall time. */
  readonly runAt: string;
  readonly delivery: AgentDeliveryMode;
  readonly chatId: string;
  readonly promptTemplate: string;
  readonly context: ContextChoice;
  readonly folderId: string;
}

const EMPTY_DRAFT: TaskDraft = {
  name: "",
  scheduleKind: "cron",
  cron: "",
  runAt: "",
  delivery: "draft-only",
  chatId: "",
  promptTemplate: "",
  context: "none",
  folderId: "",
};

/** Pads a local date into the `YYYY-MM-DDTHH:mm` shape the field expects. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function draftFromTask(task: AgentScheduledTaskDto | null): TaskDraft {
  if (!task) return EMPTY_DRAFT;
  return {
    name: task.name,
    scheduleKind: task.schedule.kind,
    cron: task.schedule.kind === "cron" ? task.schedule.expression : "",
    runAt:
      task.schedule.kind === "once"
        ? toLocalInputValue(task.schedule.runAt)
        : "",
    delivery: task.delivery,
    chatId: task.chatId,
    promptTemplate: task.promptTemplate,
    context: task.context ? task.context.scope : "none",
    folderId:
      task.context?.scope === "folder" && task.context.folderId !== undefined
        ? String(task.context.folderId)
        : "",
  };
}

export interface ScheduledTaskDialogProps {
  /** The task being edited, null for create, undefined closes the dialog. */
  readonly task: AgentScheduledTaskDto | null | undefined;
  onClose(): void;
  onSave(input: SaveScheduledTaskInput): Promise<void>;
}

export function ScheduledTaskDialog({
  task,
  onClose,
  onSave,
}: ScheduledTaskDialogProps) {
  return (
    <CenterMorphModal
      open={task !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <CenterMorphModalContent
        ariaLabel={task ? copy.editScheduledTask : copy.addScheduledTask}
        closeButtonLabel={copy.closeDialog}
      >
        {/* The content subtree only exists while the modal is open, so the
            form mounts fresh from the edited task on every opening. */}
        {task !== undefined ? (
          <TaskForm task={task} onClose={onClose} onSave={onSave} />
        ) : null}
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

interface TaskFormProps {
  readonly task: AgentScheduledTaskDto | null;
  onClose(): void;
  onSave(input: SaveScheduledTaskInput): Promise<void>;
}

function TaskForm({ task, onClose, onSave }: TaskFormProps) {
  const [draft, setDraft] = useState<TaskDraft>(() => draftFromTask(task));
  const [error, setError] = useState<string | null>(null);

  const patch = (part: Partial<TaskDraft>) =>
    setDraft((current) => ({ ...current, ...part }));

  const submit = async () => {
    const cron = draft.cron.trim();
    if (draft.scheduleKind === "cron" && cron.split(/\s+/).length !== 5) {
      setError(copy.cronFieldsInvalid);
      return;
    }
    let schedule: SaveScheduledTaskInput["schedule"];
    if (draft.scheduleKind === "cron") {
      schedule = { kind: "cron", expression: cron };
    } else {
      const runAt = new Date(draft.runAt);
      if (!draft.runAt || Number.isNaN(runAt.getTime())) {
        setError(copy.runAtInvalid);
        return;
      }
      schedule = { kind: "once", runAt: runAt.toISOString() };
    }
    const folderId = Number(draft.folderId);
    const input: SaveScheduledTaskInput = {
      ...(task ? { taskId: task.taskId } : {}),
      name: draft.name.trim(),
      schedule,
      delivery: draft.delivery,
      chatId: draft.chatId.trim(),
      promptTemplate: draft.promptTemplate.trim(),
      context:
        draft.context === "unread"
          ? { scope: "unread" }
          : draft.context === "folder" && Number.isFinite(folderId)
            ? { scope: "folder", folderId }
            : null,
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
        {task ? copy.editScheduledTask : copy.addScheduledTask}
      </h2>
      <Input
        label={copy.taskName}
        value={draft.name}
        onChange={(name) => patch({ name })}
        required
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="px-1 text-sm font-medium text-foreground">
          {copy.scheduleKind}
        </legend>
        <RadioGroup
          orientation="horizontal"
          value={draft.scheduleKind}
          onValueChange={(kind) =>
            patch({ scheduleKind: kind as ScheduleKind })
          }
        >
          <RadioGroupItem value="cron" label={copy.scheduleCron} />
          <RadioGroupItem value="once" label={copy.scheduleOnce} />
        </RadioGroup>
      </fieldset>
      {draft.scheduleKind === "cron" ? (
        <div className="flex flex-col gap-1.5">
          <Input
            label={copy.cronExpression}
            value={draft.cron}
            onChange={(cron) => patch({ cron })}
            required
          />
          <p className="px-1 text-xs text-muted-foreground">
            {copy.cronExpressionHint}
          </p>
        </div>
      ) : (
        <Input
          label={copy.runAt}
          type="datetime-local"
          value={draft.runAt}
          onChange={(runAt) => patch({ runAt })}
          required
        />
      )}
      <DeliveryModeRadio
        value={draft.delivery}
        onValueChange={(delivery) => patch({ delivery })}
      />
      <Input
        label={copy.targetChatId}
        value={draft.chatId}
        onChange={(chatId) => patch({ chatId })}
        required
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
      <fieldset className="flex flex-col gap-2">
        <legend className="px-1 text-sm font-medium text-foreground">
          {copy.taskContext}
        </legend>
        <RadioGroup
          value={draft.context}
          onValueChange={(context) =>
            patch({ context: context as ContextChoice })
          }
        >
          <RadioGroupItem value="none" label={copy.contextNone} />
          <RadioGroupItem value="unread" label={copy.contextUnread} />
          <RadioGroupItem value="folder" label={copy.contextFolder} />
        </RadioGroup>
      </fieldset>
      {draft.context === "folder" ? (
        <Input
          label={copy.folderId}
          inputMode="numeric"
          value={draft.folderId}
          onChange={(folderId) => patch({ folderId })}
          required
        />
      ) : null}
      <ErrorRow message={error} />
      <div className="flex justify-end gap-2">
        <CenterMorphModalClose>
          <Button type="button" variant="ghost">
            {copy.cancel}
          </Button>
        </CenterMorphModalClose>
        <Button type="submit" variant="primary">
          {copy.saveScheduledTask}
        </Button>
      </div>
    </form>
  );
}
