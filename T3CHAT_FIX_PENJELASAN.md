# Perbaikan Error T3Chat - Penjelasan Lengkap

## Masalah Utama yang Diperbaiki

### 🔴 PALING PENTING: T3Chat Hanya Mendukung Role `user` dan `assistant`

**Penyebab:**
T3Chat adalah interface chat berbasis web yang HANYA menerima 2 role:

- `user` - pesan dari pengguna
- `assistant` - pesan dari AI

Role lain seperti `system`, `tool`, `function` akan menyebabkan error **HTTP 400** atau **HTTP 500**.

**Solusi yang Diterapkan:**
Semua role lain dikonversi menjadi `user` dengan prefix untuk menjaga konteks:

| Role Asli | Dikonversi Menjadi | Contoh |
| ----------- | ------------------- | --------- |
| `system` | `user` | `[System instruction]: You are helpful` |
| `tool` | `user` | `[Tool result]: {"data": "value"}` |
| `function` | `user` | `[Function result]: Success` |
| `user` | `user` (tidak berubah) | `Hello there` |
| `assistant` | `assistant` (tidak berubah) | `Hi, how can I help?` |

**Kode yang diubah:** `open-sse/executors/t3chatPayload.js` fungsi `toT3ChatMessages()`

---

### 🔴 Error "Response body is already used"

**Penyebab:**
Response stream SSE dikonsumsi dua kali:

1. Saat logging headers
2. Saat mengembalikan response untuk streaming

**Solusi:**

- Log headers tanpa membaca body
- Cek content-type untuk deteksi SSE (`text/event-stream`)
- Kembalikan response object langsung untuk streaming tanpa memanggil `.text()`

**Kode yang diubah:** `open-sse/executors/t3chatTransport.js` method `post()`

---

### 🟡 HTTP 500 "An unexpected error occurred"

**Penyebab:**
Payload request tidak valid atau tidak sesuai format T3Chat.

**Solusi:**

- Validasi messages array tidak kosong sebelum dikirim
- Validasi setiap message memiliki struktur yang benar (id, role, parts)
- Skip message yang tidak valid (null, undefined, tanpa content)
- Tambah logging detail untuk debugging

**Kode yang diubah:** `open-sse/executors/t3chatPayload.js` fungsi `buildT3ChatPayload()`

---

### 🟡 HTTP 400 "Invalid request parameters"

**Penyebab:**
Message tidak memiliki field yang diperlukan atau struktur yang salah.

**Solusi:**

- Validasi null/undefined pada message objects
- Skip message dengan content kosong (kecuali assistant)
- Pastikan setiap message T3Chat memiliki:
  - `id` (UUID)
  - `role` (`user` atau `assistant` saja)
  - `parts` (array dengan minimal satu item)
  - `attachments` (array, bisa kosong)

---

## Cara Testing

### 1. Test Otomatis

Jalankan test untuk verifikasi perbaikan:

```bash
# Test transformasi dan validasi message
node test-t3chat-fixes.js

# Test konversi role (PENTING!)
node test-t3chat-roles.js
```

Kedua test harus menunjukkan semua ✅ PASSED.

### 2. Contoh Test Role Conversion

```javascript
// Input
const messages = [
  { role: "system", content: "You are a helpful assistant" },
  { role: "user", content: "What is 2+2?" },
  { role: "assistant", content: "2+2 equals 4" },
  { role: "tool", content: '{"calculation": "4"}' }
];

// Output setelah transformasi
// Semua role selain assistant jadi user dengan prefix
[
  { role: "user", parts: [{ text: "[System instruction]: You are a helpful assistant" }] },
  { role: "user", parts: [{ text: "What is 2+2?" }] },
  { role: "assistant", parts: [{ text: "2+2 equals 4" }] },
  { role: "user", parts: [{ text: '[Tool result]: {"calculation": "4"}' }] }
]
```

### 3. Cek Log Debug

Saat server berjalan, perhatikan log berikut:

```
[T3CHAT-PAYLOAD-DEBUG] Transformed 4 input messages to 4 T3Chat messages
[T3CHAT-PAYLOAD-DEBUG] First message role: user parts count: 1
[T3CHAT-PAYLOAD-DEBUG] Last message role: assistant
[T3CHAT-TRANSPORT-DEBUG] Streaming SSE response detected
```

Jika muncul log di atas, berarti fix bekerja dengan baik.

---

## Masalah yang Mungkin Masih Terjadi

