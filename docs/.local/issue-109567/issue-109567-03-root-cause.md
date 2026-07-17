# Issue #109567 Root Cause Analysis

## 5 Whys Analysis

```
Problem: OpenAI realtime-voice WebSocket connection can hang indefinitely
  ↓ Why 1? WebSocket constructor called without handshakeTimeout
  ↓ Why 2? Developer omitted the timeout option
  ↓ Why 3? No enforcement during initial implementation
  ↓
Root cause: Missing handshakeTimeout on WebSocket constructor options
```

## Affected Scope

- `extensions/openai/realtime-voice-provider.ts:649` — `openWebSocket` function
