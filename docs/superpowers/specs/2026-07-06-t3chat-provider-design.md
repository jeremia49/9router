# T3Chat Provider Design

_Date: 2026-07-06_

## Summary

Add a first-party **T3Chat** provider to 9Router. The provider will support multi-account T3Chat sessions, text-only chat completions, direct browser/TLS impersonated requests through `wreq-js`, bulk account import, and a non-blocking QuotaTracker for account observability.

The initial implementation intentionally focuses on text chat and quota visibility. Image generation, tool-output parsing, pre-request quota gating, and full t3router feature parity are out of scope for the first version.

## Goals

- Add a new provider named `T3Chat` / `t3chat`.
- Let users configure each T3Chat account with two explicit fields:
  - `cookies`
  - `convexSessionId`
- Support bulk account import with one account per line:

  ```txt
  cookies_here | convex_session_id_here
  cookies_here | convex_session_id_here
  ```

- Use `wreq-js` as a direct npm dependency for browser/TLS impersonation.
- Match the request shape used by `t3router-py` and `t3router` for `https://t3.chat/api/chat`.
- Parse text-only T3Chat SSE-style responses back into 9Router chat responses.
- Add a QuotaTracker that refreshes and displays quota/account status without blocking normal routing.

## Non-goals

- Image generation parsing.
- Tool-output parsing.
- Conversation history management beyond what is needed for one chat request.
- Pre-request quota checks or quota-based account skipping.
- External Python/Rust sidecar service.
- Auto-refreshing cookies/session from `x-workos-session` in the first implementation, unless it is straightforward and safe during implementation.
- Full parity with all Rust examples such as list history, image generation, or active session management.

## Architecture

T3Chat will be implemented as a specialized provider, not as a generic OpenAI-compatible provider.

### Provider registry

Add a registry entry under `open-sse/providers/registry/` with id `t3chat`.

The entry will include:

- display name `T3Chat`
- T3Chat icon/color metadata consistent with existing provider registry style
- text-chat models supported by T3Chat for the first version
- provider metadata marking it as a custom/session-based account provider

The model list can be static in the first implementation. The implementation should keep model definitions isolated so future dynamic model discovery can be added without changing the executor contract.

### Credential shape

Each T3Chat account stores provider-specific data:

```json
{
  "cookies": "...",
  "convexSessionId": "..."
}
```

The generic API-key field is not used for T3Chat. UI and management APIs should treat T3Chat as a provider with a custom credential schema.

### Specialized executor

Add `T3ChatExecutor` under `open-sse/executors/t3chat.js` and register it in `open-sse/executors/index.js`.

The executor owns all T3Chat-specific behavior:

- credential extraction
- T3Chat payload construction
- `wreq-js` transport usage
- T3Chat headers
- T3Chat SSE-style text parser
- T3Chat-specific error mapping

This keeps cookie auth, `convexSessionId`, TLS impersonation, T3Chat payload shape, and parser quirks out of the default executor.

## Request Flow

1. A client calls an OpenAI-compatible 9Router endpoint, such as:

   ```http
   POST /v1/chat/completions
   ```

2. 9Router resolves the requested model to provider `t3chat`.

3. Existing account selection/fallback chooses one configured T3Chat account.

4. `T3ChatExecutor` converts the normalized request into a T3Chat request payload.

5. The executor sends a request to:

   ```txt
   https://t3.chat/api/chat
   ```

   using `wreq-js` with Chrome136 or the closest supported browser emulation mode.

6. The executor parses the T3Chat SSE-style response for text events.

7. The parsed text is returned to the normal 9Router response pipeline as assistant text.

## T3Chat Payload

The executor should follow the payload structure used by `t3router-py`:

```json
{
  "messages": [],
  "threadMetadata": { "id": "<uuid>", "title": "" },
  "clientAuth": { "isSignedIn": true },
  "responseMessageId": "<uuid>",
  "model": "<selected model>",
  "convexSessionId": "<credential convexSessionId>",
  "modelParams": {
    "reasoningEffort": "medium",
    "includeSearch": false,
    "searchLimit": 1
  },
  "preferences": {
    "name": "",
    "occupation": "",
    "selectedTraits": [],
    "additionalInfo": ""
  },
  "userConfiguration": {
    "codeFont": "berkeley",
    "currentModelParameters": {
      "includeSearch": false,
      "reasoningEffort": "medium"
    },
    "currentlySelectedModel": "<selected model>",
    "favoriteModels": [],
    "hasMigrated": true,
    "mainFont": "proxima",
    "streamerMode": false,
    "theme": "dark"
  },
  "userInfo": {
    "timezone": "America/New_York",
    "locale": "en-US"
  },
  "isEphemeral": false
}
```

The exact message conversion should follow the shape accepted by T3Chat and the patterns in `t3router-py` / `t3router`.

## Headers and Transport

Use these headers for chat requests:

```txt
Content-Type: application/json
Referer: https://t3.chat/chat/<thread_id>
Cookie: <credential cookies>
Origin: https://t3.chat
Accept: */*
```

`wreq-js` must be used as a direct npm dependency. The T3Chat transport should use Chrome136 impersonation or the closest supported browser emulation option available in `wreq-js`, matching the intent of:

- Python `curl_cffi` with `impersonate="chrome136"`
- Rust `wreq_util::Emulation::Chrome136`

If the `wreq-js` API differs from these examples, wrap it inside a small T3Chat transport helper so the executor does not spread library-specific details across multiple files.

## Response Parsing

The initial parser is text-only.

For each response line:

- Trim whitespace.
- Process only lines starting with `data:`.
- Stop on `data: [DONE]`.
- JSON-decode the data payload.
- If `type` is `text-delta` or `text`, append text from the first matching shape:
  - `delta` as a string
  - `delta.text`
  - `text`
  - each `content[].text`

