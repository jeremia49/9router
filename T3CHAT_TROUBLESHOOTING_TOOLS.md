# T3Chat Troubleshooting Tools

## Problem Summary

T3Chat works on your local machine but returns HTTP 429 on your server. This is typically caused by:

1. **IP-based blocking** (most common) - T3Chat blocks datacenter/VPS IPs
2. **wreq-js compatibility issues** - Native binaries not working on server architecture
3. **Cookie/credential issues** - Cookies tied to specific IP addresses
4. **Firewall/network issues** - Server network blocking wreq-js traffic

## Quick Start

### 1. Run Environment Debug (Both Machines)

**On your local machine (where it works):**

```bash
node debug-t3chat-env.js > local-debug.txt
cat local-debug.txt
```

**On your server (where it fails):**

```bash
node debug-t3chat-env.js > server-debug.txt
cat server-debug.txt
```

### 2. Run Connection Test (Both Machines)

**On your local machine:**

```bash
node test-t3chat-connection.js > local-test.txt
cat local-test.txt
```

**On your server:**

```bash
node test-t3chat-connection.js > server-test.txt
cat server-test.txt
```

### 3. Compare Results

Compare the outputs side-by-side:

```bash
# Look for differences
diff local-debug.txt server-debug.txt
diff local-test.txt server-test.txt
```

## Interpreting Results

### Scenario A: wreq-js Fails to Load on Server

```
[T3CHAT-WREQ-DEBUG] Failed to load wreq-js: Cannot find module 'wreq-js'
```

**Solution:**

```bash
cd /path/to/9router
npm install wreq-js --force
# Or if using different architecture
npm rebuild wreq-js
```

### Scenario B: wreq-js Loads but Returns 429

```
[T3CHAT-TRANSPORT-DEBUG] Response status: 429
DIAGNOSIS:
✗ Rate limit / Fingerprint rejection
  LIKELY CAUSES:
  1. Server IP is blocked by T3Chat
```

**Solution:** Your server IP is blocked. Use a residential proxy.

### Scenario C: Different Module Keys

```
Local:  Module keys: ['fetch', 'default', 'version']
Server: Module keys: ['default']
```

**Solution:** Different wreq-js versions or incomplete installation. Reinstall:

```bash
npm uninstall wreq-js
npm install wreq-js@latest
```

### Scenario D: Works with Valid Credentials Locally, 429 on Server

**Solution:** IP-based blocking confirmed. You need a residential proxy.

## Solutions

### Solution 1: Use Residential Proxy (Most Common Fix)

If your server is on a VPS/cloud provider (AWS, DigitalOcean, Hetzner, etc.), T3Chat likely blocks your IP.

**Option A: Configure HTTP Proxy (Environment Variables)**

```bash
export HTTPS_PROXY=http://residential-proxy-ip:port
export HTTP_PROXY=http://residential-proxy-ip:port
# Restart 9router
```

**Option B: Add Proxy Support to T3ChatTransport**

Edit `open-sse/executors/t3chatTransport.js`:

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
  
  // Add proxy if configured
  const proxyUrl = process.env.T3CHAT_PROXY || process.env.HTTPS_PROXY;
  if (proxyUrl) {
    console.log("[T3CHAT-TRANSPORT-DEBUG] Using proxy:", proxyUrl);
    options.proxy = proxyUrl;
  }
  
  const response = await fetchFn(url, options);
  // ... rest of code
}
```

**Option C: Use SOCKS5 Proxy**

```bash
export ALL_PROXY=socks5://residential-proxy-ip:port
```

### Solution 2: Verify wreq-js Installation

```bash
# Check if wreq-js is installed
npm list wreq-js

# Reinstall with force (rebuilds native binaries)
npm install wreq-js --force

# Check if native addon loads
node -e "import('wreq-js').then(m => console.log('OK:', Object.keys(m)))"
```

### Solution 3: Use SSH Tunnel for Testing

Test if issue is IP-based:

```bash
# On local machine (run this in one terminal)
ssh -R 20127:localhost:20127 user@your-server

