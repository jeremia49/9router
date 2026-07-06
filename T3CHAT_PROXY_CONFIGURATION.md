# T3Chat Proxy Configuration Guide

## Overview

T3Chat requires proxy configuration when running on datacenter/VPS IPs because Vercel (where T3Chat is hosted) blocks non-residential IPs with their Security Checkpoint.

## Proxy Configuration Methods

There are **3 ways** to configure proxy for T3Chat (in priority order):

### Method 1: Per-Connection Proxy (Highest Priority)

Configure proxy settings in the provider connection's `providerSpecificData`.

**Via API:**

```bash
curl -X POST http://localhost:20127/api/providers \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "t3chat",
    "authType": "cookie",
    "name": "My T3Chat Account",
    "apiKey": "",
    "providerSpecificData": {
      "cookies": "your-t3chat-cookies",
      "convexSessionId": "your-convex-session-id",
      "connectionProxyEnabled": true,
      "connectionProxyUrl": "http://username:password@residential-proxy:port",
      "connectionNoProxy": "localhost,127.0.0.1"
    }
  }'
```

**Via Dashboard:**

1. Go to Providers page
2. Edit your T3Chat connection
3. Enable "Connection Proxy"
4. Enter proxy URL: `http://username:password@residential-proxy:port`
5. (Optional) Add no-proxy domains

**Advantages:**

- Different proxies for different T3Chat accounts
- Overrides environment variables
- Most flexible

### Method 2: T3CHAT_PROXY Environment Variable

Set a dedicated proxy for T3Chat only:

```bash
# Linux/Mac
export T3CHAT_PROXY=http://username:password@residential-proxy:port

# Windows
set T3CHAT_PROXY=http://username:password@residential-proxy:port

# Or add to .env file
T3CHAT_PROXY=http://username:password@residential-proxy:port
```

**Advantages:**

- T3Chat-specific, doesn't affect other providers
- Easy to change without editing code
- Good for single-proxy setups

### Method 3: HTTPS_PROXY Environment Variable

Use system-wide proxy:

```bash
# Linux/Mac
export HTTPS_PROXY=http://username:password@residential-proxy:port

# Windows
set HTTPS_PROXY=http://username:password@residential-proxy:port
```

**Advantages:**

- Works for all HTTPS traffic
- Standard environment variable
- Can be set system-wide

## Supported Proxy Types

wreq-js supports these proxy protocols:

1. **HTTP Proxy** (most common)

   ```
   http://proxy-host:port
   http://username:password@proxy-host:port
   ```

2. **HTTPS Proxy**

   ```
   https://proxy-host:port
   https://username:password@proxy-host:port
   ```

3. **SOCKS5 Proxy**

   ```
   socks5://proxy-host:port
   socks5://username:password@proxy-host:port
   ```

4. **SOCKS5H Proxy** (DNS resolved by proxy)

   ```
   socks5h://proxy-host:port
   socks5h://username:password@proxy-host:port
   ```

## Proxy Priority

When multiple proxy configurations exist, this is the priority order:

```
1. providerSpecificData.connectionProxyUrl (if connectionProxyEnabled=true)
2. T3CHAT_PROXY environment variable
3. HTTPS_PROXY environment variable
4. https_proxy environment variable (lowercase)
5. No proxy (direct connection)
```

## Verifying Proxy Configuration

### Check if proxy is being used

Look for these log messages when making a T3Chat request:

```
[T3CHAT-TRANSPORT-DEBUG] Using proxy from credentials: http://***@proxy-host:port
```

or

```
[T3CHAT-TRANSPORT-DEBUG] Using proxy from environment: http://***@proxy-host:port
```

### Test proxy with debug script

```bash
# Set proxy
export T3CHAT_PROXY=http://your-proxy:port

# Run test
node test-t3chat-connection.js
```

Expected output:

```
[T3CHAT-TRANSPORT-DEBUG] Using proxy from environment: http://***@proxy:port
[T3CHAT-TRANSPORT-DEBUG] Response status: 200
✓ Connection works!
```

## Recommended Residential Proxy Services

For bypassing Vercel Security Checkpoint, you need **residential proxies** (not datacenter):

### 1. Bright Data (brightdata.com)

- **Best for:** Reliability and scale
- **Cost:** ~$8.40/GB (Pay as you go)
- **Pros:** Largest proxy network, excellent uptime
- **Setup:**

  ```
  T3CHAT_PROXY=http://username-zone-residential:password@brd.superproxy.io:22225
  ```

