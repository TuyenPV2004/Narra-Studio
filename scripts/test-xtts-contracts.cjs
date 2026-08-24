"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const ipcPath = path.join(root, "apps/desktop/src/electron/ipc/xtts.js");
const { isAudioHeader } = require(ipcPath);
assert.equal(isAudioHeader(Buffer.from("RIFF0000WAVEfmt ", "ascii")), true);
assert.equal(isAudioHeader(Buffer.from("plain text is not audio", "utf8")), false);
const preload = read("apps/desktop/src/electron/preload.js");
const voiceApi = read("apps/desktop/src/renderer-source/services/electron-api/voice.ts");
const settingsApi = read("apps/desktop/src/renderer-source/services/electron-api/settings.ts");
const settingsPage = read("apps/desktop/src/renderer-source/pages/Settings/SettingsPage.tsx");
const page = read("apps/desktop/src/renderer-source/pages/Voice/VoicePage.tsx");
const queue = read("apps/desktop/src/renderer-source/pages/Voice/useVoiceQueue.ts");
const audioCard = read("apps/desktop/src/renderer-source/components/audio/VoiceAudioCard.tsx");
const styles = read("apps/desktop/src/renderer-source/styles/components.css");
const storageKeys = read("apps/desktop/src/renderer-source/storage/keys.ts");
const architecture = read("docs/Kien_truc_Runtime_Narra_Local.md");
const worker = read("apps/desktop/src/electron/runtime/xtts-worker.py");
const ipc = read("apps/desktop/src/electron/ipc/xtts.js");
const storageIpc = read("apps/desktop/src/electron/ipc/storage.js");
const support = read("apps/desktop/src/electron/runtime/support.js");
assert.match(preload, /xttsGenerate/);
assert.match(preload, /onXttsProgress/);
assert.match(preload, /xttsReleaseReferences/);
assert.doesNotMatch(preload, /xttsPrepare/);
assert.match(preload, /getVoiceOutputPath/);
assert.match(preload, /changeVoiceOutputFolder/);
assert.match(voiceApi, /XTTS_LANGUAGES/);
assert.match(voiceApi, /XTTS_PRESET_VOICES/);
assert.match(voiceApi, /importReferences/);
assert.match(voiceApi, /releaseReferences/);
assert.match(voiceApi, /onProgress/);
const presetVoiceNames = Array.from(
  voiceApi.matchAll(/name:\s*"([^"]+)",\s*gender:\s*"(?:female|male)"/g),
  (match) => match[1],
);
assert.equal(presetVoiceNames.length, 58);
assert.equal(new Set(presetVoiceNames).size, 58);
assert.match(voiceApi, /name:\s*"Claribel Dervla",\s*gender:\s*"female"/);
assert.match(voiceApi, /name:\s*"Sofia Hellen",\s*gender:\s*"female"/);
assert.match(voiceApi, /name:\s*"Tammy Grit",\s*gender:\s*"female"/);
assert.match(voiceApi, /name:\s*"Craig Gutsy",\s*gender:\s*"male"/);
assert.match(page, /Giọng dựng sẵn/);
assert.match(page, /Nhân bản giọng/);
assert.match(page, /PresetVoiceLabel/);
assert.match(page, /Venus/);
assert.match(page, /Mars/);
assert.match(page, /voice\.useCases\.join\(", "\)/);
assert.match(page, /setTaskName\(""\)/);
assert.match(page, /referencePaths: references\.map/);
assert.match(page, /Thêm giọng mẫu/);
assert.match(page, /completedSegments/);
assert.match(page, /storageKeys\.voiceDraft/);
assert.match(storageKeys, /voiceDraft/);
assert.match(page, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
assert.match(page, /Đang xử lý đoạn/);
assert.doesNotMatch(page, /status\.device|cudaName|torchVersion|source-voice-runtime/);
assert.doesNotMatch(page, /Tìm theo tên hoặc mục đích/);
assert.match(page, /Chọn 1–5 bản ghi của cùng một người/);
assert.match(page, /releaseDraftReferences/);
assert.match(page, /onValueChange={changeMode}/);
assert.match(page, /aria-labelledby="voice-mode-label"/);
assert.match(page, /aria-labelledby="voice-preset-label"/);
assert.match(page, /aria-labelledby="voice-language-label"/);
assert.doesNotMatch(page, /voiceApi\.prepare|Cài XTTS-v2|Đang cài đặt/);
assert.doesNotMatch(page, /Tôi có quyền sử dụng|source-voice-consent|setConsent|\bconsent\b/);
assert.doesNotMatch(page, /hybrid|Thiết kế giọng|value="vi"/i);
assert.match(settingsApi, /changeVoiceOutputFolder/);
assert.match(settingsPage, /label="Voice"/);
assert.match(storageIpc, /voiceOutputPaths: trustedPaths/);
assert.match(support, /app\.getPath\('music'\), 'Narra Studio', 'Voice'/);
assert.match(support, /function getVoiceOutputRoots/);
assert.match(support, /'xtts-v2', 'output'/);
assert.match(queue, /active >= 20/);
assert.match(queue, /voiceApi\.cancel/);
assert.match(queue, /voiceApi\.onProgress/);
assert.match(queue, /findOldestQueuedTask/);
assert.match(queue, /for \(let index = tasks\.length - 1; index >= 0; index -= 1\)/);
assert.match(queue, /startedAt: Date\.now\(\)/);
assert.match(queue, /segmentIndex: progress\.segmentIndex/);
assert.match(queue, /releaseUnusedReferences/);
assert.match(queue, /Tác vụ bị gián đoạn/);
assert.match(worker, /tts_models\/multilingual\/multi-dataset\/xtts_v2/);
assert.match(worker, /device = "cuda" if torch\.cuda\.is_available\(\) else "cpu"/);
assert.match(worker, /TTS\(MODEL_NAME\)\.to\(device\)/);
assert.match(worker, /validate_request\(request, details\["speakers"\], details\["languages"\]\)/);
assert.match(worker, /"split_sentences": False/);
assert.match(worker, /"speaker_wav"/);
assert.match(worker, /"speaker"/);
assert.match(worker, /MAX_REFERENCE_FILES = 5/);
assert.match(worker, /weights_only=True/);
assert.match(worker, /generation_plan/);
assert.match(worker, /checkpoint\.json/);
assert.match(worker, /concatenate_wavs/);
assert.match(worker, /split_into_sentences/);
assert.doesNotMatch(worker, /runtime\.json|read_marker|write_marker/);
assert.doesNotMatch(worker, /--download/);
assert.doesNotMatch(worker, /hybrid|offload|OmniVoice/i);
assert.match(ipc, /COQUI_TOS_AGREED: '1'/);
assert.doesNotMatch(ipc, /pip.*install|coqui-tts==|transformers>=/);
assert.match(ipc, /taskkill/);
assert.match(ipc, /multiSelections/);
assert.match(ipc, /MAX_REFERENCE_TOTAL_BYTES/);
assert.match(ipc, /xtts-progress/);
assert.match(ipc, /xtts-release-references/);
assert.match(ipc, /reference_release_completed/);
assert.match(ipc, /currentStatus\.languages\?\.includes\(language\)/);
assert.doesNotMatch(ipc, /ipcMain\.handle\('xtts-prepare'/);
assert.match(ipc, /getVoiceOutputRoots/);
assert.match(ipc, /const outputDir = \(\) => getVoiceOutputDir\(\)/);
assert.doesNotMatch(ipc, /const outputDir = \(\) => path\.join\(runtimeRoot\(\), 'output'\)/);
assert.doesNotMatch(ipc, /hybrid|omnivoice/i);
assert.match(audioCard, /addEventListener\("error"/);
assert.match(audioCard, /source-voice-playback-error/);
assert.match(styles, /source-voice-speed-input:focus-visible/);
assert.match(styles, /prefers-reduced-motion: reduce/);
assert.match(architecture, /split_sentences=False/);

async function testCancelWhileWorkerStarts() {
  const handlers = new Map();
  const spawnCalls = [];
  let nextPid = 2000;
  const spawnProcess = (command, args) => {
    spawnCalls.push({ command, args });
    const proc = new EventEmitter();
    proc.pid = nextPid++;
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = { write: (_value, callback) => callback?.() };
    proc.kill = () => true;
    if (args.includes("--check")) setImmediate(() => { proc.stdout.write(`${JSON.stringify({ installed: true, device: "cpu", speakers: ["Ana Florence"], languages: ["en"] })}\n`); proc.emit("close", 0); });
    else if (command === "taskkill") setImmediate(() => proc.emit("close", 0));
    return proc;
  };
  const register = require(ipcPath);
  const testOutputDir = path.join(root, ".test-voice-output");
  register({ app: { getPath: () => path.join(root, ".test-xtts-runtime"), once: () => undefined }, dialog: {}, fs: { existsSync: (value) => !String(value).startsWith(testOutputDir), mkdirSync: () => undefined, rmSync: () => undefined }, getVoiceOutputDir: () => testOutputDir, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, path, pathToFileURL, shell: {}, spawnProcess });
  const requestId = "12345678-1234-4123-8123-123456789abc";
  const generation = handlers.get("xtts-generate")(null, { language: "en", mode: "preset", requestId, speaker: "Ana Florence", speed: 1, taskName: "cancel-startup", text: "Cancel startup test." });
  const rejected = assert.rejects(generation, /đã bị hủy/);
  for (let attempt = 0; attempt < 50 && !spawnCalls.some((call) => call.args.includes("--serve")); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(spawnCalls.some((call) => call.args.includes("--serve")));
  assert.deepEqual(await handlers.get("xtts-cancel")(null, { requestId }), { cancelled: true });
  await rejected;
}

async function testReferenceReleaseBoundary() {
  const handlers = new Map();
  const testHome = fs.mkdtempSync(path.join(root, ".test-xtts-release-"));
  const referenceDir = path.join(testHome, "xtts-v2", "references");
  const releasable = path.join(referenceDir, "releasable.wav");
  const retained = path.join(referenceDir, "retained.wav");
  const outside = path.join(testHome, "outside.wav");
  fs.mkdirSync(referenceDir, { recursive: true });
  fs.writeFileSync(releasable, Buffer.from("RIFF0000WAVEfmt ", "ascii"));
  fs.writeFileSync(retained, Buffer.from("RIFF0000WAVEfmt ", "ascii"));
  fs.writeFileSync(outside, Buffer.from("RIFF0000WAVEfmt ", "ascii"));
  try {
    require(ipcPath)({
      app: { getPath: () => testHome, once: () => undefined },
      dialog: {},
      fs,
      getVoiceOutputDir: () => path.join(testHome, "output"),
      getVoiceOutputRoots: () => [path.join(testHome, "output")],
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      path,
      pathToFileURL,
      shell: {},
    });
    assert.deepEqual(
      await handlers.get("xtts-release-references")(null, {
        referencePaths: [releasable],
      }),
      { removed: 1 },
    );
    assert.equal(fs.existsSync(releasable), false);
    assert.equal(fs.existsSync(retained), true);
    await assert.rejects(
      handlers.get("xtts-release-references")(null, {
        referencePaths: [outside],
      }),
      /không thuộc thư viện/,
    );
    assert.equal(fs.existsSync(outside), true);
  } finally {
    fs.rmSync(testHome, { recursive: true, force: true });
  }
}

testCancelWhileWorkerStarts()
  .then(testReferenceReleaseBoundary)
  .then(() => console.log("XTTS-v2 contracts passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
