# T3Chat HTTP 400 "invalid_params" Fix

## Problem

T3Chat was returning HTTP 400 with error message:

```
{"error":{"type":"invalid_params","message":"Invalid request parameters"}}
```

## Root Cause

The `toT3ChatMessages()` function was creating **separate messages** for consecutive user-role messages (system, user, tool, etc.), but T3Chat's API requires **consecutive user messages to be merged into a single message**.

### Before (BROKEN)

```javascript
Input:  [system, user]
Output: [user, user]  // Two separate user messages - REJECTED by T3Chat
```

### After (FIXED)

```javascript
Input:  [system, user]
Output: [user]  // One merged user message - ACCEPTED by T3Chat
```

## The Fix

Modified `toT3ChatMessages()` in `open-sse/executors/t3chatPayload.js` to:

1. **Accumulate consecutive user-role content** instead of creating separate messages
2. **Flush accumulated content** when an assistant message is encountered
3. **Merge with double newlines** (`\n\n`) to separate different message parts

### Key Changes

- Added `accumulatedUserContent` array to buffer user messages
- Added `flushUserMessage()` helper to create merged user messages
- Removed `[System instruction]:` prefix (system messages merge directly)
- Fixed tool/function prefixes to use format: `[Tool result: content]`

## Message Merging Rules

1. **System + User → Single User**: System instructions merge directly with user content
2. **User + User → Single User**: Multiple consecutive user messages merge with `\n\n`
3. **User + Assistant → Two Messages**: Assistant messages trigger a flush
4. **Tool messages**: Converted to user with `[Tool result: content]` prefix

## Test Results

All payload/parser tests pass:

```
✓ merges system messages into user messages
✓ converts tool messages to user messages  
✓ builds payload with T3Chat required fields
```

### Example Test Case

```javascript
Input: [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello' }
]

Output: [{
  role: 'user',
  parts: [{ 
    type: 'text', 
    text: 'You are a helpful assistant.\n\nHello' 
  }]
}]
```

## Why This Matters

T3Chat's API validation checks message structure strictly:

- ❌ Rejects: Multiple consecutive user messages
- ✅ Accepts: Alternating user/assistant messages with merged user content

This matches how the official T3Chat web UI sends messages to their backend.

## Files Changed

- `open-sse/executors/t3chatPayload.js` - Fixed message merging logic

## Date Fixed

2026-07-06
