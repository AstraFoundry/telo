import { ArrowLeft } from "@phosphor-icons/react";
import { motion, useReducedMotionConfig } from "motion/react";
import { useState } from "react";

import { AgentConfigurationForm } from "features/configure-agent";
import { AgentAutomationSettings } from "features/manage-agent-automation";
import { KeywordFoldersSettings } from "features/manage-keyword-folders";
import { copy } from "shared/config/copy";
import { Button, EASE_OUT, Tooltip, WindowControls } from "shared/ui";

import { AccountSection } from "./sections/account-section";
import { AppearanceSection } from "./sections/appearance-section";
import { ChatSection } from "./sections/chat-section";
import { NotificationsSection } from "./sections/notifications-section";
import { StorageSection } from "./sections/storage-section";
import {
  SECTION_TITLES,
  SettingsNav,
  type SettingsSectionId,
} from "./settings-nav";

interface SettingsPageProps {
  onBack(): void;
  onLoggedOut?(): void;
  /** Pane to open on, for callers that link to one setting in particular. */
  initialSection?: SettingsSectionId;
  /**
   * Narrow workspace only: the chat list (and its window controls) is hidden,
   * so close/min/max move into this header. Wide layout keeps them in the
   * sidebar — putting them here would paint Close in the centre column.
   */
  includeWindowControls?: boolean;
}

export function SettingsPage({
  onBack,
  onLoggedOut,
  initialSection = "account",
  includeWindowControls = false,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const [query, setQuery] = useState("");
  const reduceMotion = useReducedMotionConfig() ?? false;

  return (
    // The shell hands each surface a grid cell that clips its overflow, so the
    // column has to bound its own height or the settings body is cut off with
    // no way to reach the bottom.
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="window-titlebar-safe-trailing flex h-14 shrink-0 items-center gap-2 pl-3 [app-region:drag]">
        {includeWindowControls ? <WindowControls /> : null}
        <Tooltip content={copy.backToConversation}>
          <Button
            size="icon"
            variant="ghost"
            aria-label={copy.backToConversation}
            onClick={onBack}
            className="[app-region:no-drag]"
          >
            <ArrowLeft />
          </Button>
        </Tooltip>
        {/* deslop-ignore-next-line 12 — compact toolbar title is an app chrome convention */}
        <h1 className="text-base font-semibold text-balance">
          {copy.settings}
        </h1>
      </header>

      <div className="flex min-h-0 flex-1">
        <SettingsNav
          active={section}
          query={query}
          onQueryChange={setQuery}
          onSelect={setSection}
        />
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {/* Content is left-aligned inside a measure rather than centred in
              the column: a centred block moves under the eye every time the
              window is resized. */}
          <div className="w-full max-w-2xl px-6 py-6">
            {/* Swapping panes is the one place this surface animates: the
                content would otherwise teleport. Only the arriving pane
                animates - sequencing an exit first would put 140ms of dead
                time in front of every section switch. Reduced motion keeps
                the fade and drops the travel. */}
            <motion.section
              key={section}
              aria-labelledby="settings-section-title"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.14, ease: EASE_OUT }}
              className="flex flex-col gap-6"
            >
              <h2
                id="settings-section-title"
                className="text-xl font-semibold text-balance"
              >
                {SECTION_TITLES[section]}
              </h2>
              {section === "account" ? (
                <AccountSection onLoggedOut={onLoggedOut} />
              ) : null}
              {section === "appearance" ? <AppearanceSection /> : null}
              {section === "chat" ? <ChatSection /> : null}
              {section === "notifications" ? <NotificationsSection /> : null}
              {section === "folders" ? <KeywordFoldersSettings /> : null}
              {section === "agent" ? (
                <>
                  <AgentConfigurationForm />
                  <AgentAutomationSettings />
                </>
              ) : null}
              {section === "storage" ? <StorageSection /> : null}
            </motion.section>
          </div>
        </div>
      </div>
    </main>
  );
}
