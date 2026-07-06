# T3Chat Tool Calling & Reasoning Support Fix

## Ringkasan Perubahan

Implementasi t3chat di 9router telah diperbaiki untuk mendukung:

1. **Tool Calling** - Function calling melalui text-based protocol dan native SSE events
2. **Reasoning** - Extended thinking/reasoning melalui reasoning-delta events
3. **Tool Messages** - Proper handling untuk tool result messages dalam conversation history
4. **Non-streaming Tool Calls** - Support tool calls pada non-streaming requests

## File yang Diubah/Ditambahkan

### 1. `9router/open-sse/executors/t3chatTools.js` (BARU)

Implementasi lengkap untuk tool calling support:

- `ToolRegistry` - Manajemen tool definitions dan konversi ke system prompt
- `ToolCallTranslator` - Parsing `tool:<name>` blocks dari model response
- `ToolRefusalDetector` - Deteksi false refusal dari model
- `ToolCallDeltaAccumulator` - Akumulasi streaming tool call deltas
- Helper functions untuk parsing dan normalisasi tool calls

### 2. `9router/open-sse/executors/t3chatPayload.js` (DIUBAH)

**Perubahan:**

- Import `ToolRegistry` dari t3chatTools.js
- `toT3ChatMessages()` sekarang menerima parameter `systemPrompt`
- System prompt diinjeksi di awal conversation untuk tool definitions
- Tool messages (`role: "tool"`) sekarang di-convert dengan proper formatting: `[Tool result: {name}]\n{content}`
- Assistant messages dengan `tool_calls` dikonversi kembali ke `tool:` text blocks untuk t3chat
- System messages tidak lagi duplikat (skip jika sudah ada di systemPrompt)

**Sebelum:**

```javascript
// System messages ditambahkan sebagai user content
if (role === "system") {
  textContent = content; // No prefix for system - just merge it
}
// Tool messages kehilangan context
if (role === "tool") {
  textContent = `[Tool result: ${content}]`;
}
// Tool calls dari assistant hilang
```

**Sesudah:**

```javascript
// System prompt dihandle terpisah via parameter
if (systemPrompt) {
  accumulatedUserContent.push(systemPrompt);
}
// Tool messages dengan proper name
if (role === "tool") {
  const toolName = message.name ?? message.tool_call_id ?? "tool";
  textContent = `[Tool result: ${toolName}]\n${content || "[tool returned no output]"}`;
}
// Tool calls di-convert ke text blocks
if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
  const blocks = [];
  for (const tc of toolCalls) {
    const fnName = tc.function?.name ?? "";
    const argsStr = tc.function?.arguments ?? "";
    // ... konversi ke ```tool:name``` blocks
  }
}
```

### 3. `9router/open-sse/executors/t3chatParserFull.js` (BARU)

Parser lengkap untuk T3Chat SSE responses:

- Parse text deltas
- Parse reasoning deltas
- Parse tool call start events (`tool-input-start`)
- Parse tool call arguments (`tool-input-available`)
- Parse finish reason
- Return struktur lengkap: `{ text, reasoning, toolCalls, finishReason }`

### 4. `9router/open-sse/executors/t3chat.js` (DIUBAH)

**Perubahan pada streaming:**

- Menambahkan handler untuk `reasoning-delta` events
- Menambahkan handler untuk `tool-input-start` events
- Menambahkan handler untuk `tool-input-available` events
- Setiap event di-convert ke format OpenAI yang sesuai

**Reasoning support:**

```javascript
if (value.type === "reasoning-delta") {
  const reasoningText = value.text || value.delta || "";
  if (reasoningText) {
    const reasoningChunk = {
      // ... OpenAI chunk format
      choices: [{
        delta: { 
          reasoning: reasoningText,
          reasoning_content: reasoningText 
        },
      }],
    };
  }
}
```

**Tool call support:**

```javascript
if (value.type === "tool-input-start") {
  // Send tool_calls delta with id, name
  delta: {
    tool_calls: [{
      index: 0,
      id: value.id,
      type: "function",
      function: { name: value.name, arguments: "" }
    }]
  }
}
if (value.type === "tool-input-available") {
  // Send arguments delta
  delta: {
    tool_calls: [{
      index: 0,
      function: { arguments: value.input || "" }
    }]
  }
}
```

