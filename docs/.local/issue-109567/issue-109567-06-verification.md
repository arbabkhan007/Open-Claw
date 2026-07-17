# Issue #109567 Verification Report

## Fix Applied

Added `handshakeTimeout: 30_000` to the WebSocket constructor options in `openWebSocket()`.

## Verification

Code diff confirms the change is a single-line option addition following the established pattern.

## Risk

Minimal. Options-only addition, no behavior change for successful connections.
