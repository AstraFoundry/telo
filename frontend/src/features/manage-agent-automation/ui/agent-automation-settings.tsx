import { PencilSimple, Plus, Sparkle, Trash } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useState } from "react";

import type {
  AgentScheduledTaskDto,
  AgentTriggerRuleDto,
} from "../../../../../contracts/src/ipc";
import { copy } from "shared/config/copy";
import { Button, EASE_OUT, Switch, Tooltip } from "shared/ui";

import { useAgentAutomation } from "../model/use-agent-automation";
import { ScheduledTaskDialog } from "./scheduled-task-dialog";
import { TriggerRuleDialog } from "./trigger-rule-dialog";

/** Localized date+time for run stamps; rendered in tabular numerals by callers. */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/** AND across dimensions, OR across keywords — flattened into one read-out. */
function ruleSummary(rule: AgentTriggerRuleDto): string {
  const segments: string[] = [];
  if (rule.match.keywords.length > 0) {
    segments.push(`${copy.matchKeywords}: ${rule.match.keywords.join(", ")}`);
  }
  if (rule.match.pattern) segments.push(`/${rule.match.pattern}/`);
  if (rule.match.chatIds.length > 0) {
    segments.push(`${copy.matchChatIds}: ${rule.match.chatIds.join(", ")}`);
  }
  if (rule.match.senderIds.length > 0) {
    segments.push(`${copy.matchSenderIds}: ${rule.match.senderIds.join(", ")}`);
  }
  if (rule.match.excludeMuted) segments.push(copy.matchSkipsMuted);
  return segments.join(" · ");
}

function taskSummary(task: AgentScheduledTaskDto): string {
  const schedule =
    task.schedule.kind === "cron"
      ? task.schedule.expression
      : formatDateTime(task.schedule.runAt);
  return task.nextRunAt
    ? `${schedule} · ${copy.nextRun}: ${formatDateTime(task.nextRunAt)}`
    : schedule;
}

function DeliveryBadge({
  delivery,
}: {
  readonly delivery: "auto-send" | "draft-only";
}) {
  return (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
      {delivery === "auto-send"
        ? copy.deliveryAutoSendBadge
        : copy.deliveryDraftOnlyBadge}
    </span>
  );
}

function CreatedByAgentMarker({
  createdBy,
}: {
  readonly createdBy: "user" | "agent";
}) {
  if (createdBy !== "agent") return null;
  return (
    <Tooltip content={copy.createdByAgent}>
      <Sparkle
        role="img"
        aria-label={copy.createdByAgent}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </Tooltip>
  );
}

export function AgentAutomationSettings() {
  const {
    rules,
    tasks,
    actionError,
    setRuleEnabled,
    removeRule,
    saveRule,
    setTaskEnabled,
    removeTask,
    saveTask,
  } = useAgentAutomation();
  // Row entrance/exit shared by both lists; exits are softer than entrances.
  const reduceMotion = useReducedMotionConfig();
  const rowMotion = {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 },
    transition: { duration: reduceMotion ? 0.1 : 0.16, ease: EASE_OUT },
  } as const;
  const [ruleDialog, setRuleDialog] = useState<
    AgentTriggerRuleDto | null | undefined
  >(undefined);
  const [taskDialog, setTaskDialog] = useState<
    AgentScheduledTaskDto | null | undefined
  >(undefined);

  return (
    <>
      <section aria-labelledby="trigger-rules-title">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {/* deslop-ignore-next-line 12 */}
            <h2 id="trigger-rules-title" className="text-sm font-semibold">
              {copy.triggerRules}
            </h2>
            <p className="text-xs text-muted-foreground">
              {copy.triggerRulesHint}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRuleDialog(null)}
            className="shrink-0"
          >
            <Plus aria-hidden="true" />
            {copy.addTriggerRule}
          </Button>
        </div>
        <ul className="mt-5 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {rules.length === 0 ? (
              <motion.li
                key="empty"
                {...rowMotion}
                className="text-sm text-muted-foreground"
              >
                {copy.noTriggerRules}
              </motion.li>
            ) : (
              rules.map((rule) => (
                <motion.li
                  key={rule.ruleId}
                  {...rowMotion}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {rule.name}
                      </span>
                      <DeliveryBadge delivery={rule.delivery} />
                      <CreatedByAgentMarker createdBy={rule.createdBy} />
                    </span>
                    <span className="truncate text-xs tabular-nums text-muted-foreground">
                      {ruleSummary(rule)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(enabled) =>
                        void setRuleEnabled(rule, enabled)
                      }
                      ariaLabel={`${copy.toggleTriggerRule}: ${rule.name}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${copy.editTriggerRule}: ${rule.name}`}
                      onClick={() => setRuleDialog(rule)}
                    >
                      <PencilSimple />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${copy.deleteTriggerRule}: ${rule.name}`}
                      onClick={() => void removeRule(rule.ruleId)}
                    >
                      <Trash />
                    </Button>
                  </div>
                </motion.li>
              ))
            )}
          </AnimatePresence>
        </ul>
      </section>

      <section aria-labelledby="scheduled-tasks-title">
        <div className="flex items-start justify-between gap-4">
          {/* deslop-ignore-next-line 12 */}
          <h2 id="scheduled-tasks-title" className="text-sm font-semibold">
            {copy.scheduledTasks}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTaskDialog(null)}
            className="shrink-0"
          >
            <Plus aria-hidden="true" />
            {copy.addScheduledTask}
          </Button>
        </div>
        <ul className="mt-5 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {tasks.length === 0 ? (
              <motion.li
                key="empty"
                {...rowMotion}
                className="text-sm text-muted-foreground"
              >
                {copy.noScheduledTasks}
              </motion.li>
            ) : (
              tasks.map((task) => (
                <motion.li
                  key={task.taskId}
                  {...rowMotion}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {task.name}
                      </span>
                      <DeliveryBadge delivery={task.delivery} />
                      <CreatedByAgentMarker createdBy={task.createdBy} />
                    </span>
                    <span className="truncate text-xs tabular-nums text-muted-foreground">
                      {taskSummary(task)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={task.enabled}
                      onCheckedChange={(enabled) =>
                        void setTaskEnabled(task, enabled)
                      }
                      ariaLabel={`${copy.toggleScheduledTask}: ${task.name}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${copy.editScheduledTask}: ${task.name}`}
                      onClick={() => setTaskDialog(task)}
                    >
                      <PencilSimple />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${copy.deleteScheduledTask}: ${task.name}`}
                      onClick={() => void removeTask(task.taskId)}
                    >
                      <Trash />
                    </Button>
                  </div>
                </motion.li>
              ))
            )}
          </AnimatePresence>
        </ul>
      </section>

      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      ) : null}

      <TriggerRuleDialog
        rule={ruleDialog}
        onClose={() => setRuleDialog(undefined)}
        onSave={saveRule}
      />
      <ScheduledTaskDialog
        task={taskDialog}
        onClose={() => setTaskDialog(undefined)}
        onSave={saveTask}
      />
    </>
  );
}
