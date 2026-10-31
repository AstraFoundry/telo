# Service conventions

Telo has no HTTP or IPC API: the UI calls Go services in the same process through `frontend/shared/runtime.Runtime` ([`interfaces.md`](interfaces.md)). These rules keep that boundary as strict as a process boundary would be.

## Rules

- **Values, not handles.** Services return domain values (`tg.Chat`, `agent.Thread`); never TDLib objects, file handles or HTTP responses.
- **No secrets cross.** API keys, OAuth tokens, Telegram database keys and session data never reach the UI. The agent settings pane sees an account label and whether a key is stored, never the key.
- **Errors are domain errors.** Ports return the domain's sentinel errors (`agent.ErrNoCredential`, `agent.ErrRejected`, `agent.ErrUnreachable`, `tg.ErrCannotWrite`, …), and the UI words them from the copy catalog. Provider payloads, stack traces and file paths are not shown.
- **Context first.** Calls that can block take a `context.Context`; cancelling it (closing the panel, Stop) stops the work.
- **Off the main thread.** The UI calls services from `Runtime.Go` and applies results on the next frame; services never touch view state.
- **Events are subscriptions.** `Repository.Subscribe` delivers domain events (`tg.ChatUpserted`, `tg.MessageUpserted`, …) and returns an unsubscribe function.
- **Validation twice.** The UI validates for feedback; the domain validates again (`agent.NewRule`, `agent.NewTask`, `Preferences.Normalize`), so nothing invalid is stored whichever caller made it.
