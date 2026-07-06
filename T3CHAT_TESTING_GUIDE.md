# T3Chat Testing Guide - Quick Reference

## 🚀 Quick Start

Setelah perbaikan, test provider t3chat dengan command berikut:

## 📝 Test 1: Simple Text (Basic)

```bash
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

**Expected:** Normal text response tanpa error `[object Object]`

## 🔧 Test 2: Tool Calling

```bash
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/gpt-4o",
    "messages": [
      {"role": "user", "content": "What is 15 * 23?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "calculator",
          "description": "Perform mathematical calculations",
          "parameters": {
            "type": "object",
            "properties": {
              "expression": {
                "type": "string",
                "description": "Mathematical expression to evaluate"
              }
            },
            "required": ["expression"]
          }
        }
      }
    ]
  }'
```

**Expected:** Response dengan `tool_calls` array, bukan error atau text explanation

## 🧠 Test 3: Reasoning (o1/o3 models)

```bash
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/o1",
    "messages": [
      {"role": "user", "content": "If I have 5 apples and give away 2, then buy 3 more, how many do I have?"}
    ],
    "reasoning_effort": "high",
    "stream": true
  }'
```

**Expected:** SSE stream dengan `reasoning_content` deltas sebelum final answer

## 🎯 Test 4: Multi-turn Tool Conversation

```bash
# Step 1: Initial request
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/gpt-4o",
    "messages": [
      {"role": "user", "content": "What is the weather in San Francisco?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get current weather",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string"}
            },
            "required": ["location"]
          }
        }
      }
    ]
  }'

# Expected response: tool_calls with get_weather(location="San Francisco")

# Step 2: Send tool result
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/gpt-4o",
    "messages": [
      {"role": "user", "content": "What is the weather in San Francisco?"},
      {
        "role": "assistant",
        "content": "",
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\":\"San Francisco\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "call_abc123",
        "name": "get_weather",
        "content": "Sunny, 72°F (22°C), light breeze"
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get current weather",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {"type": "string"}
            },
            "required": ["location"]
          }
        }
      }
    ]
  }'
```

**Expected:** Model menggunakan tool result dan memberikan natural language answer

## 🖼️ Test 5: Multi-modal Content (Array Format)

```bash
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Describe this image"},
          {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
        ]
      }
    ]
  }'
```

**Expected:** Text extracted properly, NO `[object Object]` error

## ✅ Success Criteria

### ✅ Basic Text

- Response adalah valid JSON
- Tidak ada `[object Object]` di response
- Content adalah string yang readable

### ✅ Tool Calling

- Response memiliki `tool_calls` array
- `tool_calls[0].function.name` sesuai dengan tool yang diberikan
- `tool_calls[0].function.arguments` adalah valid JSON string
- `finish_reason` adalah `"tool_calls"`

### ✅ Reasoning

- SSE stream memiliki chunks dengan `delta.reasoning` atau `delta.reasoning_content`
- Final response memiliki `message.reasoning` field (non-streaming)
- Reasoning content adalah string yang readable

### ✅ Tool Results

- Tool messages dengan `role: "tool"` di-convert ke format yang benar
- Model dapat menggunakan tool results untuk generate final answer
- Conversation flow natural tanpa error

### ✅ Multi-modal

- Text di-extract dari array content
- Image URLs tidak menyebabkan error
- Tidak ada `[object Object]` di request ke t3chat

## ❌ Common Issues & Solutions

### Issue: `[object Object]` in response

**Cause:** Content tidak dinormalize dengan benar
**Fix:** ✅ Sudah diperbaiki dengan `normalizeContent()`

### Issue: Tools diabaikan, model jawab dengan text

**Cause:** Tool definitions tidak di-inject ke system prompt
**Fix:** ✅ Sudah diperbaiki dengan `ToolRegistry`

### Issue: Tool calls tidak di-parse

**Cause:** SSE events tidak di-handle
**Fix:** ✅ Sudah diperbaiki dengan SSE event handlers

### Issue: Reasoning tidak muncul

**Cause:** `reasoning-delta` events tidak di-handle
**Fix:** ✅ Sudah diperbaiki dengan reasoning handler

## 🔍 Debug Mode

Untuk melihat debug logs:

```bash
# Check 9router console logs untuk:
[T3CHAT-PAYLOAD-DEBUG] - Message transformation logs
[T3CHAT-DEBUG] - Request/response logs
```

Look for:

- Message count transformations
- Content normalization warnings
- Tool prompt injection logs
- SSE event parsing

## 📊 Quick Verification Checklist

```bash
# 1. Check syntax
node -c 9router/open-sse/executors/t3chatPayload.js
node -c 9router/open-sse/executors/t3chat.js
node -c 9router/open-sse/executors/t3chatTools.js

# 2. Verify files exist
ls -lh 9router/open-sse/executors/t3chat*.js

# 3. Check git status
cd 9router && git status --short | grep t3chat

# 4. Start 9router
npm run dev
# or
npm run dev:bun

# 5. Test basic request
curl http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d '{"model":"t3chat/gpt-4o","messages":[{"role":"user","content":"Hi"}]}'
```

## 🎉 Success

Jika semua test passed:

- ✅ No `[object Object]` errors
- ✅ Tool calling works
- ✅ Reasoning works
- ✅ Multi-modal content works
- ✅ Conversation flow natural

**Provider t3chat di 9router READY FOR USE! 🚀**

---

**Last Updated:** 2026-07-06T23:54:38Z
**Version:** 1.1 (with content normalization fix)
