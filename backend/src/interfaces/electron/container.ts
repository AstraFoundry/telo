import path from "node:path";

import { app, safeStorage } from "electron";

import { RunAgentService } from "../../application/agent/run-agent";
import { AgentContextService } from "../../application/agent/agent-context";
import { AgentAuditService } from "../../application/agent/agent-audit";
import { RunChatExtractionService } from "../../application/agent/run-chat-extraction";
import { RunChatSummaryService } from "../../application/agent/run-chat-summary";
import { RunMessageActionService } from "../../application/agent/run-message-action";
import { AgentThreadService } from "../../application/agent/agent-threads";
import { SaveAgentConfigurationService } from "../../application/agent/save-agent-configuration";
import { UpdateUserPreferencesService } from "../../application/preferences/update-user-preferences";
import { KeywordFolderService } from "../../application/keyword-folder/keyword-folders";
import { ChatActionsService } from "../../application/telegram/chat-actions";
import { MessageActionsService } from "../../application/telegram/message-actions";
import { TelegramLogoutService } from "../../application/telegram/telegram-logout";
import { TelegramWorkspaceService } from "../../application/telegram/telegram-workspace";
import { AiSdkAgentGateway } from "../../infrastructure/agent/ai-sdk-agent-gateway";
import { DemoAgentGateway } from "../../infrastructure/agent/demo-agent-gateway";
import { FileAgentConfigurationRepository } from "../../infrastructure/agent/file-agent-configuration-repository";
import { FileAgentAuditRepository } from "../../infrastructure/agent/file-agent-audit-repository";
import { FileAgentThreadRepository } from "../../infrastructure/agent/file-agent-thread-repository";
import { FileUserPreferencesRepository } from "../../infrastructure/preferences/file-user-preferences-repository";
import { FileKeywordFolderRepository } from "../../infrastructure/keyword-folder/file-keyword-folder-repository";
import { DemoKeywordFolderRepository } from "../../infrastructure/keyword-folder/demo-keyword-folder-repository";
import { FileTelegramSessionRepository } from "../../infrastructure/telegram/file-telegram-session-repository";
import { FileTelegramConnectionProfileRepository } from "../../infrastructure/telegram/file-telegram-connection-profile-repository";
import { TelegramClientCoordinator } from "../../infrastructure/telegram/teleproto-telegram-repository";
import type { TelegramAuthState } from "../../../../contracts/src/ipc";

export interface ApplicationContainer {
  readonly workspace: TelegramWorkspaceService;
  readonly chatActions: ChatActionsService;
  readonly messageActions: MessageActionsService;
  readonly agentConfiguration: SaveAgentConfigurationService;
  readonly runAgent: RunAgentService;
  readonly agentContext: AgentContextService;
  readonly agentAudit: AgentAuditService;
  readonly runChatSummary: RunChatSummaryService;
  readonly runChatExtraction: RunChatExtractionService;
  readonly runMessageAction: RunMessageActionService;
  readonly agentThreads: AgentThreadService;
  readonly telegram: TelegramClientCoordinator;
  readonly telegramLogout: TelegramLogoutService;
  readonly preferences: UpdateUserPreferencesService;
}

export function createContainer(
  onAuthState: (state: TelegramAuthState) => void,
): ApplicationContainer {
  const dataDirectory = app.getPath("userData");
  // TELO_PLAINTEXT_SECRETS=1 is a local-development/e2e escape hatch:
  // safeStorage has no keychain to back it there, so secrets are stored as
  // plain base64 instead. Never set it for production builds or real accounts.
  const plaintextSecrets = process.env.TELO_PLAINTEXT_SECRETS === "1";
  const encrypt = plaintextSecrets
    ? (value: string) => Buffer.from(value, "utf8").toString("base64")
    : (value: string) => {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error(
            "Secure credential storage is unavailable on this system",
          );
        }
        return safeStorage.encryptString(value).toString("base64");
      };
  const decrypt = plaintextSecrets
    ? (value: string) => Buffer.from(value, "base64").toString("utf8")
    : (value: string) =>
        safeStorage.decryptString(Buffer.from(value, "base64"));
  const configurations = new FileAgentConfigurationRepository(
    path.join(dataDirectory, "agent.json"),
    encrypt,
    decrypt,
  );
  const sessions = new FileTelegramSessionRepository(
    path.join(dataDirectory, "telegram.session"),
    encrypt,
    decrypt,
  );
  const profiles = new FileTelegramConnectionProfileRepository(
    path.join(dataDirectory, "telegram.profile"),
    encrypt,
    decrypt,
  );
  const preferences = new FileUserPreferencesRepository(
    path.join(dataDirectory, "preferences.json"),
  );
  const threads = new FileAgentThreadRepository(
    path.join(dataDirectory, "agent-threads.json"),
  );
  const audits = new FileAgentAuditRepository(
    path.join(dataDirectory, "agent-audit.jsonl"),
  );
  const apiId = Number(process.env.TELO_TELEGRAM_API_ID);
  const apiHash = process.env.TELO_TELEGRAM_API_HASH?.trim();
  const applicationCredentials =
    Number.isInteger(apiId) && apiId > 0 && apiHash ? { apiId, apiHash } : null;
  const telegram = new TelegramClientCoordinator(
    sessions,
    profiles,
    applicationCredentials,
    onAuthState,
    path.join(dataDirectory, "media-cache"),
  );

  // The demo workspace pairs its deterministic Telegram repository with an
  // equally deterministic agent gateway so e2e never touches a provider.
  const gateway =
    process.env.TELO_DEMO_WORKSPACE === "1"
      ? new DemoAgentGateway()
      : new AiSdkAgentGateway();
  const keywordFolders = new KeywordFolderService(
    process.env.TELO_DEMO_WORKSPACE === "1"
      ? new DemoKeywordFolderRepository()
      : new FileKeywordFolderRepository(
          path.join(dataDirectory, "keyword-folders.json"),
        ),
    telegram,
  );
  const agentContext = new AgentContextService(telegram);
  const runAgent = new RunAgentService(
    configurations,
    gateway,
    threads,
    agentContext,
    audits,
  );

  return {
    workspace: new TelegramWorkspaceService(telegram, keywordFolders),
    chatActions: new ChatActionsService(telegram),
    messageActions: new MessageActionsService(telegram),
    agentConfiguration: new SaveAgentConfigurationService(configurations),
    runAgent,
    agentContext,
    agentAudit: new AgentAuditService(audits),
    runChatSummary: new RunChatSummaryService(runAgent),
    runChatExtraction: new RunChatExtractionService(runAgent),
    runMessageAction: new RunMessageActionService(configurations, gateway),
    agentThreads: new AgentThreadService(threads),
    telegram,
    telegramLogout: new TelegramLogoutService(telegram),
    preferences: new UpdateUserPreferencesService(preferences),
  };
}
