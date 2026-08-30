import { ArrowLeft, PaperPlaneTilt } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import {
  ConnectionStepContent,
  useConnectionForm,
} from "features/connect-telegram";
import { copy } from "shared/config/copy";
import {
  Button,
  EASE_OUT,
  StatefulButton,
  TextReveal,
} from "shared/ui";

type ShellStep = "welcome" | "auth";

const STEP_ORDER: Record<string, number> = {
  welcome: 0,
  phone: 1,
  code: 2,
  password: 3,
  ready: 4,
  "credentials-missing": 4,
};

export function OnboardingPage() {
  const [shellStep, setShellStep] = useState<ShellStep>("welcome");
  const form = useConnectionForm();
  const viewId = shellStep === "welcome" ? "welcome" : form.viewId;
  const [prevViewId, setPrevViewId] = useState(viewId);
  const [direction, setDirection] = useState<1 | -1>(1);
  const reduce = useReducedMotion();

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
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm"
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
            {shellStep === "auth" ? (
              <header className="flex h-14 shrink-0 items-center px-3">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={copy.back}
                  onClick={handleBack}
                  className="size-11 rounded-full"
                >
                  <ArrowLeft />
                </Button>
              </header>
            ) : null}
            <div className="grid flex-1 place-items-center px-6">
              <div className="w-full max-w-[420px]">
                {shellStep === "welcome" ? (
                  <WelcomeStep onStart={goToAuth} />
                ) : (
                  <ConnectionStepContent form={form} />
                )}
              </div>
            </div>
          </motion.section>
        </AnimatePresence>
      </main>
    </>
  );
}

function WelcomeStep({ onStart }: { onStart(): void }) {
  return (
    <>
      <PaperPlaneTilt className="mb-7 size-9 text-primary" weight="fill" />
      <TextReveal
        as="h1"
        text={copy.signInToTelegram}
        className="text-balance text-3xl font-semibold tracking-tight"
      />
      <TextReveal
        as="p"
        text={copy.signInWithPhone}
        delay={0.1}
        className="mt-2 text-pretty text-sm text-muted-foreground"
      />
      <StatefulButton className="mt-8 w-full" size="lg" onClick={onStart}>
        {copy.startMessaging}
      </StatefulButton>
    </>
  );
}
