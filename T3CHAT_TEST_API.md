# T3Chat Test API - Implementation Guide

## Overview

Added test functionality for T3Chat connections and models in the 9router dashboard.

## Changes Made

### 1. Connection Test API (`/api/providers/[id]/test`)

**File:** `src/app/api/providers/[id]/test/testUtils.js`

**New Function:** `testT3ChatConnection(connection, effectiveProxy)`

This function tests T3Chat credentials by making a minimal chat request to verify:

- Cookies are valid
- convexSessionId is valid
- Server accepts the request

**Test Flow:**

1. Extract cookies and convexSessionId from connection
2. Generate random UUIDs for threadId and responseMessageId
3. Make POST request to `https://t3.chat/api/chat` with minimal payload
4. Check response:
   - `200 + text/event-stream` = ✅ Valid
   - `401/403` = ❌ Invalid cookies or expired session
   - `400` = ❌ Bad request (malformed payload)
   - `500` = ❌ Server error

**Example Response:**

```json
{
  "valid": true,
  "error": null,
  "refreshed": false,
  "latencyMs": 1234,
  "testedAt": "2026-07-06T15:55:00.000Z"
}
```

### 2. Model Test API (`/api/models/test`)

**File:** `src/app/api/models/test/ping.js` (no changes needed)

T3Chat model testing works automatically through the internal chat completions API which uses the fixed T3Chat executor.

**Test Flow:**

1. Frontend calls `/api/models/test` with `{ model: "t3chat/gemini-2.5-flash" }`
2. Backend calls internal `/api/v1/chat/completions`
3. T3Chat executor handles the request with role conversion and proper payload
4. Returns success/error based on response

## Dashboard Integration

### Connection Test Button

Located at: `src/app/(dashboard)/dashboard/providers/[id]/page.js`

The "Test Connection" button for each T3Chat connection will now:

- Call `/api/providers/[id]/test`
- Show loading state
- Display success (green checkmark) or error message
- Update connection status in database

### Model Test Button

Located in ModelRow component (same file)

The "Test Model" button for each T3Chat model will:

- Call `/api/models/test` with full model name
- Show loading spinner
- Display success (✅) or error (❌) icon
- Show latency if successful

## Error Messages

### Connection Test Errors

| Error | Meaning | Solution |
| ------- | --------- | ---------- |
| Missing cookies or convexSessionId | Incomplete credentials | Re-add cookies and session ID |
| Invalid cookies or session expired | Auth failed (401/403) | Refresh cookies from t3.chat |
| Bad request: ... | Malformed request (400) | Check payload format |
| Server error: ... | T3Chat server error (500) | Wait and retry |
| HTTP 429 | Rate limited or Vercel checkpoint | Use proxy or wait |

### Model Test Errors

| Error | Meaning | Solution |
| ------- | --------- | ---------- |
| HTTP 401/403 | Invalid credentials | Refresh connection credentials |
| HTTP 400 | Invalid model or parameters | Check model ID is correct |
| HTTP 500 | Server error | Wait and retry |
| Provider returned no completion | Response format issue | Check executor logs |

## Testing the Implementation

### 1. Test Connection API

```bash
curl -X POST http://localhost:20127/api/providers/[connection-id]/test \
  -H "Content-Type: application/json"
```

Expected output:

```json
{
  "valid": true,
  "error": null,
  "refreshed": false
}
```

### 2. Test Model API

```bash
curl -X POST http://localhost:20127/api/models/test \
  -H "Content-Type: application/json" \
  -d '{
    "model": "t3chat/gemini-2.5-flash"
  }'
```

Expected output:

```json
{
  "ok": true,
  "latencyMs": 1234,
  "error": null,
  "status": 200
}
```

### 3. Test from Dashboard

1. Navigate to <http://localhost:20127/dashboard/providers/t3chat>
2. Click "Test Connection" on any connection
3. Should see:
   - Loading spinner during test
   - Green checkmark if valid
   - Red error message if invalid
4. Click "Test Model" on any model
5. Should see:
   - Loading spinner
   - ✅ icon if success
   - ❌ icon if error

## Troubleshooting

### Connection test fails with "Missing cookies or convexSessionId"

**Problem:** Connection doesn't have required fields.

**Solution:**

1. Go to t3.chat in browser
2. Open DevTools → Application → Cookies
3. Copy full Cookie string
4. Find convex-session-id in cookies
5. Re-add connection with both values

### Connection test succeeds but model test fails

**Problem:** Connection is valid but model request fails.

**Solution:**

1. Check executor logs for detailed error
2. Verify role conversion is working (see T3CHAT_FIX_SUMMARY.md)
3. Check if model ID is correct
4. Test with a different model

### Both tests fail with HTTP 429

**Problem:** Vercel Security Checkpoint blocking requests.

**Solution:**

1. Use residential proxy: `export T3CHAT_PROXY=http://proxy:port`
2. Or use SSH tunnel from local machine
3. See T3CHAT_PROXY_CONFIGURATION.md

## Files Modified

1. `src/app/api/providers/[id]/test/testUtils.js`
   - Added `testT3ChatConnection()` function
   - Added `case "t3chat"` in switch statement

## Related Documentation

- `T3CHAT_FIX_SUMMARY.md` - Role conversion fixes
- `T3CHAT_FIX_PENJELASAN.md` - Indonesian explanation
- `CHANGELOG_T3CHAT.md` - Version history
- `T3CHAT_PROXY_CONFIGURATION.md` - Proxy setup

---

**Date:** 2026-07-06  
**Status:** ✅ Implemented  
**Testing:** Ready for user testing
