import { useCallback, useEffect, useState } from "react";

import type {
  AgentAutomationEvent,
  AgentScheduledTaskDto,
  AgentTriggerRuleDto,
  SaveScheduledTaskInput,
  SaveTriggerRuleInput,
} from "../../../../../contracts/src/ipc";

export interface AgentAutomationModel {
  readonly rules: ReadonlyArray<AgentTriggerRuleDto>;
  readonly tasks: ReadonlyArray<AgentScheduledTaskDto>;
  /** False until the first list round trip settles. */
  readonly loaded: boolean;
  /** Message of the last failed list action; cleared by the next success. */
  readonly actionError: string | null;
  refresh(): Promise<void>;
  setRuleEnabled(rule: AgentTriggerRuleDto, enabled: boolean): Promise<void>;
  removeRule(ruleId: string): Promise<void>;
  saveRule(input: SaveTriggerRuleInput): Promise<void>;
  setTaskEnabled(task: AgentScheduledTaskDto, enabled: boolean): Promise<void>;
  removeTask(taskId: string): Promise<void>;
  saveTask(input: SaveScheduledTaskInput): Promise<void>;
}

function notifyRunOutcome(event: AgentAutomationEvent): void {
  if (event.status !== "draft-conflict" && event.status !== "error") return;
  const body =
    event.status === "error" ? (event.error ?? event.preview) : event.preview;
  void window.telo.shell.notify(event.sourceName, body, event.chatId);
}

function fetchAutomation(): Promise<
  [ReadonlyArray<AgentTriggerRuleDto>, ReadonlyArray<AgentScheduledTaskDto>]
> {
  return Promise.all([
    window.telo.agent.listTriggerRules(),
    window.telo.agent.listScheduledTasks(),
  ]);
}

/**
 * Loads trigger rules and scheduled tasks from the main process and keeps
 * them current while the settings section is mounted: every automation run
 * event re-lists both, and only a draft conflict or a failure additionally
 * escalates to a system notification, because the chat surface already shows
 * successful deliveries.
 *
 * Writes are not optimistic: the bridge answer (or a full re-list after a
 * save) is what moves the state, so a rejected write leaves the view
 * unchanged rather than needing a revert.
 */
export function useAgentAutomation(): AgentAutomationModel {
  const [rules, setRules] = useState<ReadonlyArray<AgentTriggerRuleDto>>([]);
  const [tasks, setTasks] = useState<ReadonlyArray<AgentScheduledTaskDto>>([]);
  const [loaded, setLoaded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextRules, nextTasks] = await fetchAutomation();
    setRules(nextRules);
    setTasks(nextTasks);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // The setters land after the bridge round trip, mirroring
    // use-agent-models: effects never set state synchronously.
    let active = true;
    const load = async () => {
      const [nextRules, nextTasks] = await fetchAutomation();
      if (!active) return;
      setRules(nextRules);
      setTasks(nextTasks);
      setLoaded(true);
    };
    void load();
    const unsubscribe = window.telo.agent.onAutomationEvent((event) => {
      notifyRunOutcome(event);
      void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const setRuleEnabled = useCallback(
    async (rule: AgentTriggerRuleDto, enabled: boolean) => {
      try {
        const updated = await window.telo.agent.setTriggerRuleEnabled(
          rule.ruleId,
          enabled,
        );
        setRules((current) =>
          current.map((entry) =>
            entry.ruleId === updated.ruleId ? updated : entry,
          ),
        );
        setActionError(null);
      } catch (caught) {
        setActionError(
          caught instanceof Error ? caught.message : String(caught),
        );
      }
    },
    [],
  );

  const removeRule = useCallback(async (ruleId: string) => {
    try {
      await window.telo.agent.removeTriggerRule(ruleId);
      setRules((current) => current.filter((entry) => entry.ruleId !== ruleId));
      setActionError(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const saveRule = useCallback(
    async (input: SaveTriggerRuleInput) => {
      await window.telo.agent.saveTriggerRule(input);
      await refresh();
    },
    [refresh],
  );

  const setTaskEnabled = useCallback(
    async (task: AgentScheduledTaskDto, enabled: boolean) => {
      try {
        const updated = await window.telo.agent.setScheduledTaskEnabled(
          task.taskId,
          enabled,
        );
        setTasks((current) =>
          current.map((entry) =>
            entry.taskId === updated.taskId ? updated : entry,
          ),
        );
        setActionError(null);
      } catch (caught) {
        setActionError(
          caught instanceof Error ? caught.message : String(caught),
        );
      }
    },
    [],
  );

  const removeTask = useCallback(async (taskId: string) => {
    try {
      await window.telo.agent.removeScheduledTask(taskId);
      setTasks((current) => current.filter((entry) => entry.taskId !== taskId));
      setActionError(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const saveTask = useCallback(
    async (input: SaveScheduledTaskInput) => {
      await window.telo.agent.saveScheduledTask(input);
      await refresh();
    },
    [refresh],
  );

  return {
    rules,
    tasks,
    loaded,
    actionError,
    refresh,
    setRuleEnabled,
    removeRule,
    saveRule,
    setTaskEnabled,
    removeTask,
    saveTask,
  };
}
