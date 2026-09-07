import { ArrowLeft, PaperPlaneTilt } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useState } from "react";

import { useTelegramStore } from "entities/telegram";
import {
  ConnectionStepContent,
  useConnectionForm,
} from "features/connect-telegram";
import { AgentConfigurationForm } from "features/configure-agent";
import { copy } from "shared/config/copy";
import {
  Button,
  EASE_OUT,
  StatefulButton,
  TextReveal,
  WindowControls,
} from "shared/ui";

type ShellStep = "welcome" | "auth";

const STEP_ORDER: Record<string, number> = {
  welcome: 0,
  phone: 1,
  code: 2,
  password: 3,
  ready: 4,
  "credentials-missing": 4,
  agent: 5,
};

export function OnboardingPage() {
  const [shellStep, setShellStep] = useState<ShellStep>("welcome");
  const addingAccount = useTelegramStore((state) => state.addingAccount);
  const agentSetupPending = useTelegramStore(
    (state) => state.agentSetupPending,
  );
  const completeAgentSetup = useTelegramStore(
    (state) => state.completeAgentSetup,
  );
  const cancelAddingAccount = useTelegramStore(
    (state) => state.cancelAddingAccount,
  );
  const form = useConnectionForm();
  const showAgentSetup = !addingAccount && agentSetupPending && form.ready;
  const viewId = showAgentSetup
    ? "agent"
    : shellStep === "welcome"
      ? "welcome"
      : form.viewId;
  const [prevViewId, setPrevViewId] = useState(viewId);
  const [direction, setDirection] = useState<1 | -1>(1);
  const reduce = useReducedMotionConfig();

  if (viewId !== prevViewId) {
    const prevIndex = STEP_ORDER[prevViewId] ?? 0;
    const nextIndex = STEP_ORDER[viewId] ?? 0;
    setDirection(nextIndex >= prevIndex ? 1 : -1);
    setPrevViewId(viewId);
  }

  const enterX = reduce ? 0 : direction * 48;
  const exitX = reduce ? 0 : direction * -48;

  const goToAuth = () => setShellStep("auth");
  const goToWelcome = () => setShellStep("welcome");

  const handleBack = () => {
    if (form.step === "phone") {
      goToWelcome();
    } else {
      form.editPhone();
    }
  };

  return (
    <>
      <a
        className="window-titlebar-safe-skip-link sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm"
        href="#main"
      >
        {copy.skipToContent}
      </a>
      <main
        id="main"
        className="relative h-screen overflow-hidden bg-background"
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.section
            key={viewId}
            initial={{
              opacity: 0,
              x: enterX,
              scale: 0.97,
              filter: "blur(4px)",
            }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
            exit={{
              opacity: 0,
              x: exitX,
              scale: 0.97,
              filter: "blur(4px)",
            }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
            className="absolute inset-0 flex flex-col"
          >
            {window.telo.shell.frameless || addingAccount ? (
              <header className="window-titlebar-safe flex h-14 shrink-0 items-center gap-1 [app-region:drag]">
                <WindowControls />
                {addingAccount && shellStep === "welcome" ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={copy.cancelAddAccount}
                    onClick={cancelAddingAccount}
                    className="size-11 rounded-full [app-region:no-drag]"
                  >
                    <ArrowLeft />
                  </Button>
                ) : null}
              </header>
            ) : null}
            <div className="grid flex-1 place-items-center px-6">
              <div className="w-full max-w-[420px]">
                {showAgentSetup ? (
                  <AgentConfigurationForm
                    variant="onboarding"
                    onComplete={completeAgentSetup}
                    onSkip={completeAgentSetup}
                  />
                ) : shellStep === "welcome" ? (
                  <WelcomeStep
                    onStart={goToAuth}
                    addingAccount={addingAccount}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    <ConnectionStepContent form={form} />
                    <Button
                      variant="ghost"
                      onClick={handleBack}
                      className="w-full"
                    >
                      {copy.back}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        </AnimatePresence>
      </main>
    </>
  );
}

function WelcomeStep({
  onStart,
  addingAccount,
}: {
  onStart(): void;
  addingAccount: boolean;
}) {
  return (
    <>
      <PaperPlaneTilt className="mb-7 size-9 text-primary" weight="fill" />
      <TextReveal
        as="h1"
        text={addingAccount ? copy.addAccount : copy.signInToTelegram}
        className="text-balance text-3xl font-semibold tracking-tight"
      />
      <TextReveal
        as="p"
        text={addingAccount ? copy.addAccountWithPhone : copy.signInWithPhone}
        delay={0.1}
        className="mt-2 text-pretty text-sm text-muted-foreground"
      />
      <StatefulButton className="mt-8 w-full" size="lg" onClick={onStart}>
        {copy.startMessaging}
      </StatefulButton>
    </>
  );
}
