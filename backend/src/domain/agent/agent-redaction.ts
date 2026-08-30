import type { AgentRedactionCounts } from "../../../../contracts/src/ipc";
import type { AgentScopedMessage } from "./agent-context";

export const REDACTED_EMAIL = "[redacted email]";
export const REDACTED_PHONE = "[redacted phone]";
export const REDACTED_TOKEN = "[redacted token]";

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Candidate phone runs: digits with the usual separators. A bare run must
// hold at least 10 digits so dates ("2026-08-27") and message ids stay
// intact; a "+" prefix marks an international number, where 7 digits suffice.
const PHONE_CANDIDATE_PATTERN = /\+?[0-9][0-9 ().-]{5,}[0-9]/g;
const MIN_LOCAL_PHONE_DIGITS = 10;
const MIN_INTERNATIONAL_PHONE_DIGITS = 7;

// API-key-like tokens with a recognizable provider prefix. Generic
// high-entropy strings are not masked: message ids and hashes would produce
// false positives.
const TOKEN_PATTERN =
  /(sk[_-](?:live|test)[_-][A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{16,}|gh[opus]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{16,}|ya29\.[A-Za-z0-9_-]{10,})/g;

// Counts accumulate during the replace passes; the readonly DTO shape is
// only produced when a result is returned.
type MutableCounts = {
  -readonly [K in keyof AgentRedactionCounts]: number;
};

function emptyCounts(): MutableCounts {
  return { emails: 0, phones: 0, tokens: 0 };
}

export function sumRedactionCounts(
  ...counts: ReadonlyArray<AgentRedactionCounts>
): AgentRedactionCounts {
  return counts.reduce(
    (total, next) => ({
      emails: total.emails + next.emails,
      phones: total.phones + next.phones,
      tokens: total.tokens + next.tokens,
    }),
    emptyCounts(),
  );
}

function isPhoneLike(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "").length;
  return candidate.startsWith("+")
    ? digits >= MIN_INTERNATIONAL_PHONE_DIGITS
    : digits >= MIN_LOCAL_PHONE_DIGITS;
}

/**
 * Masks phone numbers, email addresses, and API-key-like tokens in one text,
 * returning the masked text alongside per-kind replacement counts. Tokens go
 * first so a key containing an "@" or digit run cannot be half-eaten by the
 * email or phone passes.
 */
export function redactAgentText(text: string): {
  text: string;
  counts: AgentRedactionCounts;
} {
  const counts = emptyCounts();
  const withoutTokens = text.replace(TOKEN_PATTERN, () => {
    counts.tokens += 1;
    return REDACTED_TOKEN;
  });
  const withoutEmails = withoutTokens.replace(EMAIL_PATTERN, () => {
    counts.emails += 1;
    return REDACTED_EMAIL;
  });
  const masked = withoutEmails.replace(PHONE_CANDIDATE_PATTERN, (candidate) => {
    if (!isPhoneLike(candidate)) return candidate;
    counts.phones += 1;
    return REDACTED_PHONE;
  });
  return { text: masked, counts };
}

/**
 * Redacts the sender names and bodies of an assembled context. The redacted
 * messages are both what the payload preview shows and what the gateway
 * receives — what you see is what gets sent.
 */
export function redactAgentContext(
  messages: ReadonlyArray<AgentScopedMessage>,
): {
  messages: ReadonlyArray<AgentScopedMessage>;
  counts: AgentRedactionCounts;
} {
  const counts = emptyCounts();
  const redacted = messages.map((message) => {
    const sender = redactAgentText(message.senderName);
    const body = redactAgentText(message.body);
    counts.emails += sender.counts.emails + body.counts.emails;
    counts.phones += sender.counts.phones + body.counts.phones;
    counts.tokens += sender.counts.tokens + body.counts.tokens;
    return { ...message, senderName: sender.text, body: body.text };
  });
  return { messages: redacted, counts };
}