### 2. Smartproxy (smartproxy.com)

- **Best for:** Balance of cost and quality
- **Cost:** ~$7/GB or $50/month (5GB)
- **Pros:** Good performance, user-friendly
- **Setup:**

  ```
  T3CHAT_PROXY=http://username:password@gate.smartproxy.com:7000
  ```

### 3. Oxylabs (oxylabs.io)

- **Best for:** Enterprise needs
- **Cost:** Custom pricing
- **Pros:** Very reliable, dedicated support
- **Setup:**

  ```
  T3CHAT_PROXY=http://username:password@pr.oxylabs.io:7777
  ```

### 4. IPRoyal (iproyal.com)

- **Best for:** Budget option
- **Cost:** ~$1.75/GB
- **Pros:** Affordable, decent quality
- **Setup:**

  ```
  T3CHAT_PROXY=http://username:password@geo.iproyal.com:12321
  ```

## Example Configurations

### Example 1: Single T3Chat Account with Environment Variable

```bash
# .env file
T3CHAT_PROXY=http://myuser:mypass@residential-proxy.com:8080

# Start 9router
npm start
```

### Example 2: Multiple T3Chat Accounts with Different Proxies

**Account 1:** (via API or Dashboard)

```json
{
  "name": "T3Chat US",
  "providerSpecificData": {
    "cookies": "...",
    "convexSessionId": "...",
    "connectionProxyEnabled": true,
    "connectionProxyUrl": "http://user:pass@us-proxy.com:8080"
  }
}
```

**Account 2:** (via API or Dashboard)

```json
{
  "name": "T3Chat EU",
  "providerSpecificData": {
    "cookies": "...",
    "convexSessionId": "...",
    "connectionProxyEnabled": true,
    "connectionProxyUrl": "http://user:pass@eu-proxy.com:8080"
  }
}
```

### Example 3: SOCKS5 Proxy

```bash
# For SOCKS5 proxy
export T3CHAT_PROXY=socks5://username:password@socks-proxy.com:1080

# For SOCKS5 with DNS resolution by proxy
export T3CHAT_PROXY=socks5h://username:password@socks-proxy.com:1080
```

## Troubleshooting

### Proxy not being used

Check logs for:

```
[T3CHAT-TRANSPORT-DEBUG] Making POST request to: https://t3.chat/api/chat
```

If you **don't see** a line about using proxy, check:

1. Is environment variable set? `echo $T3CHAT_PROXY`
2. Is connectionProxyEnabled=true in providerSpecificData?
3. Restart 9router after setting environment variables

### Proxy authentication failed

Error:

```
[T3CHAT-TRANSPORT-DEBUG] Request failed: 407 Proxy Authentication Required
```

**Solution:** Check username and password in proxy URL

### Proxy connection timeout

Error:

```
[T3CHAT-TRANSPORT-DEBUG] Request failed: connect ETIMEDOUT
```

**Solutions:**

1. Check proxy host and port are correct
2. Verify proxy service is running
3. Check firewall isn't blocking proxy connection
4. Try a different proxy server

### Still getting Vercel Security Checkpoint with proxy

```
[T3CHAT-DEBUG] *** VERCEL SECURITY CHECKPOINT DETECTED ***
```

**Possible causes:**

1. **Using datacenter proxy instead of residential** - Vercel detects datacenter IPs
2. **Proxy is blocked by Vercel** - Try a different proxy IP
3. **Proxy configuration not applied** - Check logs to confirm proxy is being used

**Solutions:**

1. Ensure you're using **residential** proxies, not datacenter
2. Try rotating to a different proxy IP
3. Use a premium proxy service with better IP reputation

## Security Notes

1. **Never commit proxy credentials to git**

   ```bash
   # Add to .gitignore
   .env
   .env.local
   ```

2. **Use environment variables for sensitive data**

   ```bash
   # Good
   T3CHAT_PROXY=http://user:pass@proxy.com:8080
   
   # Bad (hardcoded in config files)
   ```

3. **Rotate proxy IPs regularly** if service supports it

4. **Monitor proxy usage** to avoid unexpected costs

## Summary

- **Best method:** Per-connection proxy in providerSpecificData
- **Easiest method:** T3CHAT_PROXY environment variable
- **Required proxy type:** Residential (not datacenter)
- **Priority order:** Connection proxy > T3CHAT_PROXY > HTTPS_PROXY
- **Verify with:** Check logs for proxy usage messages

For more details on why proxy is needed, see: `VERCEL_SECURITY_CHECKPOINT_FIX.md`
