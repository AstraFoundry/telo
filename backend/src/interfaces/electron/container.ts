import path from "node:path";

import { app, safeStorage, shell } from "electron";

import { RunAgentService } from "../../application/agent/run-agent";
import { AgentContextService } from "../../application/agent/agent-context";
import { AgentAuditService } from "../../application/agent/agent-audit";
import { RunChatExtractionService } from "../../application/agent/run-chat-extraction";
import { RunChatSummaryService } from "../../application/agent/run-chat-summary";
import { RunMessageActionService } from "../../application/agent/run-message-action";
import { AgentThreadService } from "../../application/agent/agent-threads";
import { ListAgentModelsService } from "../../application/agent/list-agent-models";
import { SaveAgentConfigurationService } from "../../application/agent/save-agent-configuration";
import { RefreshingAgentConfigurationRepository } from "../../application/agent/refresh-agent-oauth";
import { UpdateUserPreferencesService } from "../../application/preferences/update-user-preferences";
import { KeywordFolderService } from "../../application/keyword-folder/keyword-folders";
import { ChatActionsService } from "../../application/telegram/chat-actions";
import { MessageActionsService } from "../../application/telegram/message-actions";
import { TelegramLogoutService } from "../../application/telegram/telegram-logout";
import { TelegramWorkspaceService } from "../../application/telegram/telegram-workspace";
import { AiSdkAgentGateway } from "../../infrastructure/agent/ai-sdk-agent-gateway";
import { DemoAgentGateway } from "../../infrastructure/agent/demo-agent-gateway";
import { FileAgentConfigurationRepository } from "../../infrastructure/agent/file-agent-configuration-repository";
import { FixtureAgentModelCatalog } from "../../infrastructure/agent/fixture-agent-model-catalog";
import { FixtureAgentOAuthClient } from "../../infrastructure/agent/fixture-agent-oauth-client";
import { HttpAgentModelCatalog } from "../../infrastructure/agent/http-agent-model-catalog";
import {
  loadOrCreateKimiDeviceId,
  kimiDeviceHeaders,
} from "../../infrastructure/agent/kimi-device";
import { VendorOAuthClient } from "../../infrastructure/agent/vendor-oauth-client";
import { FileAgentAuditRepository } from "../../infrastructure/agent/file-agent-audit-repository";
import { FileAgentThreadRepository } from "../../infrastructure/agent/file-agent-thread-repository";
import { FileUserPreferencesRepository } from "../../infrastructure/preferences/file-user-preferences-repository";
import { FileKeywordFolderRepository } from "../../infrastructure/keyword-folder/file-keyword-folder-repository";
import { DemoKeywordFolderRepository } from "../../infrastructure/keyword-folder/demo-keyword-folder-repository";
import { FileTelegramSessionRepository } from "../../infrastructure/telegram/file-telegram-session-repository";
import { FileTelegramConnectionProfileRepository } from "../../infrastructure/telegram/file-telegram-connection-profile-repository";
import { FileTelegramDialogSnapshotRepository } from "../../infrastructure/telegram/file-telegram-dialog-snapshot-repository";
import { FileTelegramAccountRegistry } from "../../infrastructure/telegram/file-telegram-account-registry";
import { TelegramAccountCoordinator } from "../../infrastructure/telegram/telegram-account-coordinator";
import { TelegramClientCoordinator } from "../../infrastructure/telegram/teleproto-telegram-repository";
import {
  clearMediaCache,
  mediaCacheUsageBytes,
} from "../../infrastructure/telegram/media-cache";
import type { MediaCacheStore } from "../../domain/storage/storage-ports";
import type { TelegramAuthState } from "../../../../contracts/src/ipc";

