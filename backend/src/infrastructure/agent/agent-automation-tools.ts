import { tool } from "ai";
import { z } from "zod";

import type {
  AgentScheduledTaskDto,
  SaveScheduledTaskInput,
  SaveTriggerRuleInput,
} from "../../../../contracts/src/ipc";
import type { AgentScheduledTask } from "../../domain/agent/agent-scheduled-task";
import type { AgentTriggerRule } from "../../domain/agent/agent-trigger-rule";

/**
 * Structural view of the application's AgentAutomationService that these
 * tools need. Declared here instead of importing the service so the
 * infrastructure layer depends on the narrowest surface; the service
 * satisfies this shape.
 */
export interface AgentAutomationToolsDeps {
  listRules(): Promise<ReadonlyArray<AgentTriggerRule>>;
  saveRule(
    input: SaveTriggerRuleInput,
    createdBy: "user" | "agent",
  ): Promise<AgentTriggerRule>;
  removeRule(ruleId: string): Promise<void>;
  setRuleEnabled(ruleId: string, enabled: boolean): Promise<AgentTriggerRule>;
  listTasks(): Promise<ReadonlyArray<AgentScheduledTask>>;
  saveTask(
    input: SaveScheduledTaskInput,
    createdBy: "user" | "agent",
  ): Promise<AgentScheduledTask>;
  removeTask(taskId: string): Promise<void>;
  setTaskEnabled(taskId: string, enabled: boolean): Promise<AgentScheduledTask>;
}

function taskDto(task: AgentScheduledTask): AgentScheduledTaskDto {
  return {
    ...task.snapshot(),
    nextRunAt: task.nextRunAt()?.toISOString() ?? null,
  };
}

const matchSchema = z
  .object({
    chatIds: z
      .array(z.string())
      .optional()
      .describe("Only fire in these chat ids."),
    senderIds: z
      .array(z.string())
      .optional()
      .describe("Only fire for these sender ids."),
    keywords: z
      .array(z.string())
      .optional()
      .describe("Fire when any keyword appears in the body (OR)."),
    pattern: z
      .string()
      .nullable()
      .optional()
      .describe("JavaScript regular expression tested against the body."),
    excludeMuted: z
      .boolean()
      .optional()
      .describe("When true, muted chats never fire the rule."),
  })
  .optional()
  .describe(
    "Match dimensions combine with AND; at least one dimension is required on create.",
  );

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cron"),
    expression: z
      .string()
      .describe('Five-field cron expression in local time, e.g. "0 9 * * *".'),
  }),
  z.object({
    kind: z.literal("once"),
    runAt: z.string().describe("ISO timestamp of the single run."),
  }),
]);

const contextSchema = z
  .object({
    scope: z.enum(["unread", "folder"]),
    chatId: z
      .string()
      .optional()
      .describe('Chat for "unread" scope; defaults to the delivery chat.'),
    folderId: z
      .number()
      .int()
      .optional()
      .describe('Folder for "folder" scope; omitted means the main list.'),
  })
  .nullable()
  .optional();

function requireField(value: string | undefined, field: string): string {
  if (!value?.trim()) {
    throw new Error(`Automation tool call needs ${field}`);
  }
  return value;
}

/**
 * Management tools over the agent automation subsystem. Everything the
 * model configures here is authored as createdBy "agent" and takes effect
 * immediately; destructive actions (remove) and auto-send delivery stay
 * available but visible in the automation panel and audit trail.
 */
