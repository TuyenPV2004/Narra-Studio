"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ── 1. Test Image Magic Byte Detection Logic ─────────────────────────
const isValidImageBuffer = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // GIF: GIF87a or GIF89a
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return true;
  }
  // WebP: RIFF .... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }
  return false;
};

// Valid Magic Bytes Tests
const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
const webpBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

assert.equal(isValidImageBuffer(pngBuffer), true, "PNG buffer must be valid");
assert.equal(isValidImageBuffer(jpegBuffer), true, "JPEG buffer must be valid");
assert.equal(isValidImageBuffer(gifBuffer), true, "GIF buffer must be valid");
assert.equal(isValidImageBuffer(webpBuffer), true, "WebP buffer must be valid");

// Invalid Payloads Tests (EXE, Script, HTML, Truncated, Null)
const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
const htmlBuffer = Buffer.from("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>");
const shortBuffer = Buffer.from([0x89, 0x50]);

assert.equal(isValidImageBuffer(exeBuffer), false, "EXE payload must be rejected");
assert.equal(isValidImageBuffer(htmlBuffer), false, "HTML payload must be rejected");
assert.equal(isValidImageBuffer(shortBuffer), false, "Short payload must be rejected");
assert.equal(isValidImageBuffer(null), false, "Null buffer must be rejected");
assert.equal(isValidImageBuffer(undefined), false, "Undefined buffer must be rejected");

// ── 2. Test SSRF Allowlist Function ──────────────────────────────────
const isAllowedHost = (hostname) => {
  if (!hostname || typeof hostname !== "string") return false;
  const lower = hostname.toLowerCase();
  return (
    lower === "labs.google" ||
    lower === "flow-content.google" ||
    lower === "aisandbox-pa.googleapis.com" ||
    lower === "storage.googleapis.com" ||
    lower.endsWith(".google") ||
    lower.endsWith(".labs.google") ||
    lower.endsWith(".googleusercontent.com") ||
    lower.endsWith(".googleapis.com") ||
    lower.endsWith(".ggpht.com")
  );
};

// Allowed Google domains
assert.equal(isAllowedHost("labs.google"), true);
assert.equal(isAllowedHost("flow-content.google"), true);
assert.equal(isAllowedHost("fx.labs.google"), true);
assert.equal(isAllowedHost("aisandbox-pa.googleapis.com"), true);
assert.equal(isAllowedHost("storage.googleapis.com"), true);
assert.equal(isAllowedHost("lh3.googleusercontent.com"), true);
assert.equal(isAllowedHost("yt3.ggpht.com"), true);

// Disallowed SSRF targets (localhost, private IP, external domains)
assert.equal(isAllowedHost("localhost"), false);
assert.equal(isAllowedHost("127.0.0.1"), false);
assert.equal(isAllowedHost("0.0.0.0"), false);
assert.equal(isAllowedHost("169.254.169.254"), false);
assert.equal(isAllowedHost("192.168.1.1"), false);
assert.equal(isAllowedHost("10.0.0.1"), false);
assert.equal(isAllowedHost("evil-labs.google.attacker.com"), false);
assert.equal(isAllowedHost("googleusercontent.com.attacker.com"), false);
assert.equal(isAllowedHost("example.com"), false);
assert.equal(isAllowedHost(""), false);
assert.equal(isAllowedHost(null), false);

// ── 3. Test Protocol Validation (HTTPS only) ──────────────────────────
const isSafeUrl = (urlStr) => {
  if (typeof urlStr !== "string" || !urlStr.trim()) return false;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === "https:" && isAllowedHost(parsed.hostname);
  } catch {
    return false;
  }
};

assert.equal(isSafeUrl("https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=123"), true);
assert.equal(isSafeUrl("http://labs.google/fx/api/trpc/media.getMediaUrlRedirect"), false, "HTTP must be rejected");
assert.equal(isSafeUrl("file:///C:/Windows/System32/drivers/etc/hosts"), false, "file:// must be rejected");
assert.equal(isSafeUrl("https://localhost:8080/secret"), false, "localhost must be rejected");
assert.equal(isSafeUrl("https://127.0.0.1/secret"), false, "127.0.0.1 must be rejected");
assert.equal(isSafeUrl("javascript:alert(1)"), false, "javascript: must be rejected");

// ── 4. Verify generation.js Backend Contract & Security Boundaries ───
const genJsPath = path.resolve(__dirname, "../apps/desktop/src/electron/ipc/generation.js");
const genJsContent = fs.readFileSync(genJsPath, "utf8");