### ❌ Masih Error HTTP 500?

**Kemungkinan:**

- Cookies sudah expired
- convexSessionId tidak valid

**Solusi:**

1. Buka t3.chat di browser
2. Buka DevTools (F12) → tab Network
3. Kirim chat message
4. Cari request ke `/api/chat`
5. Copy Cookie header dan convex-session-id yang baru
6. Update credentials di 9router

### ❌ Masih Error HTTP 400?

**Kemungkinan:**

- Message masih memiliki struktur yang salah
- Field yang diperlukan hilang

**Solusi:**

1. Cek log `[T3CHAT-DEBUG] Payload structure:`
2. Pastikan `messagesCount > 0`
3. Pastikan tidak ada message dengan role selain `user`/`assistant`
4. Jalankan `node test-t3chat-roles.js` untuk verifikasi

### ❌ Error "Response body is already used" masih muncul?

**Kemungkinan:**

- Node.js version terlalu lama
- wreq-js tidak terinstall dengan benar

**Solusi:**

```bash
# Cek Node.js version (minimal 18+)
node --version

# Reinstall wreq-js
npm install wreq-js --force
```

### ⚠️ HTTP 429 (Rate Limit / Vercel Checkpoint)?

**Kemungkinan:**

- IP server terdeteksi sebagai datacenter/bot oleh Vercel
- Bukan masalah T3Chat, tapi proteksi Vercel

**Solusi:**

1. Gunakan residential proxy:

   ```bash
   export T3CHAT_PROXY=http://proxy-anda:port
   ```

2. Atau SSH tunnel dari komputer lokal:

   ```bash
   ssh -R 20127:localhost:20127 user@server
   ```

---

## File yang Dimodifikasi

1. **`open-sse/executors/t3chatPayload.js`**
   - ✅ Konversi semua role ke `user`/`assistant`
   - ✅ Tambah prefix untuk context
   - ✅ Validasi message structure
   - ✅ Debug logging

2. **`open-sse/executors/t3chatTransport.js`**
   - ✅ Fix response body consumption
   - ✅ Deteksi SSE via content-type
   - ✅ Safe header logging

3. **`open-sse/executors/t3chat.js`**
   - ✅ Parse error JSON
   - ✅ Contextual error messages
   - ✅ Payload structure logging

---

## Contoh Request yang Valid

```json
{
  "model": "gemini-2.5-flash",
  "messages": [
    {
      "role": "user",
      "content": "Halo, apa kabar?"
    }
  ],
  "stream": true
}
```

## Contoh Request yang TIDAK Valid (akan menyebabkan error)

```json
{
  "model": "gemini-2.5-flash",
  "messages": [
    {
      "role": "system",  // ❌ SALAH! T3Chat tidak terima role system
      "content": "You are helpful"
    }
  ],
  "stream": true
}
```

Tapi setelah fix ini, request di atas akan otomatis dikonversi menjadi valid:

```json
{
  "messages": [
    {
      "role": "user",  // ✅ Dikonversi jadi user
      "parts": [{ 
        "type": "text", 
        "text": "[System instruction]: You are helpful" 
      }]
    }
  ]
}
```

---

## Status Perbaikan

| Error | Status | Keterangan |
| ------- | -------- | ------------ |
| Role tidak didukung | ✅ Fixed | Semua role dikonversi ke user/assistant |
| Response body used | ✅ Fixed | SSE detection via content-type |
| HTTP 500 | ✅ Fixed | Validasi payload lengkap |
| HTTP 400 | ✅ Fixed | Struktur message divalidasi |
| Error messages | ✅ Improved | Parse JSON + contextual hints |

**Tanggal:** 2026-07-06  
**Status:** ✅ Semua fix selesai  
**Testing:** ✅ Automated tests passed  
**Verifikasi User:** Menunggu testing dengan real API calls

---

## Kesimpulan

**Yang Paling Penting:**
T3Chat hanya menerima role `user` dan `assistant`. Semua role lain (system, tool, function) sekarang otomatis dikonversi ke `user` dengan prefix yang sesuai.

**Cara Verifikasi Fix Bekerja:**

```bash
node test-t3chat-roles.js
```

Harus menunjukkan:

```
✅ PASSED: All messages use only 'user' or 'assistant' roles
✅ Assistant messages: 1 (expected: 1)
✅ User messages: 5 (expected: 5)
```

Jika semua ✅, berarti fix bekerja dengan benar!