# On server (in another terminal)
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"minimax-m3","messages":[{"role":"user","content":"test"}]}'
```

If this works, the problem is definitely your server's IP.

### Solution 4: Get Cookies from Server IP

Sometimes cookies are IP-bound. Generate fresh cookies:

1. Use a browser on the server (or via VNC/remote desktop)
2. Log in to <https://t3.chat>
3. Export cookies from that browser session
4. Update your 9router credentials with the new cookies

### Solution 5: Try Different Server Location

If you can't use a proxy, try deploying to a different region:

- Some regions have stricter blocking
- Residential IP ranges vary by location
- US/EU residential IPs may work better than Asia datacenters

## Debug Logs Explained

When you make a request, you'll now see detailed logs:

```
[T3CHAT-WREQ-DEBUG] Attempting to load wreq-js module...
[T3CHAT-WREQ-DEBUG] Node version: v20.11.0
[T3CHAT-WREQ-DEBUG] Platform: linux x64
[T3CHAT-WREQ-DEBUG] wreq-js module loaded
[T3CHAT-WREQ-DEBUG] Module keys: ['fetch', 'default']
[T3CHAT-WREQ-DEBUG] wreq-js fetch function validated

[T3CHAT-TRANSPORT-DEBUG] Loading wreq-js...
[T3CHAT-TRANSPORT-DEBUG] wreq-js loaded successfully
[T3CHAT-TRANSPORT-DEBUG] Validated: Using wreq-js (not native fetch)

[T3CHAT-TRANSPORT-DEBUG] Making POST request to: https://t3.chat/api/chat
[T3CHAT-TRANSPORT-DEBUG] Browser fingerprint: chrome_136 / windows
[T3CHAT-TRANSPORT-DEBUG] Timeout: 60000 ms
[T3CHAT-TRANSPORT-DEBUG] Response status: 429
[T3CHAT-TRANSPORT-DEBUG] Response headers: {...}

[T3CHAT-DEBUG] Request Headers: {...}
[T3CHAT-DEBUG] Request Model: minimax-m3
[T3CHAT-DEBUG] Response Status: 429
[T3CHAT-DEBUG] Rate Limit/Fingerprint Rejection:
[T3CHAT-DEBUG] - This usually means:
[T3CHAT-DEBUG]   1. Browser fingerprint not recognized (wreq-js issue)
[T3CHAT-DEBUG]   2. IP address blocked/suspicious
[T3CHAT-DEBUG]   3. Cookies expired or invalid
[T3CHAT-DEBUG]   4. Rate limit exceeded
```

## Disable Debug Logs (After Fixing)

Once you've identified and fixed the issue, you can remove the debug logs:

```bash
# Search for all debug logs
grep -r "T3CHAT.*DEBUG" open-sse/executors/

# Or comment them out in:
# - open-sse/executors/t3chatTransport.js
# - open-sse/executors/t3chat.js
```

## Getting Help

If you're still stuck, provide:

1. **Output of debug script** from both local and server:

   ```bash
   node debug-t3chat-env.js
   ```

2. **Output of connection test** from both:

   ```bash
   node test-t3chat-connection.js
   ```

3. **Full error logs** from 9router with [T3CHAT-DEBUG] lines

4. **Server details:**
   - Hosting provider (AWS, DigitalOcean, Hetzner, etc.)
   - Server location/region
   - OS and architecture (`uname -a`)

5. **Confirm:**
   - Does it work locally? (Yes/No)
   - Same cookies on both? (Yes/No)
   - Have you tried SSH tunnel test? (Yes/No)

## Summary

The most common issue is **IP-based blocking**. T3Chat actively blocks known datacenter IP ranges. The solution is to:

1. Use a residential proxy, OR
2. Deploy to a server with a residential IP, OR
3. Use SSH tunneling through your local machine

Run the debug scripts to confirm this is your issue, then implement the appropriate solution.
