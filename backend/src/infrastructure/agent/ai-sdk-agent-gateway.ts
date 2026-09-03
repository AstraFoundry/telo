import { generateText, isStepCount, streamText, tool } from "ai";
import { z } from "zod";

import { agentRequestOmitsTemperature } from "../../../../contracts/src/ipc";
import type { AgentGateway, AgentOutput } from "../../domain/agent/agent-ports";

import { agentConfigurationHasCredential } from "../../domain/agent/agent-configuration";

import { createAgentLanguageModel } from "./ai-sdk-language-model";

export class AiSdkAgentGateway implements AgentGateway {
  async *stream(
    input: Parameters<AgentGateway["stream"]>[0],
  ): AsyncIterable<AgentOutput> {
    const configuration = input.configuration.snapshot();
    if (!agentConfigurationHasCredential(configuration)) {
      yield { type: "error", message: "Connect a provider in Agent settings." };
      return;
    }

    const model = createAgentLanguageModel(configuration);
    const workspace = input.context;
    const tools = {
      inspectWorkspace: tool({
        description:
          "Read the currently visible Telo workspace and registered frontend components.",
        inputSchema: z.object({
          section: z.enum([
            "active-chat",
            "messages",
            "chats",
            "components",
            "all",
          ]),
        }),
        execute: async ({ section }) =>
          selectWorkspaceSection(workspace, section),
      }),
    };

    yield { type: "activity", label: "Reading workspace" };
    try {
      // Only the newest `historyLimit` turns are replayed; a limit of 0 sends
      // the prompt alone.
      const history =
        configuration.historyLimit > 0
          ? input.history.slice(-configuration.historyLimit)
          : [];
      const result = streamText({
        model,
        instructions: configuration.instructions,
        // Kimi K2.5+ rejects any temperature other than the mode-fixed
        // value. Omit the field (AI SDK temperature is optional) so the
        // server applies 1.0 for thinking / 0.6 for instant.
        ...(agentRequestOmitsTemperature(
          configuration.provider,
          configuration.model,
        )
          ? {}
          : { temperature: configuration.temperature }),
        messages: [
          ...history.map((message) => ({
            role: message.role,
            content: message.body,
          })),
          { role: "user" as const, content: input.prompt },
        ],
        ...(configuration.canInspectWorkspace ? { tools } : {}),
        stopWhen: isStepCount(configuration.maxSteps),
      });
      // AI SDK v7's textStream swallows provider errors; the full stream
      // surfaces them as error parts.
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          yield { type: "text", delta: part.text };
        } else if (part.type === "error") {
          yield { type: "error", message: safeErrorMessage(part.error) };
          return;
        }
      }
    } catch (error) {
      yield { type: "error", message: safeErrorMessage(error) };
    }
  }

  async suggest(
    input: Parameters<AgentGateway["suggest"]>[0],
  ): Promise<ReadonlyArray<string>> {
    const configuration = input.configuration.snapshot();
    if (!agentConfigurationHasCredential(configuration)) return [];
    try {
      const result = await generateText({
        model: createAgentLanguageModel(configuration),
        instructions: SUGGESTION_INSTRUCTIONS,
        messages: [
          { role: "user", content: input.prompt },
          { role: "assistant", content: input.reply },
          {
            role: "user",
            content: `Propose up to ${input.limit} follow-up questions I might ask next.`,
          },
        ],
      });
      return parseSuggestions(result.text, input.limit);
    } catch (error) {
      // Suggestions decorate a reply that already landed; the failure is
      // logged for the operator and the composer simply shows no pills.
      console.error("Agent suggestions failed", safeErrorMessage(error));
      return [];
    }
  }
}

const SUGGESTION_INSTRUCTIONS = [
  "You write follow-up prompts for a chat assistant inside a Telegram client.",
  "Answer with a JSON array of short strings only: each a question or request the user could send next, under 40 characters, in the language of the conversation, no numbering, no explanations.",
].join(" ");

const SUGGESTION_MAX_LENGTH = 60;

/**
 * Reads the model's JSON array leniently: a fenced block or stray prose
 * around the array is tolerated, anything that is not a list of strings
 * yields no suggestions rather than half-parsed pills.
 */
export function parseSuggestions(
  text: string,
  limit: number,
): ReadonlyArray<string> {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const items: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.replace(/\s+/g, " ").trim();
    if (!trimmed || trimmed.length > SUGGESTION_MAX_LENGTH) continue;
    if (items.includes(trimmed)) continue;
    items.push(trimmed);
    if (items.length === limit) break;
  }
  return items;
}

function selectWorkspaceSection(
  workspace: Parameters<AgentGateway["stream"]>[0]["context"],
  section: "active-chat" | "messages" | "chats" | "components" | "all",
): unknown {
  if (section === "active-chat") return workspace.activeChat;
  if (section === "messages") return workspace.visibleMessages;
  if (section === "chats") return workspace.visibleChats;
  if (section === "components") return workspace.components;
  return workspace;
}

const AUTHENTICATION_MESSAGE =
  "The provider rejected the credentials. Check Agent settings.";
const NETWORK_MESSAGE =
  "The provider could not be reached. Check the network connection.";
const GENERIC_MESSAGE = "The agent request failed.";

// Provider error payloads embed key material and bare endpoint URLs, so the
// raw message never leaves the main process; errors are classified instead.
const AUTHENTICATION_PATTERN = /api key|unauthorized|authentication|forbidden/i;
const NETWORK_PATTERN =
  /fetch failed|network|econnrefused|econnreset|enotfound|etimedout|socket hang up/i;

function statusCodeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : null;
}

function safeErrorMessage(error: unknown): string {
  const statusCode = statusCodeOf(error);
  if (statusCode === 401 || statusCode === 403) return AUTHENTICATION_MESSAGE;
  const message = error instanceof Error ? error.message : "";
  if (AUTHENTICATION_PATTERN.test(message)) return AUTHENTICATION_MESSAGE;
  if (NETWORK_PATTERN.test(message)) return NETWORK_MESSAGE;
  return GENERIC_MESSAGE;
}
