# T3Chat + Vercel Security Checkpoint Issue

## Root Cause Identified

The error message shows:

```html
<!DOCTYPE html><html lang="en" data-astro-cid-nbv56vs3>
<title>Vercel Security Checkpoint</title>
```

**This is NOT T3Chat blocking you - it's Vercel's bot protection!**

T3Chat is hosted on Vercel, and Vercel's security layer is blocking your server's requests before they reach T3Chat.

## Why It Works Locally But Not on Server

- **Local**: Residential IP, normal browser patterns → Passes Vercel security
- **Server**: Datacenter IP, automated patterns → Triggers Vercel security checkpoint

## Vercel Security Checkpoint Detection Criteria

Vercel blocks requests based on:

1. **IP reputation** - Datacenter/VPS IPs are flagged
2. **TLS fingerprint** - Detects non-browser clients
3. **Request patterns** - Automated/rapid requests
4. **Missing browser signals** - No cookies, strange headers

Even with wreq-js providing browser-like fingerprinting, Vercel has additional checks that detect server environments.

## Solutions

### Solution 1: Enhanced wreq-js Headers (Try This First)

Add more browser-like headers to bypass Vercel:

Edit `open-sse/executors/t3chatPayload.js`:

```javascript
export function buildT3ChatHeaders({ cookies, threadId }) {
  return {
    Accept: "text/event-stream",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "application/json",
    Cookie: cookies,
    Host: "t3.chat",
    Origin: "https://t3.chat",
    Pragma: "no-cache",
    Referer: "https://t3.chat/",
    "Sec-Ch-Ua": '"Chromium";v="136", "Google Chrome";v="136", "Not=A?Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "X-Convex-Client": "npm-0.20.0",
    "X-Thread-Id": threadId,
  };
}
```

### Solution 2: Use Residential Proxy (Most Reliable)

Vercel's bot protection is very aggressive. The most reliable solution is a residential proxy.

**Setup:**

1. Get a residential proxy service (Bright Data, Smartproxy, etc.)
2. Configure wreq-js to use it:

Edit `open-sse/executors/t3chatTransport.js` in the `post()` method:

```javascript
async post(url, { headers, json, signal } = {}) {
  const fetchFn = await this.getFetch();
  
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(json),
    browser: "chrome_136",
    os: "windows",
    timeout: this.timeoutMs,
    signal,
  };
  
  // Add residential proxy for Vercel bypass
  const proxy = process.env.T3CHAT_PROXY;
  if (proxy) {
    console.log("[T3CHAT-TRANSPORT-DEBUG] Using residential proxy");
    options.proxy = proxy;
  }
  
  const response = await fetchFn(url, options);
  // ... rest
}
```

Then set environment variable:

```bash
export T3CHAT_PROXY=http://residential-proxy:port
# Or in .env file
T3CHAT_PROXY=http://username:password@residential-proxy:port
```

### Solution 3: Vercel Request Headers from Browser

Sometimes Vercel checks for specific cookies/headers set by its security challenge.

**Get these from a real browser:**

1. Open browser on your server (VNC/remote desktop)
2. Visit <https://t3.chat>
3. Complete any security challenges
4. Export ALL cookies including Vercel's security cookies
5. Check for cookies like: `__vercel_cache_*`, `_vercel_jwt`, etc.

### Solution 4: Slower Request Rate

Vercel may block rapid automated requests. Add delays:

```javascript
// In your calling code
await new Promise(resolve => setTimeout(resolve, 2000)); // 2 sec delay
const response = await fetch('/v1/chat/completions', ...);
```

### Solution 5: Different Browser Fingerprint

Try different wreq-js fingerprints that Vercel might trust more:

```javascript
// In t3chatTransport.js post() method
browser: "firefox_120",  // Instead of chrome_136
os: "macos",            // Instead of windows
```

### Solution 6: Use Cloudflare Workers Proxy

If you have a Cloudflare account, create a worker that proxies to T3Chat:

```javascript
// Cloudflare Worker
export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = 't3.chat';
    
    return fetch(url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  }
}
```

Then point your requests to the worker URL instead.

## Quick Test

Run this to see the full Vercel checkpoint page:

```bash
node test-t3chat-connection.js
```

Look for the HTML response - if you see "Vercel Security Checkpoint", that confirms it.

## Recommended Approach

**Best Solution:** Use a residential proxy

**Why?**

- Vercel's bot protection is designed to block datacenter IPs
- Even perfect browser fingerprinting won't help with IP reputation
- Residential proxies appear as legitimate home users
- This is the same reason it works on your local machine

**Proxy Services:**

- Bright Data (brightdata.com) - Most reliable
- Smartproxy (smartproxy.com) - Good balance
- Oxylabs (oxylabs.io) - Enterprise grade
- Or rent a residential VPS (rare but possible)

## Why This Is Different From Rate Limiting

**Real rate limiting:** Returns JSON with error message

```json
{"error": "rate_limit_exceeded", "retry_after": 60}
```

**Vercel Security Checkpoint:** Returns HTML page

```html
<!DOCTYPE html>
<title>Vercel Security Checkpoint</title>
```

Your server is getting the HTML page, which means Vercel is intercepting the request before it reaches T3Chat's API.

## Final Recommendation

Since you're getting the Vercel Security Checkpoint:

1. **Short-term:** Use SSH tunnel from your local machine (where it works)

   ```bash
   ssh -R 20127:localhost:20127 user@server
   ```

2. **Long-term:** Set up a residential proxy
   - This is the only reliable solution for datacenter/VPS hosting
   - Cost: ~$50-100/month for residential proxy service
   - Alternative: Move 9router to a residential connection

The issue is NOT with wreq-js - wreq-js is working correctly. The issue is Vercel's security layer detecting your server's datacenter IP as non-residential.
