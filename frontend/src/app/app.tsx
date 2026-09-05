import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeToAgentEvents, useAgentStore } from "entities/agent";
import { subscribeToWorkspaceEvents, useChatStore } from "entities/chat";
import { useTelegramStore } from "entities/telegram";
import { GlobalSearchPalette } from "features/chat-search";
import { OnboardingPage } from "pages/onboarding";
import { SettingsPage, type SettingsSectionId } from "pages/settings";
import { WorkspacePage } from "pages/workspace";
import { ConversationView } from "widgets/conversation-view";

import { useChatPreferenceSync } from "./chat-preference-sync";
import { MotionPreferences } from "./motion-preferences";
import { useTeloLinks } from "./telo-links";

export function App() {
  return (
    <MotionPreferences>
      <AppSurfaces />
    </MotionPreferences>
  );
}

function AppSurfaces() {
  useChatPreferenceSync();
  const load = useChatStore((state) => state.load);
  const connectionState = useChatStore((state) => state.connectionState);
  const auth = useTelegramStore((state) => state.auth);
  const currentUser = useTelegramStore((state) => state.currentUser);
  const loadCurrentUser = useTelegramStore((state) => state.loadCurrentUser);
  const loadAccounts = useTelegramStore((state) => state.loadAccounts);
  const addingAccount = useTelegramStore((state) => state.addingAccount);
  const cancelAddingAccount = useTelegramStore(
    (state) => state.cancelAddingAccount,
  );
  const startTelegram = useTelegramStore((state) => state.start);
  const closeAgent = useAgentStore((state) => state.close);
  const loadAgentPanel = useAgentStore((state) => state.loadPanelState);
  const loadAgentConfiguration = useAgentStore(
    (state) => state.loadConfiguration,
  );
  const [demo, setDemo] = useState<boolean | null>(null);
  const [surface, setSurface] = useState<"conversation" | "settings">(
    "conversation",
  );
  const workspaceEnabled =
    demo === true || auth?.status === "ready" || auth?.status === "restoring";
  const workspaceReady = demo === true || auth?.status === "ready";

  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("account");
  const showConversation = useCallback(() => setSurface("conversation"), []);
  useTeloLinks(showConversation);

  const openSettings = (section: SettingsSectionId = "account") => {
    closeAgent();
    setSettingsSection(section);
    setSurface("settings");
  };

  useEffect(() => {
    void loadAgentPanel();
    void loadAgentConfiguration();
    void window.telo.preferences
      .get()
      .then((preferences) => setDemo(preferences.demoWorkspace));
  }, [loadAgentConfiguration, loadAgentPanel]);

  useEffect(() => {
    const unsubscribeAgent = subscribeToAgentEvents();
    const unsubscribeTelegram = startTelegram();
    return () => {
      unsubscribeAgent();
      unsubscribeTelegram();
    };
  }, [startTelegram]);

  useEffect(() => {
    if (auth?.status === "restoring") {
      useChatStore.setState({
        connectionState: "synchronizing",
        loading: true,
      });
    }
  }, [auth?.status]);

  useEffect(() => {
    if (!workspaceEnabled) return undefined;
    if (demo === true || auth?.status === "ready") {
      // A fresh "ready" can mean the active account just changed — a switch
      // or a completed add-account login — so the account list reloads
      // together with the workspace rather than waiting for a remount.
      void Promise.all([load(), loadCurrentUser(), loadAccounts()]);
    } else {
      // The restoring surface can paint the persisted dialog snapshot, but
      // there is no persisted message repository. Wait for the live adapter
      // before requesting the selected chat's transcript.
      void load({ includeMessages: false });
    }
    const unsubscribeWorkspace = subscribeToWorkspaceEvents();
    const unsubscribeNotificationClick = window.telo.shell.onNotificationClick(
      (chatId) => {
        useChatStore.getState().select(chatId);
        setSurface("conversation");
      },
    );
    return () => {
      unsubscribeWorkspace();
      unsubscribeNotificationClick();
    };
  }, [
    load,
    loadCurrentUser,
    loadAccounts,
    workspaceEnabled,
    demo,
    auth?.status,
  ]);

  // `addingAccount` is set while auth is already "ready", so keying the
  // clear on the status value would cancel the flow the moment it opens.
  // Only a *transition* into "ready" — the new account's login completing —
  // ends it and hands the workspace back.
  const previousAuthStatus = useRef(auth?.status);
  useEffect(() => {
    const previous = previousAuthStatus.current;
    previousAuthStatus.current = auth?.status;
    if (addingAccount && previous !== "ready" && auth?.status === "ready") {
      cancelAddingAccount();
    }
  }, [addingAccount, auth?.status, cancelAddingAccount]);

  // The initial loadCurrentUser() call can lose a transient race against
  // Telegram's own connection setup (a real getMe() RPC, unlike the local
  // preference/config reads the other loaders make). Retrying on every
  // reconnect is the same self-healing the chat store already gets from
  // live `updateConnectionState` events, so the account row never stays empty forever.
  useEffect(() => {
    if (workspaceReady && connectionState === "connected" && !currentUser) {
      void loadCurrentUser();
    }
  }, [workspaceReady, connectionState, currentUser, loadCurrentUser]);

  if (!workspaceEnabled || addingAccount) {
    return <OnboardingPage />;
  }

  return (
    <>
      <WorkspacePage
        onOpenSettings={() => openSettings()}
        onOpenAgentSettings={() => openSettings("agent")}
        onSelectChat={() => setSurface("conversation")}
        showBackToChats={surface === "conversation"}
      >
        {surface === "settings" ? (
          <SettingsPage
            initialSection={settingsSection}
            onBack={() => setSurface("conversation")}
            onLoggedOut={() => {
              setDemo(false);
              setSurface("conversation");
            }}
          />
        ) : (
          <ConversationView />
        )}
      </WorkspacePage>
      <GlobalSearchPalette />
    </>
  );
}
