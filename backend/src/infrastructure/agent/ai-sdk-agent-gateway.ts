import { createOpenAI } from "@ai-sdk/openai";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";

import type { AgentGateway, AgentOutput } from "../../domain/agent/agent-ports";

export class AiSdkAgentGateway implements AgentGateway {
  async *stream(
    input: Parameters<AgentGateway["stream"]>[0],
  ): AsyncIterable<AgentOutput> {
    const configuration = input.configuration.snapshot();
    if (!configuration.apiKey) {
      yield { type: "error", message: "Add an API key in Agent settings." };
      return;
    }

    const provider = createOpenAI({
      apiKey: configuration.apiKey,
      baseURL: configuration.baseUrl ?? undefined,
    });
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
      const result = streamText({
        model: provider(configuration.model),
        instructions: configuration.instructions,
        messages: [
          ...input.history.map((message) => ({
            role: message.role,
            content: message.body,
          })),
          { role: "user" as const, content: input.prompt },
        ],
        ...(configuration.canInspectWorkspace ? { tools } : {}),
        stopWhen: isStepCount(4),
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
  "The provider rejected the API key. Check Agent settings.";
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
