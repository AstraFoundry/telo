# Code Review

## Checklist

### Architecture

- [ ] Does the change respect FSD/DDD layer boundaries? (`make arch` enforces them; a new violation fails the gate and is never suppressed.)
- [ ] Is business logic in the domain layer, not in controllers or components?
- [ ] Are repository/ports defined in domain and implemented in infrastructure?

### Code quality

- [ ] Is all code and commentary in English?
- [ ] Is every visible string a key of the copy catalog?
- [ ] Are colors, radii and type sizes tokens from `theme`?
- [ ] Is there no redundant UI copy?
- [ ] Is there no duplicated logic that could be extracted?
- [ ] Is there no fallback/clever bypass logic?

### Parity

- [ ] Does a new menu item, shortcut, settings row or context-menu item carry its telegram-macos id, and does the ledger entry name its evidence and tests? (`make parity`)
- [ ] Does a new gap have a ledger entry with a priority and a reason?

### Testing

- [ ] Are domain rules covered by unit tests?
- [ ] Are integration points covered by integration tests?
- [ ] Do tests fail for the right reason?

### Documentation

- [ ] If behavior or conventions changed, is `docs/` updated in the same change set?
- [ ] Are new public APIs documented?

### Security

- [ ] Are user inputs validated at the boundary?
- [ ] Do secrets stay sealed and out of the UI?
- [ ] Does agent context go through the scoped, redacted payload?
- [ ] Are errors shown to the user domain errors worded from the catalog?

## Review culture

- Reviews should be constructive and specific.
- Prefer asking questions over making demands.
- Approve only when the checklist is satisfied.
