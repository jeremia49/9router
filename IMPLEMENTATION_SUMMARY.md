# T3Chat wreq-js Enforcement Implementation

## Date: 2026-07-06

## Objective

Enforce that the T3Chat provider MUST use wreq-js HTTP client exclusively and cannot fallback to any other HTTP library (native fetch, axios, got, undici, etc.).

## Changes Made

### 1. T3ChatTransport Validation (`./open-sse/executors/t3chatTransport.js`)

**Enhanced `loadWreqFetch()` function:**

- Added try-catch block to catch module loading errors
- Validates that wreq-js loaded correctly and returns a function
- Throws descriptive error if wreq-js is not installed
- Throws descriptive error if wreq-js fails to load properly

**Enhanced `T3ChatTransport.getFetch()` method:**

- Added validation to ensure loaded fetch is wreq-js, not native fetch
- Compares against `globalThis.fetch` and `global.fetch`
- Throws error if non-wreq fetch is detected

**Added comprehensive documentation:**

- JSDoc header explaining the strict wreq-js requirement
- Lists forbidden HTTP clients (fetch, axios, got, node-fetch, undici)
- Explains the three validation layers

### 2. T3ChatExecutor Validation (`./open-sse/executors/t3chat.js`)

**Added JSDoc documentation:**

- Header comment explaining wreq-js requirement
- Warning against modifying to use other HTTP clients
- Reference to T3ChatTransport validation

**Enhanced `execute()` method:**

- Added comment marking the wreq-js validation section
- Added `instanceof` check to ensure transport is T3ChatTransport
- Throws error if transport is not a T3ChatTransport instance
- Prevents bypass attempts using mock objects

### 3. Documentation (`./open-sse/executors/T3CHAT_WREQ_REQUIREMENT.md`)

Created comprehensive documentation covering:

- Overview of the wreq-js requirement
- Why T3Chat needs wreq-js (bot detection, TLS fingerprinting)
- Implementation details for both classes
- All possible error messages with explanations
- Installation instructions
- Testing guidelines
- Related files reference
- Warning against modifications

### 4. Test Updates (`./tests/unit/t3chat-executor.test.js`)

**Fixed existing tests:**

- Updated mock transports to be actual T3ChatTransport instances
- Changed from plain objects `{ post: fn }` to proper instances
- Ensures tests use the real class structure

**Added new test:**

- "enforces T3ChatTransport instance (wreq-js requirement)"
- Verifies that non-T3ChatTransport objects are rejected
- Confirms error message is correct

## Validation Layers

The implementation has **4 layers** of validation:

### Layer 1: Module Loading

```javascript
async function loadWreqFetch() {
  try {
    const mod = await import("wreq-js");
    // Validates module loaded correctly
  } catch (error) {
    // Catches missing module errors
  }
}
```

### Layer 2: Function Validation

```javascript
if (!fetchFn || typeof fetchFn !== "function") {
  throw new Error("wreq-js failed to load properly");
}
```

### Layer 3: Native Fetch Detection

```javascript
if (this.fetchFn === globalThis.fetch || this.fetchFn === global.fetch) {
  throw new Error("detected non-wreq fetch");
}
```

### Layer 4: Instance Validation

```javascript
if (!(transport instanceof T3ChatTransport)) {
  throw new Error("MUST use T3ChatTransport with wreq-js");
}
```

## Error Messages

All error messages clearly state:

1. What went wrong
2. What is required (wreq-js)
3. How to fix it (install command)

Examples:

- `"T3Chat provider MUST use wreq-js HTTP client. wreq-js is not installed. Install it with: npm install wreq-js"`
- `"T3Chat provider requires wreq-js but it failed to load properly. Install wreq-js: npm install wreq-js"`
- `"T3Chat provider detected non-wreq fetch. T3Chat MUST use wreq-js exclusively. Check wreq-js installation."`
- `"T3Chat provider MUST use T3ChatTransport with wreq-js. Detected invalid transport instance."`

## Test Results

All 5 tests passing:

```
✓ is registered by provider id
✓ posts through transport and returns parsed text response (non-streaming)
✓ returns streaming response when stream=true
✓ maps auth and rate-limit errors clearly
✓ enforces T3ChatTransport instance (wreq-js requirement)
```

## Files Modified

1. `./open-sse/executors/t3chatTransport.js` - Added validation and documentation
2. `./open-sse/executors/t3chat.js` - Added executor-level validation
3. `./tests/unit/t3chat-executor.test.js` - Updated tests and added new test
4. `./open-sse/executors/T3CHAT_WREQ_REQUIREMENT.md` - New documentation file
5. `./IMPLEMENTATION_SUMMARY.md` - This file

## Dependencies

Verified in `package.json`:

```json
{
  "dependencies": {
    "wreq-js": "^2.3.1"
  }
}
```

## Security Considerations

This enforcement prevents:

- Accidental use of non-browser-like HTTP clients
- T3Chat requests being rejected due to incorrect fingerprinting
- Silent fallback to native fetch that would fail
- Bypass attempts using mock objects in production

## Maintenance Notes

**DO NOT:**

- Remove any of the validation layers
- Allow fallback to other HTTP clients
- Bypass the instanceof checks
- Use plain objects instead of T3ChatTransport instances

**ALWAYS:**

- Keep wreq-js as a dependency
- Test with actual T3ChatTransport instances
- Update documentation if T3Chat requirements change
- Maintain all four validation layers

## Conclusion

The T3Chat provider is now strictly enforced to use wreq-js exclusively. All validation layers are in place, tests are passing, and comprehensive documentation has been added.
