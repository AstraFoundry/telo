import { useState } from "react";

import { useTelegramStore } from "entities/telegram";

export type ConnectionStep = "phone" | "code" | "password";

export interface ConnectionForm {
  /** Current step shown to the user. */
  step: ConnectionStep;
  /** Morph key for step containers: also distinguishes the terminal states. */
  viewId: string;
  busy: boolean;
  credentialsMissing: boolean;
  ready: boolean;
  /** Message from the store's error auth state, shown on the current step. */
  errorMessage: string | undefined;
  phoneNumber: string;
  setPhoneNumber(value: string): void;
  challenge: string;
  setChallenge(value: string): void;
  submitPhone(): void;
  submitChallengeValue(): void;
  editPhone(): void;
}

/**
 * Drives the multi-step Telegram sign-in (phone → code → password). The step
 * is local state that follows the store's auth status; a submission keeps the
 * user on the current step until the backend pushes the next one, so a failed
 * or in-flight attempt never yanks the view away.
 */
export function useConnectionForm(): ConnectionForm {
  const auth = useTelegramStore((state) => state.auth);
  const configuration = useTelegramStore((state) => state.configuration);
  const beginLogin = useTelegramStore((state) => state.beginLogin);
  const submitChallenge = useTelegramStore((state) => state.submitChallenge);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [challenge, setChallenge] = useState("");
  const [step, setStep] = useState<ConnectionStep>("phone");

  const status = auth?.status ?? "idle";
  const credentialsMissing =
    configuration?.applicationCredentialsConfigured === false;
  const ready = status === "ready";

  // Follow the store's auth status without an effect: adjust the step during
  // render when the status changes, so a submitted or failed attempt keeps the
  // user on the current step until the backend pushes the next one.
  const [lastStatus, setLastStatus] = useState(status);
  if (status !== lastStatus) {
    setLastStatus(status);
    if (status === "code-required") setStep("code");
    else if (status === "password-required") setStep("password");
    else if (status === "idle") setStep("phone");
  }

  return {
    step,
    viewId: credentialsMissing ? "credentials-missing" : ready ? "ready" : step,
    busy: status === "connecting",
    credentialsMissing,
    ready,
    errorMessage: auth?.status === "error" ? auth.message : undefined,
    phoneNumber,
    setPhoneNumber,
    challenge,
    setChallenge,
    submitPhone() {
      // Credentials are injected at build time; the renderer only sends the
      // phone number.
      void beginLogin({ phoneNumber });
    },
    submitChallengeValue() {
      void submitChallenge(challenge).then(() => setChallenge(""));
    },
    editPhone() {
      setStep("phone");
    },
  };
}
