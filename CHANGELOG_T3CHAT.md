# T3Chat Provider - Changelog

## [2026-07-06] - Critical Fixes

### 🔴 BREAKING FIX: Role Conversion

- **Issue:** T3Chat only accepts `user` and `assistant` roles, all other roles caused HTTP 400/500 errors
- **Fix:** Automatically convert all non-assistant roles to `user` with context prefixes
  - `system` → `[System instruction]: {content}`
  - `tool` → `[Tool result]: {content}`
  - `function` → `[Function result]: {content}`
- **Impact:** All existing integrations will now work with T3Chat without modification
- **Files:** `open-sse/executors/t3chatPayload.js`

### 🔴 CRITICAL FIX: Response Body Consumption

- **Issue:** "Response body is already used" error when streaming SSE responses
- **Fix:** Detect SSE via content-type header and avoid consuming body during logging
- **Impact:** Streaming responses now work reliably
- **Files:** `open-sse/executors/t3chatTransport.js`

### 🟡 Enhancement: Request Validation

- **Added:** Pre-flight validation for message arrays
- **Added:** Structure validation for all messages (id, role, parts)
- **Added:** Skip invalid/null messages instead of crashing
- **Impact:** Better error messages and more robust handling
- **Files:** `open-sse/executors/t3chatPayload.js`

### 🟡 Enhancement: Error Messages

- **Added:** Parse JSON error responses from T3Chat API
- **Added:** Contextual hints for `invalid_params` and `unknown` errors
- **Added:** Detailed payload structure logging
- **Impact:** Easier debugging when issues occur
- **Files:** `open-sse/executors/t3chat.js`

### 📝 Testing

- **Added:** `test-t3chat-fixes.js` - Comprehensive transformation tests
- **Added:** `test-t3chat-roles.js` - Role conversion verification
- **Added:** `T3CHAT_FIX_SUMMARY.md` - English documentation
- **Added:** `T3CHAT_FIX_PENJELASAN.md` - Indonesian documentation

## Migration Guide

### Before (would fail)

```javascript
{
  "messages": [
    { "role": "system", "content": "You are helpful" },
    { "role": "user", "content": "Hello" }
  ]
}
```

### After (automatically converted)

```javascript
{
  "messages": [
    { 
      "role": "user", 
      "parts": [{ "text": "[System instruction]: You are helpful" }] 
    },
    { 
      "role": "user", 
      "parts": [{ "text": "Hello" }] 
    }
  ]
}
```

## Verification

Run tests to verify fixes:

```bash
node test-t3chat-fixes.js
node test-t3chat-roles.js
```

All tests should show ✅ PASSED.

## Known Issues

- HTTP 429: Vercel Security Checkpoint may block datacenter IPs (use residential proxy)
- Cookies expire: Refresh credentials from t3.chat when getting 401/403 errors

## Credits

Fixed by: Kiro AI Assistant
Date: 2026-07-06
Status: ✅ Production Ready
