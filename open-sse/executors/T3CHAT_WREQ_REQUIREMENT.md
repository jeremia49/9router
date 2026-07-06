# T3Chat Provider - wreq-js Requirement

## Overview

The T3Chat provider **MUST** use `wreq-js` as its HTTP client. This is a hard requirement and cannot be changed.

## Why wreq-js?

T3Chat employs advanced bot detection that checks:

- TLS fingerprints (JA3/JA4)
- Browser-like HTTP/2 characteristics
- Request headers and timing patterns
- User-Agent and browser fingerprinting

Standard HTTP clients like native `fetch`, `axios`, `got`, or `undici` will be **rejected** by T3Chat's anti-bot system.

Only `wreq-js` provides the necessary browser-like fingerprinting to bypass these checks.

## Implementation Details

### T3ChatTransport Class

Location: `./open-sse/executors/t3chatTransport.js`

This class is responsible for:

1. Loading `wreq-js` dynamically
2. Validating that `wreq-js` loaded correctly
3. Ensuring no fallback to native fetch or other HTTP clients
4. Providing GET/POST methods with browser fingerprinting

### T3ChatExecutor Class

Location: `./open-sse/executors/t3chat.js`

This executor:

1. Uses `T3ChatTransport` exclusively
2. Validates the transport instance is correct
3. Never calls the base executor's HTTP methods

## Error Messages

If wreq-js is not available, you'll see one of these errors:

```
T3Chat provider MUST use wreq-js HTTP client.
wreq-js is not installed. Install it with: npm install wreq-js
```

```
T3Chat provider requires wreq-js but it failed to load properly.
Install wreq-js: npm install wreq-js
```

```
T3Chat provider detected non-wreq fetch.
T3Chat MUST use wreq-js exclusively. Check wreq-js installation.
```

```
T3Chat provider MUST use T3ChatTransport with wreq-js.
Detected invalid transport instance.
```

## Installation

Ensure `wreq-js` is in your dependencies:

```bash
npm install wreq-js
```

Check `package.json`:

```json
{
  "dependencies": {
    "wreq-js": "^2.3.1"
  }
}
```

## DO NOT Modify

**⚠️ WARNING**: Do not attempt to:

- Replace `wreq-js` with native fetch
- Use axios, got, node-fetch, or undici for T3Chat
- Remove the validation checks
- Bypass the T3ChatTransport class

These modifications will cause T3Chat requests to fail with 403/429 errors.

## Testing

To verify wreq-js is working:

```javascript
import { T3ChatTransport } from './t3chatTransport.js';

const transport = new T3ChatTransport();
// This will throw if wreq-js is not available
await transport.getFetch();
console.log('✓ wreq-js loaded successfully');
```

## Related Files

- `./open-sse/executors/t3chat.js` - Main executor
- `./open-sse/executors/t3chatTransport.js` - Transport layer (wreq-js wrapper)
- `./open-sse/executors/t3chatPayload.js` - Request payload builder
- `./open-sse/executors/t3chatParser.js` - Response parser
- `./open-sse/providers/registry/t3chat.js` - Provider configuration

## Support

If you encounter issues with wreq-js:

1. Ensure it's installed: `npm list wreq-js`
2. Check the version: Should be 2.3.1 or higher
3. Verify no other HTTP client is interfering
4. Check console for detailed error messages
