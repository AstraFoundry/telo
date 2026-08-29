import { useState } from "react";

import { useTelegramStore } from "entities/telegram";
import {
  type Country,
  detectCountryCode,
  getCountry,
  parseInternationalPhone,
} from "shared/config/countries";

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
  /** Selected country/region for the phone step. */
  country: Country;
  setCountry(code: string): void;
  /**
   * Phone field contents: national number digits, or a pending international
   * entry ("+" followed by digits) that has not matched a dialing code yet.
   */
  phoneNumber: string;
  /** E.164 number sent to Telegram and shown on later steps. */
  fullPhoneNumber: string;
  setPhoneNumber(value: string): void;
  challenge: string;
  setChallenge(value: string): void;
  submitPhone(): void;
  submitChallengeValue(value: string): void;
  editPhone(): void;
}

/**
 * Drives the multi-step Telegram sign-in (phone → code → password). The step
 * is local state that follows the store's auth status; a submission keeps the
 * user on the current step until the backend pushes the next one, so a failed
 * or in-flight attempt never yanks the view away.
 *
 * The phone step separates the country/region from the national number —
 * mirroring Telegram's own clients. Typing or pasting a number with an
 * international "+" prefix re-selects the country and keeps the national
 * remainder in the field.
 */
export function useConnectionForm(): ConnectionForm {
  const auth = useTelegramStore((state) => state.auth);
  const configuration = useTelegramStore((state) => state.configuration);
  const beginLogin = useTelegramStore((state) => state.beginLogin);
  const submitChallenge = useTelegramStore((state) => state.submitChallenge);
  const [countryCode, setCountryCode] = useState(() =>
    detectCountryCode(navigator.language),
  );
  const [phoneNumber, setPhoneNumber] = useState("");
  const [challenge, setChallenge] = useState("");
  const [step, setStep] = useState<ConnectionStep>("phone");

  const country = getCountry(countryCode);
  const digits = phoneNumber.replace(/\D/g, "");
  // A pending international entry is already the whole number; the country
  // prefix applies to national numbers only.
  const fullPhoneNumber = phoneNumber.startsWith("+")
    ? `+${digits}`
    : `+${country.dialCode}${digits}`;

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
    country,
    setCountry: setCountryCode,
    phoneNumber,
    fullPhoneNumber,
    setPhoneNumber(value) {
      const international = parseInternationalPhone(value);
      if (international) {
        setCountryCode(international.country.code);
        setPhoneNumber(international.nationalNumber);
        return;
      }
      if (value.trimStart().startsWith("+")) {
        // Unmatched international entry so far — keep it verbatim while the
        // user keeps typing toward a dialing code.
        setPhoneNumber(`+${value.replace(/\D/g, "")}`);
        return;
      }
      setPhoneNumber(value.replace(/\D/g, ""));
    },
    challenge,
    setChallenge,
    submitPhone() {
      // Credentials are injected at build time; the renderer only sends the
      // phone number.
      void beginLogin({ phoneNumber: fullPhoneNumber });
    },
    submitChallengeValue(value) {
      void submitChallenge(value).then(() => setChallenge(""));
    },
    editPhone() {
      setStep("phone");
    },
  };
}