export interface ApplicationContainer {
  readonly workspace: TelegramWorkspaceService;
  readonly chatActions: ChatActionsService;
  readonly messageActions: MessageActionsService;
  readonly agentConfiguration: SaveAgentConfigurationService;
  readonly listAgentModels: ListAgentModelsService;
  readonly runAgent: RunAgentService;
  readonly agentContext: AgentContextService;
  readonly agentAudit: AgentAuditService;
  readonly runChatSummary: RunChatSummaryService;
  readonly runChatExtraction: RunChatExtractionService;
  readonly runMessageAction: RunMessageActionService;
  readonly agentThreads: AgentThreadService;
  readonly telegram: TelegramAccountCoordinator;
  readonly telegramLogout: TelegramLogoutService;
  readonly preferences: UpdateUserPreferencesService;
  readonly mediaCacheStorage: MediaCacheStore;
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
  const oauthClient =
    process.env.TELO_E2E === "1"
      ? new FixtureAgentOAuthClient()
      : new VendorOAuthClient({
          clientIds: {
            google: process.env.TELO_GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
            openai: process.env.TELO_OPENAI_OAUTH_CLIENT_ID?.trim() ?? "",
            anthropic: process.env.TELO_ANTHROPIC_OAUTH_CLIENT_ID?.trim() ?? "",
            xai: process.env.TELO_XAI_OAUTH_CLIENT_ID?.trim() ?? "",
            kimi: process.env.TELO_KIMI_OAUTH_CLIENT_ID?.trim() ?? "",
          },
          openExternal: (url) => shell.openExternal(url).then(() => undefined),
          kimiHeaders: kimiDeviceHeaders({
            deviceId: loadOrCreateKimiDeviceId(
              path.join(dataDirectory, "kimi-device-id"),
            ),
            appVersion: app.getVersion(),
          }),
        });
  const liveConfigurations = new RefreshingAgentConfigurationRepository(
    configurations,
    oauthClient,
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
  const mediaCacheDirectory = path.join(dataDirectory, "media-cache");
  // Multi-account, tdesktop-style: every signed-in account owns a session,
  // profile, dialog snapshot, and media-cache directory keyed by its
  // registry id; the account coordinator attaches the active one. The
  // legacy single files stay named in legacyPaths so first boot can adopt
  // them into the initial account instead of logging the user out.
  const accountPaths = (accountId: string) => ({
    session: path.join(dataDirectory, `telegram-${accountId}.session`),
    profile: path.join(dataDirectory, `telegram-${accountId}.profile`),
    snapshot: path.join(dataDirectory, `dialogs-${accountId}.json`),
    mediaCacheDirectory: path.join(mediaCacheDirectory, accountId),
  });
  const telegram = new TelegramAccountCoordinator({
    registry: new FileTelegramAccountRegistry(
      path.join(dataDirectory, "accounts.json"),
    ),
    paths: accountPaths,
    legacyPaths: {
      session: path.join(dataDirectory, "telegram.session"),
      profile: path.join(dataDirectory, "telegram.profile"),
      snapshot: path.join(dataDirectory, "dialogs.json"),
    },
    createCoordinator: (accountId, onAccountState) => {
      const paths = accountPaths(accountId);
      return new TelegramClientCoordinator(
        new FileTelegramSessionRepository(paths.session, encrypt, decrypt),
        new FileTelegramConnectionProfileRepository(
          paths.profile,
          encrypt,
          decrypt,
        ),
        applicationCredentials,
        onAccountState,
        paths.mediaCacheDirectory,
        new FileTelegramDialogSnapshotRepository(paths.snapshot),
        // Read per eviction, not captured: raising or lowering the ceiling
        // in settings governs the very next download.
        async () =>
          (await preferences.get()).snapshot().mediaCacheLimitMb * 1024 ** 2,
      );
    },
    onState: onAuthState,
    demoWorkspace: process.env.TELO_DEMO_WORKSPACE === "1",
  });

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
    liveConfigurations,
    gateway,
    threads,
    agentContext,
    audits,
  );

  return {
    workspace: new TelegramWorkspaceService(telegram, keywordFolders),
    chatActions: new ChatActionsService(telegram),
    messageActions: new MessageActionsService(telegram),
    agentConfiguration: new SaveAgentConfigurationService(
      configurations,
      oauthClient,
    ),
    listAgentModels: new ListAgentModelsService(
      liveConfigurations,
      process.env.TELO_E2E === "1"
        ? new FixtureAgentModelCatalog()
        : new HttpAgentModelCatalog(),
    ),
    runAgent,
    agentContext,
    agentAudit: new AgentAuditService(audits),
    runChatSummary: new RunChatSummaryService(runAgent),
    runChatExtraction: new RunChatExtractionService(runAgent),
    runMessageAction: new RunMessageActionService(liveConfigurations, gateway),
    agentThreads: new AgentThreadService(threads),
    telegram,
    telegramLogout: new TelegramLogoutService(telegram),
    preferences: new UpdateUserPreferencesService(preferences),
    mediaCacheStorage: {
      usageBytes: () => mediaCacheUsageBytes(mediaCacheDirectory),
      clear: () => clearMediaCache(mediaCacheDirectory),
    },
  };
}