export function createAgentAutomationTools(
  automation: AgentAutomationToolsDeps,
) {
  return {
    configureTriggerRule: tool({
      description: [
        "Manage trigger rules that start an agent run on incoming Telegram messages.",
        "Rules take effect immediately and never fire on the account's own outgoing messages.",
        "Match dimensions combine with AND; several keywords are OR within the dimension; pattern is a JavaScript regex.",
        "Delivery defaults to draft-only (a draft is prepared, nothing is sent) unless set to auto-send.",
      ].join(" "),
      inputSchema: z.object({
        action: z.enum(["list", "create", "update", "set-enabled", "remove"]),
        ruleId: z
          .string()
          .optional()
          .describe("Required for update, set-enabled, and remove."),
        name: z.string().optional().describe("Required for create."),
        match: matchSchema,
        delivery: z
          .enum(["auto-send", "draft-only"])
          .optional()
          .describe("Defaults to draft-only on create."),
        promptTemplate: z
          .string()
          .optional()
          .describe(
            "Instruction of the triggered run; the matched message is attached as context. Required for create.",
          ),
        enabled: z.boolean().optional().describe("Required for set-enabled."),
      }),
      execute: async ({
        action,
        ruleId,
        name,
        match,
        delivery,
        promptTemplate,
        enabled,
      }) => {
        if (action === "list") {
          return (await automation.listRules()).map((rule) => rule.snapshot());
        }
        if (action === "create") {
          const rule = await automation.saveRule(
            {
              name: requireField(name, "a name"),
              match: match ?? {},
              delivery,
              promptTemplate: requireField(promptTemplate, "a promptTemplate"),
            },
            "agent",
          );
          return rule.snapshot();
        }
        if (!ruleId) {
          throw new Error(`configureTriggerRule ${action} needs a ruleId`);
        }
        if (action === "remove") {
          await automation.removeRule(ruleId);
          return { removed: ruleId };
        }
        if (action === "set-enabled") {
          if (enabled === undefined) {
            throw new Error("configureTriggerRule set-enabled needs enabled");
          }
          return (await automation.setRuleEnabled(ruleId, enabled)).snapshot();
        }
        const existing = (await automation.listRules()).find(
          (rule) => rule.ruleId === ruleId,
        );
        if (!existing) {
          throw new Error(`Unknown trigger rule: ${ruleId}`);
        }
        const current = existing.snapshot();
        const rule = await automation.saveRule(
          {
            ruleId,
            name: name ?? current.name,
            match: match ?? current.match,
            delivery: delivery ?? current.delivery,
            promptTemplate: promptTemplate ?? current.promptTemplate,
          },
          current.createdBy,
        );
        return rule.snapshot();
      },
    }),

    configureScheduledTask: tool({
      description: [
        "Manage scheduled tasks that start an agent run on a timer and deliver the result to a chat.",
        "The schedule is either a five-field cron expression in local time (recurring) or a single future ISO timestamp (once).",
        "Every task needs the chatId its result is delivered to; delivery defaults to draft-only unless set to auto-send.",
        "The optional context scope attaches unread messages of a chat or the chats of a folder to the run.",
      ].join(" "),
      inputSchema: z.object({
        action: z.enum(["list", "create", "update", "set-enabled", "remove"]),
        taskId: z
          .string()
          .optional()
          .describe("Required for update, set-enabled, and remove."),
        name: z.string().optional().describe("Required for create."),
        schedule: scheduleSchema.optional().describe("Required for create."),
        delivery: z
          .enum(["auto-send", "draft-only"])
          .optional()
          .describe("Defaults to draft-only on create."),
        promptTemplate: z
          .string()
          .optional()
          .describe("Instruction of the scheduled run. Required for create."),
        chatId: z
          .string()
          .optional()
          .describe(
            "Chat the run's result is delivered to. Required for create.",
          ),
        context: contextSchema.describe(
          "Optional scoped payload for the run; null clears it on update.",
        ),
        enabled: z.boolean().optional().describe("Required for set-enabled."),
      }),
      execute: async ({
        action,
        taskId,
        name,
        schedule,
        delivery,
        promptTemplate,
        chatId,
        context,
        enabled,
      }) => {
        if (action === "list") {
          return (await automation.listTasks()).map(taskDto);
        }
        if (action === "create") {
          if (!schedule) {
            throw new Error("configureScheduledTask create needs a schedule");
          }
          const task = await automation.saveTask(
            {
              name: requireField(name, "a name"),
              schedule,
              delivery,
              promptTemplate: requireField(promptTemplate, "a promptTemplate"),
              chatId: requireField(chatId, "a chatId"),
              context: context ?? null,
            },
            "agent",
          );
          return taskDto(task);
        }
        if (!taskId) {
          throw new Error(`configureScheduledTask ${action} needs a taskId`);
        }
        if (action === "remove") {
          await automation.removeTask(taskId);
          return { removed: taskId };
        }
        if (action === "set-enabled") {
          if (enabled === undefined) {
            throw new Error("configureScheduledTask set-enabled needs enabled");
          }
          return taskDto(await automation.setTaskEnabled(taskId, enabled));
        }
        const existing = (await automation.listTasks()).find(
          (task) => task.taskId === taskId,
        );
        if (!existing) {
          throw new Error(`Unknown scheduled task: ${taskId}`);
        }
        const current = existing.snapshot();
        const task = await automation.saveTask(
          {
            taskId,
            name: name ?? current.name,
            schedule: schedule ?? current.schedule,
            delivery: delivery ?? current.delivery,
            promptTemplate: promptTemplate ?? current.promptTemplate,
            chatId: chatId ?? current.chatId,
            context: context === undefined ? current.context : context,
          },
          current.createdBy,
        );
        return taskDto(task);
      },
    }),
  };
}
