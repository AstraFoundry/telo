# Testing

## Quality gate

`make check` is the local release gate. It checks formatting, ESLint (including FSD layer and slice boundaries via `eslint-plugin-boundaries`; see [`docs/frontend/import-rules.md`](../frontend/import-rules.md)), TypeScript, unit/integration coverage, Markdown, and Electron E2E behavior. GitHub Actions splits that gate into a `check` job (format, lint, TypeScript, coverage-gated tests, Markdown) and a dedicated `e2e` job that launches Electron under Xvfb.

## Unit and integration tests

Vitest runs two projects: `backend` (node environment, `backend/src/**/*.test.ts`) and `frontend` (jsdom environment, `frontend/src/**/*.test.{ts,tsx}`, with `frontend/src/shared/test/setup.ts` as the setup file). The frontend project mirrors the renderer's FSD aliases from `electron.vite.config.ts` so component tests resolve layer imports. Frontend tests mock the `window.telo` preload contract via the shared helper in `frontend/src/shared/test/mock-telo.ts`.

Vitest covers domain invariants, application orchestration, adapter behavior, invalid input, secret preservation, deterministic demo data, frontend entity stores (AG-UI event reduction, chat selection/sending, Telegram auth error mapping), and widget behavior (sidebar chat-selection callback, Agent panel configuration states). Agent multi-session (threads) behavior is covered end to end at the domain (`agent-thread.test.ts`), application (`agent-threads.test.ts`), infrastructure (`file-agent-thread-repository.test.ts`), and IPC handler (`register-ipc.test.ts`) levels. Coverage is collected for `backend/src/domain/**`, `backend/src/application/**`, the file-based/demo repositories under `backend/src/infrastructure` (`demo-telegram-repository.ts`, `file-telegram-connection-profile-repository.ts`, `file-telegram-session-repository.ts`, `file-agent-configuration-repository.ts`, `file-user-preferences-repository.ts`), and frontend entity models (`frontend/src/entities/**/model/**`). The vendored beUI registry under `frontend/src/shared/beui/**` is excluded from coverage. Coverage thresholds are 80% for lines, functions, and statements and 75% for branches across all included files.

## End-to-end tests

Playwright launches the packaged Electron entry. Specs share the Electron launch/teardown fixtures in `tests/e2e/fixtures.ts` (`test` for onboarding, `demoTest` for `TELO_DEMO_WORKSPACE=1`); each test gets an isolated `--user-data-dir`. The fixture launches Electron with `TELO_PLAINTEXT_SECRETS=1` because `safeStorage` has no keychain under Playwright (see [`docs/backend/database.md`](../backend/database.md)); without it the main process cannot persist an API key. Under `CI=1` it also passes `--no-sandbox`, which GitHub-hosted Linux runners require. Demo journeys wait on the chat navigation via `waitForDemoWorkspace` — there is no in-app demo button. Eleven journeys are covered:

- `workspace.spec.ts` — first-launch onboarding has no demo-workspace action; with the launch flag, current-account identity area, the dedicated Settings surface from the account menu, the unconfigured Agent panel state, and returning to the conversation surface when a chat is selected while Settings is open.
- `login-error.spec.ts` — credentials are injected at build time and the e2e build ships none, so clicking Start Messaging on the onboarding welcome step swaps the view straight into the terminal credentials-missing alert; the phone step stays unreachable.
- `messaging.spec.ts` — chat selection in the demo workspace, composer input, and the sent message rendering in the conversation log.
- `messaging-sync.spec.ts` — after sending, the demo counterpart types then replies; a composer draft survives switching chats and coming back; clicking a reply quote scrolls the source message into view.
- `chat-navigation.spec.ts` — switching between demo chats swaps the conversation heading and messages, and the chat-search field filters the conversation list (including the empty-result state).
- `agent-not-configured.spec.ts` — with no API key configured, the Agent panel blocks the composer and links to the Agent section of Settings; after saving a fake API key through the Settings Agent form, the provider rejection is rendered as a sanitized assistant message (no key material or endpoint URLs) without an empty assistant shell or feedback actions.
- `settings-persistence.spec.ts` — editing the Agent configuration form in Settings, saving, and reopening Settings shows the persisted values after the form's asynchronous backfill.
- `context-menu.spec.ts` — right-clicking a chat row opens the state-aware context menu (Mark as read clears the unread badge, and reopening the menu offers Mark as unread); right-clicking a message bubble offers Copy Text, and activating it closes the menu. Clipboard contents are asserted when Electron grants read permission; otherwise the clickable item and the menu dismissal carry the journey.
- `message-actions.spec.ts` — the message action journeys: Reply opens the composer preview bar and the sent message carries a quote block with the original sender and body; Edit prefills the composer with the outgoing message and the resent bubble shows the new body with an `edited` marker; Delete asks for confirmation in a dialog before the message disappears; Forward opens the chat-picker dialog and the target chat's sidebar preview updates to the forwarded body.
- `preferences.spec.ts` — changing every Settings preference (Theme, Accent color, Message text size, Time format, Send with Enter, Desktop notifications) and reopening Settings shows the persisted values from `preferences.json`; switching Time format to 24-hour re-renders the sidebar chat-row timestamps live (while Settings is still open) and the conversation message timestamps without AM/PM markers, and switching Send with to Cmd+Enter makes a bare Enter insert a newline while Cmd+Enter sends the message.
- `logout.spec.ts` — the Telegram account section's Log out button arms a two-step confirm, and the second click clears the demo workspace and returns the shell to onboarding without a demo-workspace action.

Selectors use stable semantic locators (roles, labels, names) rather than DOM structure; names that collide with the "Saved Messages" demo chat are scoped to the chat navigation or matched exactly. The onboarding sign-in flow is a full-screen step sequence, so its content is located by inner semantics (the `role="alert"` terminal states, input labels, submit buttons, and the back button). The onboarding heading is rendered by TextReveal, which splits the copy into per-word inline-block spans while preserving whitespace, so the computed accessible name still matches the full string. Context menus render in a `body` portal and are located by their `role="menu"` / `role="menuitem"` semantics (closed menus carry `aria-hidden`, so they never match while dismissed). Forms that backfill asynchronously (for example the Agent configuration form) must be awaited on their loaded default values before typing. The Message text size slider is driven by keyboard (`ArrowRight` steps by one) and asserted through `aria-valuenow`, because a pointer drag would depend on the track's pixel width. Add E2E coverage only for critical cross-process journeys; keep domain permutations in Vitest.

## Commands

```sh
make test
make test-e2e
make check
```
