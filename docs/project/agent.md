# Agent

The agent sits in the right column of the workspace (`⌘J`, or View › Toggle Agent). It answers about the open chat, the visible messages and the messages a person hands it, cites what it read, and runs automations. Code: `frontend/features/agent` (panel and settings pane), `backend/application/agent` (use cases), `backend/infrastructure/agent` (gateways, OAuth, catalog, stores, demo).

## Panel

- **States.** Not configured (no credential: a recovery action opens Settings › Agent), and the conversation. The header holds the history menu, a new conversation and close.
- **Transcript.** User turns are tinted bubbles on the right; answers are plain text on the left, rendered from Markdown (headings, lists, quotes, fenced code, and Telegram's inline formatting through `tg.ParseMarkdown`). While a run streams, the answer grows in place with the current activity ("Thinking", or the tool in use).
- **Citations.** Payload lines carry `telo://message/<chat>/<message>`; the reference instruction asks the model to paste them after each point. The panel draws each as a numbered link (`[1]`, `[2]`, in order of appearance) that opens the chat and scrolls to the message.
- **Suggestions.** After an answer lands, up to three follow-ups the model proposes show as pills over the composer; choosing one sends it.
- **Quick actions.** With a chat open, Summarize unread and Extract decisions & to-dos start a run scoped to the chat's unread messages.
- **Context.** The composer's Context select chooses what the run reads: no messages, the open chat's unread messages, the folder's unread messages, or the messages selected in the transcript.
- **Stop.** A running answer stops with the stop button; the context is cancelled and nothing more streams.

## Configuration

Settings › Agent holds the provider, the vendor sign-in or API key, the base URL of an OpenAI-compatible server, the model, the instructions, workspace inspection, temperature (0–2), tool rounds (1–8) and replayed turns (0–50).

- **Bring your own account** ([`002`](../decisions/002-byoa-providers.md)): OpenAI, Anthropic and Google sign in with PKCE on a loopback redirect; xAI and Kimi with the device-code grant. Groq, DeepSeek, Mistral and compatible servers take an API key. Tokens never reach the UI: the pane shows the account label.
- **Models** load from the vendor with the stored credential, or the key being typed; a model id can also be typed.
- **Saving** keeps the stored key when the field is empty, and drops a session when the provider changes.
- **Renewal.** A session within a minute of expiry renews before the run; a failed renewal keeps the stored one, which the provider then rejects like an expired key.
- **Kimi** models fix temperature per mode, so the request leaves it out.

## Runs

1. `Service.Run` saves the question to the thread first, so a crash never loses it.
2. A scope is assembled from Telegram (`Assemble`): a chat's last `UnreadCount` incoming messages, the selected ids, or the unread messages of a folder's chats. Media-only messages read as `[photo]`, `[voice]` and so on. Senders and bodies are redacted: emails, phone numbers (ten digits, or seven after a `+`) and API keys with known vendor prefixes. The preview a person sees is the payload the model gets.
3. `ScopedPrompt` writes the payload between `[[telo-input]]` markers as `ref: <link> | <sender>: <body>` lines, then the reference instruction, then the question. An invalid scope fails before anything leaves the device.
4. The gateway streams the provider and loops tool calls up to the step limit, the last step answering in text. Tools: `inspectWorkspace` (the visible chats and messages, when allowed), `listChats`, `readChatHistory`, `searchChatMessages`, `searchGlobal` (all redacted), and `configureTriggerRule` / `configureScheduledTask`.
5. Every run appends an audit record: scope, message ids, redaction counts, model and the SHA-256 of the exact prompt. Never the prompt or message text.
6. The answer, or the failure as a domain outcome (`no credential`, `rejected`, `unreachable`, `failed`), is saved to the thread. Provider payloads, which can carry key material, never reach the UI; the panel words the outcome.

## Message actions

The message menu's Translate, Rewrite and Draft reply run `Service.MessageAction`: an output-only instruction, the action marker (`[[telo-action:translate]]` and so on) and the text between input markers. The result streams into the composer, never a thread. Summarize hands a message to the panel.

## Automation

Trigger rules and scheduled tasks run with no panel open ([`003`](../decisions/003-agent-automation-safety.md)):

- **Trigger rules** match incoming messages by chats, senders, keywords (any) and a case-insensitive RE2 pattern; dimensions combine with AND and at least one is set. Edits, service messages and outgoing messages never fire, so automation cannot loop on its own sends.
- **Scheduled tasks** run on a five-field cron expression in local time or once, and deliver to a chat; an optional scope attaches a chat's or a folder's unread messages. A one-shot missed while Telo was closed runs at the next launch.
- **Delivery** is per entry: draft-only (the default) saves a draft and never overwrites one a person is writing (reported as kept), auto-send posts the answer (as a reply to the matched message for rules).
- Automation follows the connected account, and every run reports as a toast.

## Storage

Configuration, threads, rules and tasks are sealed files; the audit log is JSON lines without message text ([`../backend/database.md`](../backend/database.md)).

## Demo

`make demo` and every UI test use `agentinfra.Demo`: answers follow from the prompt's markers alone (a translation, a rewrite, a reply draft in the requested tone, one cited line per payload message for summaries, a fixed Markdown sample for "Show the Markdown demo."), and follow-ups are a fixed list.
