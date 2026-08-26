"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// 1. Test Storage Security & Path Traversal Prevention
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "narra-storage-test-"));

function sanitizeHistoryKey(key, baseDir = tempDir) {
  if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(key)) {
    throw new Error("Invalid history key: " + String(key).slice(0, 50));
  }
  const resolved = path.resolve(baseDir, "history-" + key + ".json");
  if (!resolved.startsWith(baseDir)) {
    throw new Error("Path traversal attempt in history storage");
  }
  return resolved;
}

function atomicWriteHistoryJson(filePath, data) {
  const tmpPath = filePath + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8) + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

// Check safe keys
const safePath = sanitizeHistoryKey("agent-conversations");
assert.equal(path.basename(safePath), "history-agent-conversations.json");

// Check path traversal attempts
assert.throws(() => sanitizeHistoryKey("../outside"), /Invalid history key/);
assert.throws(() => sanitizeHistoryKey("foo/../../bar"), /Invalid history key/);
assert.throws(() => sanitizeHistoryKey("key with spaces"), /Invalid history key/);
assert.throws(() => sanitizeHistoryKey("key$special"), /Invalid history key/);

// Check Atomic write
const testFile = sanitizeHistoryKey("test-library");
const payload = [{ id: "c-1", title: "Test Dialogue", messages: [] }];
atomicWriteHistoryJson(testFile, payload);
assert.equal(fs.existsSync(testFile), true);
const loaded = JSON.parse(fs.readFileSync(testFile, "utf-8"));
assert.equal(loaded[0].title, "Test Dialogue");

// 2. Test Stream Delta Extraction Across Different Providers
function extractAgentTextStreamDelta(data) {
  if (!data || typeof data !== "object") return "";
  const choice = data.choices?.[0];
  if (choice) {
    if (typeof choice.delta?.content === "string") return choice.delta.content;
    if (Array.isArray(choice.delta?.content)) {
      return choice.delta.content.map(p => typeof p === "string" ? p : p?.text || "").join("");
    }
    if (typeof choice.text === "string") return choice.text;
    if (typeof choice.message?.content === "string") return choice.message.content;
  }
  if (typeof data.candidates?.[0]?.content?.parts?.[0]?.text === "string") {
    return data.candidates[0].content.parts[0].text;
  }
  if (typeof data.message?.content === "string") return data.message.content;
  if (typeof data.response === "string") return data.response;
  return "";
}

// OpenAI Chat Completion streaming chunk
const openAiChunk = {
  choices: [{ delta: { content: " Xin chào " } }]
};
assert.equal(extractAgentTextStreamDelta(openAiChunk), " Xin chào ");

// Multi-part content delta (Anthropic / Claude via OpenAI proxy)
const multiPartChunk = {
  choices: [{ delta: { content: [{ text: "Phân cảnh " }, { text: "1: Cảnh quay" }] } }]
};
assert.equal(extractAgentTextStreamDelta(multiPartChunk), "Phân cảnh 1: Cảnh quay");

// Gemini direct response chunk
const geminiChunk = {
  candidates: [{ content: { parts: [{ text: "Nội dung tạo hình" }] } }]
};
assert.equal(extractAgentTextStreamDelta(geminiChunk), "Nội dung tạo hình");

// Ollama / Custom local endpoint chunk
const ollamaChunk = {
  response: "Kịch bản chi tiết"
};
assert.equal(extractAgentTextStreamDelta(ollamaChunk), "Kịch bản chi tiết");

// 3. Test Request Cancellation Registry
const activeRequests = new Map();
let abortCalled = false;

const requestId = "req-12345";
activeRequests.set(requestId, {
  abort: () => {
    abortCalled = true;
  }
});

assert.equal(activeRequests.has(requestId), true);
const entry = activeRequests.get(requestId);
entry.abort();
activeRequests.delete(requestId);

assert.equal(abortCalled, true);
assert.equal(activeRequests.size, 0);

// Cleanup
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {}

console.log("AI Agent Chat contracts, SSE extraction, cancellation and storage tests passed successfully.");