If no parseable text is found, return a clear upstream response error.

## Error Handling

Map common failures to clear messages:

- `401` or `403`: T3Chat rejected the session. Ask the user to refresh cookies and `convexSessionId`.
- `429`: T3Chat rate limit or browser-fingerprint rejection. Ask the user to retry later and refresh credentials if it persists.
- other `>=400`: include upstream HTTP status in the error.
- transport error from `wreq-js`: include a clear network/TLS impersonation error message.
- missing `cookies` or `convexSessionId`: fail validation before sending the upstream request.

Quota fetch failures must not disable accounts and must not block chat requests.

## Account UI and Bulk Add

### Single account add/edit

The T3Chat provider connection UI should show custom fields:

- account label/name, following existing 9Router connection conventions
- `cookies` textarea
- `convexSessionId` text input

Validation:

- `cookies` is required.
- `convexSessionId` is required.
- leading/trailing whitespace is trimmed.
- cookies are stored as an opaque string.

### Bulk add

The T3Chat bulk add modal uses one account per line:

```txt
cookies_here | convex_session_id_here
cookies_here | convex_session_id_here
```

Parsing rules:

- Ignore empty lines.
- Split each non-empty line on the first `|`.
- Left side becomes `cookies`.
- Right side becomes `convexSessionId`.
- Trim both fields.
- A line is invalid if it has no delimiter or either field is empty.
- Report invalid lines with line number and reason.

Bulk import should use partial import semantics:

- valid lines are added
- invalid lines are reported in a summary
- the user can fix invalid lines and retry them

### Secret display

- Mask cookies in connection lists.
- Follow existing 9Router secret-editing behavior for whether existing secret values are displayed or replaced by placeholders in edit forms.
- Do not persist raw bulk input after the modal closes.

## QuotaTracker

QuotaTracker is observability/manual-periodic only. It does not gate requests and does not skip accounts before chat execution.

### Data sources

Use T3Chat tRPC endpoints based on `t3router/src/t3/usage.rs`:

- `getCustomerData`
- `getSubscriptionData`

Initial tracked fields:

- `subTier`
- `balance`
- `lifetimeBalance`
- `isBalanceReliable`
- `usageBand`
- `billingProvider`
- `usageFourHourPercentage`
- `usageMonthPercentage`
- `usagePeriodPercentage`
- `billingNextResetAt`
- `usageFourHourNextResetAt`
- `usageMonthNextResetAt`
- `usageWindowNextResetAt`
- `isPaid`

Optional later fields/endpoints:

- pricing products from `getPricingProducts`
- active sessions from `auth.getActiveSessions`

### Refresh behavior

Quota data can refresh through:

- manual dashboard action such as “Refresh quota”
- periodic dashboard-side refresh while the provider/usage page is open
- backend endpoint for refreshing one T3Chat account or all T3Chat accounts

Cache quota results per account with timestamp and status:

```json
{
  "lastCheckedAt": 1780000000000,
  "status": "ok",
  "data": {
    "balance": 123.4,
    "usageFourHourPercentage": 42,
    "usageMonthPercentage": 12,
    "subTier": "pro"
  }
}
```

On failure, store:

```json
{
  "lastCheckedAt": 1780000000000,
  "status": "error",
  "lastError": "Failed to refresh quota; cookies may be expired"
}
```

### UI integration

Prefer integrating T3Chat quota with existing provider limits/usage UI if the existing data model fits. If the current provider limits UI is too specialized, start with a T3Chat quota panel on the provider detail page and add broader usage-page integration later.

## Testing Plan

### Bulk parser tests

- Parses valid `cookies | convex_session_id` lines.
- Ignores empty lines.
- Reports missing delimiter.
- Reports empty cookies.
- Reports empty `convexSessionId`.
- Splits on the first `|` only.

### T3Chat response parser tests

- Parses `text-delta` with `delta` string.
- Parses `text-delta` with `delta.text`.
- Parses `text` with `text`.
- Parses `content[].text`.
- Stops at `[DONE]`.
- Errors if no text is found.

### Executor payload/header tests

- Payload includes `messages`, `threadMetadata.id`, `clientAuth.isSignedIn`, `responseMessageId`, `model`, `convexSessionId`, `modelParams`, `preferences`, `userConfiguration`, `userInfo`, and `isEphemeral`.
- Headers include `Cookie`, `Origin`, `Referer`, and `Content-Type`.
- Missing credentials fail before transport.

### QuotaTracker tests

- Parses normal tRPC response shapes.
- Parses JSONL/tRPC variants similar to Rust `extract_trpc_result`.
- Defaults missing fields safely.
- Stores error state without blocking chat runtime.

### Integration smoke tests

- Provider `t3chat` appears in registry/model lists.
- `T3ChatExecutor` is registered.
- `wreq-js` resolves from project dependencies.
- Lint/build/test commands remain clean.

## Acceptance Criteria

- Users can add T3Chat accounts with `cookies` and `convexSessionId`.
- Users can bulk add T3Chat accounts with `cookies | convex_session_id` lines.
- T3Chat models are visible and routable through 9Router OpenAI-compatible endpoints.
- T3Chat chat requests use `wreq-js` with browser/TLS impersonation.
- T3Chat request payload and headers match the intended T3Chat web API shape.
- Text-only T3Chat responses are parsed into assistant text.
- QuotaTracker can refresh and display T3Chat account quota/status.
- QuotaTracker failures do not block chat requests.
- Invalid credentials and upstream failures produce clear errors.
- Parser, payload, bulk add, quota, and integration smoke tests pass.
