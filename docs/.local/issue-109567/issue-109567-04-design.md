# Issue #109567 Design Document

## Fix Strategy

Add `handshakeTimeout: 30_000` to the WebSocket constructor options.

### Changes

| File | Line | Change |
|------|------|--------|
| `extensions/openai/realtime-voice-provider.ts` | 652 | Add `handshakeTimeout: 30_000` to ws options |

### Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| 30s timeout too short | Low | Standard across codebase |
