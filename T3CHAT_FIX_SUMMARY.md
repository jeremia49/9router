# T3Chat Error Fixes - Summary

## Issues Fixed

### 1. **T3Chat Role Restriction - CRITICAL FIX**

**Root Cause:** T3Chat is a web-only chat interface that ONLY accepts `user` and `assistant` roles. Sending messages with `system`, `tool`, or `function` roles causes HTTP 400/500 errors.

**Fix Applied:**

- All non-assistant roles are now converted to `user` role
- Added context prefixes to preserve intent:
  - `system` → `[System instruction]: {content}`
  - `tool` → `[Tool result]: {content}`
  - `function` → `[Function result]: {content}`
  - `user` → kept as-is
- `assistant` role is preserved unchanged
- Simplified message transformation logic (removed pending system content accumulation)

**Location:** `open-sse/executors/t3chatPayload.js` lines 18-68

### 2. **"Response body is already used"** Error

**Root Cause:** The response body was being consumed when logging headers before being returned for streaming.

**Fix Applied:**

- Modified `t3chatTransport.js` to safely log headers without consuming the body
- Added content-type checking to explicitly detect SSE streams (`text/event-stream`)
- Only return the response object for streaming WITHOUT calling `.text()` first
- Wrapped header logging in try-catch to prevent errors from consuming the stream

**Location:** `open-sse/executors/t3chatTransport.js` lines 140-180

### 2. **HTTP 500 "An unexpected error occurred"**

**Root Cause:** Invalid or malformed request payload being sent to T3Chat API.

**Fixes Applied:**

- Added message validation in `buildT3ChatPayload()` to ensure at least one message exists
- Added structure validation to check all messages have required fields (id, role, parts)
- Added logging in `toT3ChatMessages()` to detect invalid message objects early
- Skip messages with no content (except assistant messages which can be empty)

**Location:** `open-sse/executors/t3chatPayload.js` lines 18-110

### 3. **HTTP 400 "Invalid request parameters"**

**Root Cause:** Malformed messages or missing required fields in the request payload.

**Fixes Applied:**

- Enhanced message transformation with null/undefined checks
- Added validation that skips invalid message objects instead of crashing
- Added detailed logging to show transformation process
- Added early validation before sending the request

**Location:** `open-sse/executors/t3chatPayload.js` lines 18-50, 110-135

### 4. **Improved Error Messages**

**Enhancement:** Better error reporting to help diagnose issues.

**Changes Made:**

- Parse error JSON responses and provide specific guidance based on error type
- Added contextual hints for `invalid_params` and `unknown` error types
- Log full payload structure (with content preview) before sending
- Added debug logging for message transformation process

**Location:** `open-sse/executors/t3chat.js` lines 50-75

## Testing the Fixes

### Before Testing

1. Ensure T3Chat credentials are valid:
   - Fresh cookies from t3.chat
   - Valid convexSessionId

2. Check your request payload:
   - Has at least one message
   - Messages have valid `role` and `content` fields

### Debug Output

The fixes add comprehensive logging with these prefixes:

- `[T3CHAT-TRANSPORT-DEBUG]` - HTTP transport layer
- `[T3CHAT-PAYLOAD-DEBUG]` - Message transformation
- `[T3CHAT-DEBUG]` - Main executor

### Example Valid Request

```json
{
  "model": "gemini-2.5-flash",
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "stream": true
}
```

## Common Issues & Solutions

### Still Getting HTTP 500?

- **Check:** Your cookies may be expired
- **Solution:** Refresh cookies from t3.chat using browser devtools

### Still Getting HTTP 400?

- **Check:** The debug logs showing message transformation
- **Look for:** `[T3CHAT-PAYLOAD-DEBUG]` messages indicating empty or invalid messages
- **Solution:** Ensure your input messages have valid content

### Still Getting "Response body is already used"?

- **Check:** You might be on an older Node.js version
- **Solution:** Ensure Node.js 18+ with proper ReadableStream support

### Getting HTTP 429 (Rate Limit)?

- **Check:** Your server IP might be blocked by Vercel
- **Solution:** Use a residential proxy or SSH tunnel (see VERCEL_SECURITY_CHECKPOINT_FIX.md)

## Files Modified

1. `open-sse/executors/t3chatTransport.js`
   - Fixed response body consumption issue
   - Added content-type based SSE detection
   - Improved header logging safety

2. `open-sse/executors/t3chatPayload.js`
   - Added message validation
   - Enhanced null/undefined handling
   - Added comprehensive debug logging
   - Added early validation before payload creation

3. `open-sse/executors/t3chat.js`
   - Improved error message parsing
   - Added detailed payload structure logging
   - Added contextual error guidance

## Verification Steps

### Run Automated Tests

```bash
# Test message transformation and validation
node test-t3chat-fixes.js

# Test role conversion (critical)
node test-t3chat-roles.js
```

Both tests should show all ✅ passing.

### Verify Role Conversion

The most critical fix is role conversion. Verify that:

```javascript
// Input: mixed roles
[
  { role: "system", content: "You are helpful" },
  { role: "user", content: "Hello" },
  { role: "assistant", content: "Hi" },
  { role: "tool", content: '{"result": "ok"}' }
]

// Output: only 'user' and 'assistant'
[
  { role: "user", parts: [{ text: "[System instruction]: You are helpful" }] },
  { role: "user", parts: [{ text: "Hello" }] },
  { role: "assistant", parts: [{ text: "Hi" }] },
  { role: "user", parts: [{ text: '[Tool result]: {"result": "ok"}' }] }
]
```

### Test with Real API

1. Start your 9router server
2. Make a T3Chat API request
3. Check logs for:
   - `[T3CHAT-PAYLOAD-DEBUG] Transformed X input messages to Y T3Chat messages`
   - `[T3CHAT-TRANSPORT-DEBUG] Streaming SSE response detected`
   - No "Response body is already used" errors
   - No HTTP 400/500 errors (unless credentials are invalid)

## Next Steps if Issues Persist

1. **Enable full debug mode:**

   ```bash
   export DEBUG=t3chat:*
   ```

2. **Check your credentials:**
   - Open t3.chat in browser
   - Open DevTools → Network tab
   - Make a chat request
   - Copy the Cookie header and convex-session-id

3. **Verify the request payload:**
   - Check `[T3CHAT-DEBUG] Payload structure:` log
   - Ensure `messagesCount` > 0
   - Ensure `firstMessage` has valid structure

4. **File an issue with:**
   - Full error message
   - Debug logs (with sensitive data redacted)
   - Node.js version
   - Request payload structure

---

**Date:** 2026-07-06
**Status:** ✅ Fixed
**Tested:** Pending user verification
