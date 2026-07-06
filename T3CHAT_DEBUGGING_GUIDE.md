# T3Chat Debugging Guide - Local vs Server Issues

## Problem

T3Chat works locally but returns HTTP 429 on server.

## Common Causes

### 1. **Browser Fingerprint Rejection** (Most Likely)

T3Chat uses advanced bot detection. wreq-js provides browser-like fingerprinting, but:

- Server IP might be flagged as suspicious (VPS/cloud IPs are often blocked)
- Server environment might have different TLS libraries
- wreq-js native binaries might not be compatible with server architecture

**Symptoms:**

- Works on local machine (residential IP)
- Fails on server with 429
- Same cookies/credentials on both

### 2. **IP Address Blocking**

T3Chat may block certain IP ranges:

- VPS/cloud provider IPs (AWS, DigitalOcean, etc.)
- Known datacenter ranges
- Non-residential IPs

### 3. **wreq-js Binary Compatibility**

wreq-js uses native modules that may not work on all architectures:

- Local: Windows x64
- Server: Linux x64, ARM, etc.
- Binary might not exist for server platform

### 4. **Network/Firewall Issues**

- Corporate firewall blocking wreq-js traffic
- Proxy interference
- Missing SSL/TLS certificates

## Debugging Steps

### Step 1: Run Environment Debug Script

**On Local Machine:**

```bash
node debug-t3chat-env.js > local-debug.txt
```

**On Server:**

```bash
node debug-t3chat-env.js > server-debug.txt
```

**Compare the outputs:**

- Node version differences?
- wreq-js module found on both?
- Test request succeeds on both?

### Step 2: Check Detailed Logs

The debugging we added will now show:

```
[T3CHAT-WREQ-DEBUG] Attempting to load wreq-js module...
[T3CHAT-WREQ-DEBUG] Node version: v20.x.x
[T3CHAT-WREQ-DEBUG] Platform: linux x64
[T3CHAT-WREQ-DEBUG] wreq-js module loaded
[T3CHAT-WREQ-DEBUG] Module keys: [...]
```

Look for:

- Does wreq-js load successfully?
- Are the module keys the same as local?
- Does it validate as wreq-js (not native fetch)?

### Step 3: Check Transport Layer Logs

```
[T3CHAT-TRANSPORT-DEBUG] Loading wreq-js...
[T3CHAT-TRANSPORT-DEBUG] wreq-js loaded successfully
[T3CHAT-TRANSPORT-DEBUG] Validated: Using wreq-js (not native fetch)
[T3CHAT-TRANSPORT-DEBUG] Making POST request to: https://t3.chat/api/chat
[T3CHAT-TRANSPORT-DEBUG] Browser fingerprint: chrome_136 / windows
[T3CHAT-TRANSPORT-DEBUG] Response status: 429
```

### Step 4: Check Executor Layer Logs

```
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

## Solutions

### Solution 1: Use Residential Proxy (Recommended)

If server IP is blocked, route T3Chat through a residential proxy:

```javascript
// In open-sse/executors/t3chatTransport.js
// Add proxy support to wreq-js calls
const response = await fetchFn(url, {
  method: "POST",
  headers: {...},
  body: JSON.stringify(json),
  browser: "chrome_136",
  os: "windows",
  timeout: this.timeoutMs,
  proxy: "http://residential-proxy-ip:port", // Add this
  signal,
});
```

### Solution 2: Verify wreq-js Installation on Server

```bash
# On server
cd /path/to/9router
npm list wreq-js
npm install wreq-js --force  # Rebuild native binaries
```

### Solution 3: Try Different wreq-js Browser Fingerprints

Edit `open-sse/executors/t3chatTransport.js`:

```javascript
// Try different combinations:
browser: "chrome_130",  // Older Chrome
browser: "firefox_120", // Firefox
os: "macos",           // Different OS
```

### Solution 4: Check if Cookies are Valid on Server

Cookies might have IP binding:

1. Export cookies from browser on server's IP
2. Use browser connected through server's IP address
3. Refresh cookies regularly

### Solution 5: Use SSH Tunnel (Temporary Testing)

Test if it's an IP issue:

```bash
# On local machine (where it works)
ssh -R 20127:localhost:20127 user@server

# Access from server via tunnel
curl http://localhost:20127/v1/chat/completions
```

If this works, the issue is definitely IP-based.

## Quick Diagnosis Table

| Symptom | Likely Cause | Solution |
| --------- | -------------- | ---------- |
| wreq-js fails to load | Binary incompatibility | Rebuild: `npm install wreq-js --force` |
| Loads but returns 429 | IP blocking | Use residential proxy |
| Works with tunnel | IP blocking confirmed | Use proxy permanently |
| Different module keys | Wrong wreq-js version | Check versions match |
| "detected native fetch" | wreq-js not loading | Check installation |

## Testing Checklist

- [ ] Run debug script on both local and server
- [ ] Compare Node versions (should be compatible)
- [ ] Verify wreq-js is installed on server
- [ ] Check server logs for [T3CHAT-DEBUG] messages
- [ ] Test with fresh cookies from server IP
- [ ] Try SSH tunnel test
- [ ] Check if server IP is in blocklist range
- [ ] Test with residential proxy

## Expected Debug Output (Working)

```
[T3CHAT-WREQ-DEBUG] Attempting to load wreq-js module...
[T3CHAT-WREQ-DEBUG] Node version: v20.11.0
[T3CHAT-WREQ-DEBUG] Platform: linux x64
[T3CHAT-WREQ-DEBUG] wreq-js module loaded
[T3CHAT-WREQ-DEBUG] Module keys: ['fetch', 'default', ...]
[T3CHAT-WREQ-DEBUG] wreq-js fetch function validated
[T3CHAT-TRANSPORT-DEBUG] Loading wreq-js...
[T3CHAT-TRANSPORT-DEBUG] wreq-js loaded successfully
[T3CHAT-TRANSPORT-DEBUG] Validated: Using wreq-js (not native fetch)
[T3CHAT-TRANSPORT-DEBUG] Making POST request to: https://t3.chat/api/chat
[T3CHAT-TRANSPORT-DEBUG] Response status: 200
```

## Next Steps

1. Run `node debug-t3chat-env.js` on both environments
2. Share the output to identify the exact difference
3. Based on logs, apply the appropriate solution
4. If still failing, the issue is likely IP-based blocking

## Contact

If you need help interpreting the logs, provide:

1. Output of debug script from both environments
2. Full [T3CHAT-DEBUG] logs from server
3. Server hosting provider (AWS, DigitalOcean, etc.)
4. Server location/region
