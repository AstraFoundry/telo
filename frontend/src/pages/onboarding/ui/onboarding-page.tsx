import { PaperPlaneTilt } from "@phosphor-icons/react";
import { useState } from "react";

import { TelegramConnectionFlow } from "features/connect-telegram";
import { copy } from "shared/config/copy";
import { Button, StatefulButton, TextReveal, TextShimmer } from "shared/ui";

interface OnboardingPageProps {
  loading: boolean;
  onUseDemo(): void;
}

export function OnboardingPage({ loading, onUseDemo }: OnboardingPageProps) {
  const [step, setStep] = useState<"welcome" | "auth">("welcome");

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
        className="grid h-screen place-items-center bg-background px-6"
      >
        <section
          className="w-full max-w-[420px]"
          aria-label={copy.signInToTelegram}
        >
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
          <div className="mt-8">
            {loading ? (
              <p className="text-sm text-muted-foreground" role="status">
                <TextShimmer>{copy.connectionConnecting}</TextShimmer>
              </p>
            ) : (
              <>
                <StatefulButton
                  className="w-full"
                  size="lg"
                  onClick={() => setStep("auth")}
                >
                  {copy.startMessaging}
                </StatefulButton>
                <Button
                  className="mt-3 w-full"
                  variant="ghost"
                  onClick={onUseDemo}
                >
                  {copy.useDemo}
                </Button>
              </>
            )}
          </div>
        </section>
      </main>
      {step === "auth" ? (
        <TelegramConnectionFlow open onClose={() => setStep("welcome")} />
      ) : null}
    </>
  );
}