**Perubahan pada non-streaming:**

- Menggunakan `parseT3ChatFullResponse()` untuk requests dengan tools
- Mengembalikan completion dengan `tool_calls` array jika ada
- Mengembalikan `reasoning` fields jika ada
- Proper `finish_reason` (`tool_calls` vs `stop`)

## Cara Kerja

### Flow untuk Tool Calling

1. **Client sends request dengan tools:**

```json
{
  "model": "t3chat/gpt-4o",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": { "type": "object", "properties": {...} }
      }
    }
  ]
}
```

1. **9router transforms untuk t3chat:**
   - `ToolRegistry` membuat system prompt dengan tool definitions
   - System prompt diinjeksi sebagai bagian dari first user message
   - Messages di-convert ke format t3chat (user/assistant only)

2. **T3Chat model response:**
   - Model bisa emit native tool calls via SSE events (`tool-input-start`, `tool-input-available`)
   - Atau model bisa emit text dengan `tool:<name>` blocks (text-based protocol)

3. **9router converts back to OpenAI format:**
   - SSE events di-transform ke OpenAI streaming chunks dengan `tool_calls` deltas
   - Text blocks di-parse dan di-convert ke proper `tool_calls` array
   - Reasoning events di-forward sebagai `reasoning_content`

4. **Client receives standard OpenAI response:**

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "",
      "tool_calls": [
        {
          "id": "call_123",
          "type": "function",
          "function": {
            "name": "get_weather",
            "arguments": "{\"location\":\"San Francisco\"}"
          }
        }
      ]
    },
    "finish_reason": "tool_calls"
  }]
}
```

1. **Client sends tool results:**

```json
{
  "messages": [
    {"role": "user", "content": "What's the weather?"},
    {"role": "assistant", "tool_calls": [...]},
    {"role": "tool", "tool_call_id": "call_123", "name": "get_weather", "content": "Sunny, 72°F"}
  ]
}
```

1. **9router converts tool messages:**
   - `role: "tool"` → dijadikan user message dengan prefix: `[Tool result: get_weather]\nSunny, 72°F`
   - Assistant tool_calls → di-convert kembali ke `tool:` blocks jika perlu round-trip

## Testing

Untuk test implementasi ini:

```bash
# Test dengan tool calling
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/gpt-4o",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "calculator",
        "description": "Perform calculation",
        "parameters": {
          "type": "object",
          "properties": {
            "expression": {"type": "string"}
          },
          "required": ["expression"]
        }
      }
    }],
    "stream": true
  }'

# Test dengan reasoning
curl -X POST http://localhost:20127/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "t3chat/o1",
    "messages": [{"role": "user", "content": "Solve this math puzzle: ..."}],
    "reasoning_effort": "high",
    "stream": true
  }'
```

## Kompatibilitas

Perubahan ini **backward compatible**:

- Request tanpa tools tetap bekerja seperti sebelumnya
- Text-only conversations tidak terpengaruh
- Model yang tidak support tool calling akan tetap return text response

## Perbedaan dengan pi-t3chat

9router implementation berbeda dengan pi-t3chat dalam beberapa hal:

- **pi-t3chat**: Proxy standalone yang inject tool definitions di proxy level
- **9router**: Provider integration yang inject tool definitions di payload level
- **pi-t3chat**: Support MCP wrapper tools
- **9router**: Belum implement MCP wrapper (bisa ditambahkan nanti jika perlu)
- **pi-t3chat**: Implement false refusal correction dengan retry
- **9router**: Tidak implement retry loop (delegasi ke client untuk handle)

## Referensi

- pi-t3chat implementation: `pi-t3chat/proxy.ts`, `pi-t3chat/tools.ts`
- Text-based tool calling protocol: Inspired by NoTokenLimit VS Code extension
- OpenAI tool calling format: <https://platform.openai.com/docs/guides/function-calling>
