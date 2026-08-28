import { useEffect, useState } from "react";

import { subscribeToAgentEvents, useAgentStore } from "entities/agent";
import { useChatStore } from "entities/chat";
import { useTelegramStore } from "entities/telegram";
import { OnboardingPage } from "pages/onboarding";
import { SettingsPage } from "pages/settings";
import { WorkspacePage } from "pages/workspace";
import { ConversationView } from "widgets/conversation-view";

export function App() {
  const load = useChatStore((state) => state.load);
  const auth = useTelegramStore((state) => state.auth);
  const configuration = useTelegramStore((state) => state.configuration);
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
  const workspaceEnabled = demo === true || auth?.status === "ready";

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
    if (workspaceEnabled) {
      void Promise.all([load(), loadCurrentUser()]);
    }
  }, [load, loadCurrentUser, workspaceEnabled]);

  if (!workspaceEnabled) {
    return (
      <OnboardingPage
        loading={
          demo === null ||
          !auth ||
          !configuration ||
          auth.status === "connecting"
        }
        onUseDemo={() => {
          setDemo(true);
          void window.telo.preferences.update({ demoWorkspace: true });
        }}
      />
    );
  }

  return (
    <WorkspacePage
      onOpenSettings={openSettings}
      onSelectChat={() => setSurface("conversation")}
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
  );
}