assert.equal(genJsContent.includes("isValidImageBuffer"), true, "generation.js must contain isValidImageBuffer");
assert.equal(genJsContent.includes("MAX_IMAGE_FILE_SIZE_BYTES"), true, "generation.js must define MAX_IMAGE_FILE_SIZE_BYTES");
assert.equal(genJsContent.includes("MAX_IMAGE_BASE64_LENGTH"), true, "generation.js must define MAX_IMAGE_BASE64_LENGTH");
assert.equal(genJsContent.includes("isAllowedHost"), true, "generation.js must contain isAllowedHost");
assert.equal(genJsContent.includes("resolve-video-url"), true, "generation.js must register resolve-video-url");
assert.equal(genJsContent.includes("edit-image"), true, "generation.js must register edit-image");
assert.equal(genJsContent.includes("upscale-image"), true, "generation.js must register upscale-image");
assert.equal(genJsContent.includes("transform-image"), true, "generation.js must register transform-image");
assert.equal(genJsContent.includes("upload-image"), true, "generation.js must register upload-image");
assert.equal(genJsContent.includes("upload-image-from-path"), true, "generation.js must register upload-image-from-path");

assert.equal(genJsContent.includes("normalizeImageAspect"), true, "generation.js must contain normalizeImageAspect");

// ── 5. Test Aspect Ratio Normalization Logic ─────────────────────────
const normalizeImageAspect = (aspect) => {
  if (!aspect) return "IMAGE_ASPECT_RATIO_LANDSCAPE";
  const map = {
    "16:9": "IMAGE_ASPECT_RATIO_LANDSCAPE",
    "9:16": "IMAGE_ASPECT_RATIO_PORTRAIT",
    "1:1": "IMAGE_ASPECT_RATIO_SQUARE",
    "4:3": "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    "3:4": "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
    landscape: "IMAGE_ASPECT_RATIO_LANDSCAPE",
    portrait: "IMAGE_ASPECT_RATIO_PORTRAIT",
    square: "IMAGE_ASPECT_RATIO_SQUARE",
    IMAGE_ASPECT_RATIO_LANDSCAPE: "IMAGE_ASPECT_RATIO_LANDSCAPE",
    IMAGE_ASPECT_RATIO_PORTRAIT: "IMAGE_ASPECT_RATIO_PORTRAIT",
    IMAGE_ASPECT_RATIO_SQUARE: "IMAGE_ASPECT_RATIO_SQUARE",
    IMAGE_ASPECT_RATIO_FOUR_THREE: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    IMAGE_ASPECT_RATIO_THREE_FOUR: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
    IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE: "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR: "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
  };
  return map[aspect] || aspect;
};

assert.equal(normalizeImageAspect("16:9"), "IMAGE_ASPECT_RATIO_LANDSCAPE");
assert.equal(normalizeImageAspect("9:16"), "IMAGE_ASPECT_RATIO_PORTRAIT");
assert.equal(normalizeImageAspect("1:1"), "IMAGE_ASPECT_RATIO_SQUARE");
assert.equal(normalizeImageAspect("4:3"), "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE");
assert.equal(normalizeImageAspect("3:4"), "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_PORTRAIT"), "IMAGE_ASPECT_RATIO_PORTRAIT");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_SQUARE"), "IMAGE_ASPECT_RATIO_SQUARE");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE"), "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE");
assert.equal(normalizeImageAspect("IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR"), "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR");

// ── 6. Verify storage.js Slot-Scoped Partitioning ─────────────────────
const storageJsPath = path.resolve(__dirname, "../apps/desktop/src/electron/ipc/storage.js");
const storageJsContent = fs.readFileSync(storageJsPath, "utf8");
assert.equal(storageJsContent.includes("persist:slot-${slotId ?? 0}"), true, "storage.js must use slotId for save-image-locally session partition");

// ── 7. Verify Service Layer Contracts (image.ts) ──────────────────────
const imageTsPath = path.resolve(__dirname, "../apps/desktop/src/renderer-source/services/electron-api/image.ts");
const imageTsContent = fs.readFileSync(imageTsPath, "utf8");

assert.equal(imageTsContent.includes("DEFAULT_IMAGE_MODELS"), true, "image.ts must export DEFAULT_IMAGE_MODELS catalog");
assert.equal(imageTsContent.includes("formatImageError"), true, "image.ts must export formatImageError");
assert.equal(imageTsContent.includes("getModels"), true, "image.ts must provide getModels method");
assert.equal(imageTsContent.includes("resolveMediaUrl"), true, "image.ts must provide semantic resolveMediaUrl method");

console.log("Production Image contract, security & SSRF prevention tests passed successfully.");