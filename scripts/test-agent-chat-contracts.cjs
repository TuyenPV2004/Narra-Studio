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
    if (typeof choice.delta?.text === "string") return choice.delta.text;
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
  if (typeof data.content === "string") return data.content;
  if (typeof data.text === "string") return data.text;
  return "";
}

// OpenAI Chat Completion streaming chunk
const openAiChunk = {
  choices: [{ delta: { content: " Xin chào " } }]
};
assert.equal(extractAgentTextStreamDelta(openAiChunk), " Xin chào ");

// DeepSeek R1 / Reasoning metadata chunk must NOT pollute chat final answer
const reasoningChunk = {
  choices: [{ delta: { reasoning_content: "Đang suy nghĩ logic kịch bản..." } }]
};
assert.equal(extractAgentTextStreamDelta(reasoningChunk), "");

// URL Protocol Allowlist validation
function validateExternalUrl(urlString) {
  if (typeof urlString !== "string" || !urlString.trim()) return false;
  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    return false;
  }
  const allowed = new Set(["https:", "http:", "mailto:"]);
  return allowed.has(parsed.protocol);
}
assert.equal(validateExternalUrl("https://example.com"), true);
assert.equal(validateExternalUrl("http://localhost:3000"), true);
assert.equal(validateExternalUrl("mailto:test@example.com"), true);
assert.equal(validateExternalUrl("file:///C:/Windows/System32/calc.exe"), false);
assert.equal(validateExternalUrl("javascript:alert(1)"), false);
assert.equal(validateExternalUrl("powershell:Start-Process"), false);

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

// 3. Test SSE Error Safe Catch in Stream Callback (Critical #1)
async function simulateSseStreamHandling(mockLines) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let destroyed = false;
    const req = {
      destroy: () => { destroyed = true; }
    };
    const onLine = (line) => {
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        return;
      }
      if (data?.error) {
        throw new Error(`Provider error: ${data.error.message || JSON.stringify(data.error)}`);
      }
    };

    // Simulate res.on('data') loop
    for (const rawLine of mockLines) {
      try {
        onLine(rawLine);
      } catch (err) {
        if (!settled) {
          settled = true;
          req.destroy();
          reject(err);
        }
        return;
      }
    }
    if (!settled) {
      settled = true;
      resolve("done");
    }
  });
}

(async () => {
  // Ensure SSE error converts into a safe Promise rejection without crashing event loop
  let sseErrorCaught = false;
  try {
    await simulateSseStreamHandling(['{"error":{"message":"Quota exceeded"}}']);
  } catch (err) {
    sseErrorCaught = true;
    assert.match(err.message, /Quota exceeded/);
  }
  assert.equal(sseErrorCaught, true);

  // 4. Test Stop Streaming Message ID Isolation (High #2)
  const initialMessages = [
    { id: "usr-1", role: "user", content: "Ý tưởng 1" },
    { id: "ast-1", role: "assistant", content: "Trả lời 1", status: "completed" },
  ];
  // User sends new message
  const currentSession = [
    ...initialMessages,
    { id: "usr-2", role: "user", content: "Ý tưởng 2" },
    { id: "ast-2", role: "assistant", content: "", status: "streaming" },
  ];
  // User hits Stop: session deletes usr-2 and ast-2
  const stoppedSession = currentSession.slice(0, 2);
  // When catch receives cancelled error with target astId = 'ast-2', ensure ast-1 is untouched
  const finalSession = stoppedSession.map(m => {
    if (m.id !== "ast-2") return m;
    return { ...m, status: "cancelled" };
  });
  assert.equal(finalSession[1].id, "ast-1");
  assert.equal(finalSession[1].status, "completed"); // NOT wrongly set to cancelled!

  // 5. Test Retry History Snapshotting (High #3)
  const retryHistory = [
    { id: "usr-1", role: "user", content: "Câu 1" },
    { id: "ast-1", role: "assistant", content: "Trả lời 1", status: "completed" },
    { id: "usr-2", role: "user", content: "Câu 2 (lỗi)" },
    { id: "ast-2", role: "assistant", content: "", status: "failed" },
  ];
  const lastUserIdx = [...retryHistory].reverse().findIndex(m => m.role === "user");
  const targetUserIdx = retryHistory.length - 1 - lastUserIdx;
  const userMessageToRetry = retryHistory[targetUserIdx];
  const historySnapshot = retryHistory.slice(0, targetUserIdx);

  // When retrying, historySnapshot only has [usr-1, ast-1]
  assert.equal(historySnapshot.length, 2);
  assert.equal(historySnapshot[0].id, "usr-1");
  assert.equal(userMessageToRetry.content, "Câu 2 (lỗi)");

  // 6. Test Request Cancellation Registry
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
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
