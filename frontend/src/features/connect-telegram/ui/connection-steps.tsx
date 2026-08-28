import { PencilSimple } from "@phosphor-icons/react";

import { copy } from "shared/config/copy";
import { Button, Input, StatefulButton, Tooltip } from "shared/ui";

import type { ConnectionForm } from "../model/use-connection-form";

interface ConnectionStepContentProps {
  form: ConnectionForm;
  compact?: boolean;
}

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
          form.submitChallengeValue();
        }}
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-sm font-medium">{form.phoneNumber}</p>
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
        <Input
          label={copy.loginCode}
          inputMode="numeric"
          autoComplete="one-time-code"
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

  if (form.step === "password") {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          form.submitChallengeValue();
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
      <Input
        label={copy.phoneNumber}
        type="tel"
        autoComplete="tel"
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
