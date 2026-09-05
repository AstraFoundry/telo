import { PencilSimple } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";

import { copy } from "shared/config/copy";
import {
  Button,
  EASE_OUT,
  Input,
  OTPInput,
  StatefulButton,
  Tooltip,
} from "shared/ui";

import type { ConnectionForm } from "../model/use-connection-form";

import { CountryCombobox } from "./country-combobox";

interface ConnectionStepContentProps {
  form: ConnectionForm;
  compact?: boolean;
}

/** Telegram login codes are five digits. */
const LOGIN_CODE_LENGTH = 5;

/** Current step of the sign-in flow, including the terminal states. */
export function ConnectionStepContent({
  form,
  compact = false,
}: ConnectionStepContentProps) {
  if (form.credentialsMissing) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {copy.credentialsMissing}
      </p>
    );
  }

  if (form.ready) {
    return (
      <p className="text-sm text-muted-foreground">{copy.connectionReady}</p>
    );
  }

  if (form.step === "code") {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.submitChallengeValue(form.challenge);
        }}
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-sm font-medium">{form.fullPhoneNumber}</p>
          <Tooltip content={copy.editPhoneNumber}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={copy.editPhoneNumber}
              onClick={form.editPhone}
            >
              <PencilSimple className="size-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
        <OTPInput
          length={LOGIN_CODE_LENGTH}
          label={copy.loginCode}
          aria-label={copy.loginCode}
          value={form.challenge}
          onChange={form.setChallenge}
          onComplete={form.submitChallengeValue}
          status={form.errorMessage ? "error" : "idle"}
          errorMessage={form.errorMessage}
          autoFocus
        />
        <StatefulButton type="submit" state={form.busy ? "loading" : "idle"}>
          {copy.continue}
        </StatefulButton>
      </form>
    );
  }

  if (form.step === "password") {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.submitChallengeValue(form.challenge);
        }}
      >
        <p className="px-1 text-sm font-medium">{copy.connectionPassword}</p>
        <Input
          label={copy.password}
          type="password"
          autoComplete="current-password"
          value={form.challenge}
          onChange={form.setChallenge}
          error={form.errorMessage}
          autoFocus
          required
        />
        <StatefulButton type="submit" state={form.busy ? "loading" : "idle"}>
          {copy.continue}
        </StatefulButton>
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        form.submitPhone();
      }}
    >
      <CountryCombobox
        value={form.country.code}
        onValueChange={form.setCountry}
      />
      <Input
        label={copy.phoneNumber}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        // While the field holds a pending international entry ("+…"), it is
        // the whole number and the country prefix steps aside.
        leftIcon={
          form.phoneNumber.startsWith("+") ? null : (
            <DialCodePrefix dialCode={form.country.dialCode} />
          )
        }
        style={{
          // Room for the "+" prefix, the dialing code, and a gap after it.
          paddingLeft: form.phoneNumber.startsWith("+")
            ? undefined
            : `calc(0.75rem + ${form.country.dialCode.length + 1}ch + 0.375rem)`,
        }}
        value={form.phoneNumber}
        onChange={form.setPhoneNumber}
        error={form.errorMessage}
        autoFocus
        required
      />
      <StatefulButton type="submit" state={form.busy ? "loading" : "idle"}>
        {compact ? copy.connect : copy.continue}
      </StatefulButton>
    </form>
  );
}

/**
 * Dialing code shown inside the phone field. Swaps vertically with a blur
 * when the country changes — the same treatment Nicegram gives its country
 * button via TextViewSwitcher.
 */
function DialCodePrefix({ dialCode }: { dialCode: string }) {
  const reduce = useReducedMotionConfig();
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={dialCode}
        initial={
          reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }
        }
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={
          reduce ? { opacity: 0 } : { opacity: 0, y: -6, filter: "blur(4px)" }
        }
        transition={{ duration: 0.18, ease: EASE_OUT }}
        className="text-base tabular-nums"
      >
        +{dialCode}
      </motion.span>
    </AnimatePresence>
  );
}
