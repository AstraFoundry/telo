import { useEffect, useState } from "react";

import { subscribeToAgentEvents, useAgentStore } from "entities/agent";
import { subscribeToWorkspaceEvents, useChatStore } from "entities/chat";
import { useTelegramStore } from "entities/telegram";
import { GlobalSearchPalette } from "features/chat-search";
import { OnboardingPage } from "pages/onboarding";
import { SettingsPage } from "pages/settings";
import { WorkspacePage } from "pages/workspace";
import { ConversationView } from "widgets/conversation-view";

export function App() {
  const load = useChatStore((state) => state.load);
  const connectionState = useChatStore((state) => state.connectionState);
  const auth = useTelegramStore((state) => state.auth);
  const currentUser = useTelegramStore((state) => state.currentUser);
  const loadCurrentUser = useTelegramStore((state) => state.loadCurrentUser);
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
    demo === true ||
    auth?.status === "ready" ||
    auth?.status === "restoring";
  const workspaceReady = demo === true || auth?.status === "ready";

  const openSettings = () => {
    closeAgent();
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
      void Promise.all([load(), loadCurrentUser()]);
    } else {
      void load();
    }
    const unsubscribeWorkspace = subscribeToWorkspaceEvents();
    const unsubscribeNotificationClick =
      window.telo.shell.onNotificationClick((chatId) => {
        useChatStore.getState().select(chatId);
        setSurface("conversation");
      });
    return () => {
      unsubscribeWorkspace();
      unsubscribeNotificationClick();
    };
  }, [load, loadCurrentUser, workspaceEnabled, demo, auth?.status]);

  // The initial loadCurrentUser() call can lose a transient race against
  // Telegram's own connection setup (a real getMe() RPC, unlike the local
  // preference/config reads the other loaders make). Retrying on every
  // reconnect is the same self-healing the chat store already gets from
  // Teleproto's catchUp(), so the account row never stays empty forever.
  useEffect(() => {
    if (workspaceReady && connectionState === "connected" && !currentUser) {
      void loadCurrentUser();
    }
  }, [workspaceReady, connectionState, currentUser, loadCurrentUser]);

  if (!workspaceEnabled) {
    return <OnboardingPage />;
  }

  return (
    <>
      <WorkspacePage
        onOpenSettings={openSettings}
        onSelectChat={() => setSurface("conversation")}
        showBackToChats={surface === "conversation"}
      >
        {surface === "settings" ? (
          <SettingsPage
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
