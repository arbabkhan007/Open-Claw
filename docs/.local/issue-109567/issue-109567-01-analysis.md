# Issue #109567 Analysis

## Metadata

- **Title**: fix(openai): bound realtime-voice WebSocket with handshakeTimeout
- **Labels**: bug
- **URL**: https://github.com/openclaw/openclaw/issues/109567

## Problem Description

The `openWebSocket` function in `extensions/openai/realtime-voice-provider.ts` creates a WebSocket connection with `maxPayload` but without `handshakeTimeout`. If the server accepts TCP but never completes the WebSocket upgrade, the connection hangs.

## Impact Assessment

- Unbounded WebSocket handshake during connection setup
- `rejectStartup` only fires on WS events — if WS never opens/errors/closes, connection hangs forever

## Suggested Fix

Add `handshakeTimeout: 30_000` to the WebSocket constructor options.
