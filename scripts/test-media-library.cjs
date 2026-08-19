"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// 1. Direct Import of Production Security Module
const {
  ALLOWED_MEDIA_EXTENSIONS,
  getAllowedMediaDirectories,
  isPathInsideRealDirectory,
  validateMediaDeleteTarget,
} = require("../apps/desktop/src/electron/runtime/mediaSecurity");

// 2. Test Whitelist: MUST contain media, MUST NOT contain .json or system files
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".png"), true);
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".jpg"), true);
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".mp4"), true);
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".webm"), true);
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".json"), false, ".json MUST NOT be in media whitelist");
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".exe"), false);
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".bat"), false);
assert.equal(ALLOWED_MEDIA_EXTENSIONS.has(".env"), false);

// 3. Test Allowed Directories: MUST NOT include video-projects or downloads
const mockUserData = path.join(os.tmpdir(), "narra-test-user-data-" + Date.now());
const mockContext = {
  getImageOutputDir: () => path.join(mockUserData, "images"),
  getVideoOutputDir: () => path.join(mockUserData, "videos"),
  loadSettings: () => ({}),
  app: { getPath: (name) => (name === "userData" ? mockUserData : "") },
};

const allowedDirs = getAllowedMediaDirectories(mockContext);
assert.equal(allowedDirs.includes(path.resolve(path.join(mockUserData, "images"))), true);
assert.equal(allowedDirs.includes(path.resolve(path.join(mockUserData, "videos"))), true);
assert.equal(allowedDirs.some((d) => d.includes("video-projects")), false, "video-projects must not be in allowed media dirs");
assert.equal(allowedDirs.some((d) => d.includes("downloads")), false, "downloads must not be in allowed media dirs");

// 4. Test isPathInsideRealDirectory and Symlink Escape Protection
const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "narra-media-test-"));
const insideImagesDir = path.join(tempTestDir, "images");
const outsideDir = path.join(tempTestDir, "outside");
fs.mkdirSync(insideImagesDir, { recursive: true });
fs.mkdirSync(outsideDir, { recursive: true });

const validFile = path.join(insideImagesDir, "test.png");
fs.writeFileSync(validFile, "image content");

const outsideFile = path.join(outsideDir, "secret.png");
fs.writeFileSync(outsideFile, "secret content");

const traversalTarget = path.join(insideImagesDir, "..", "outside", "secret.png");

assert.equal(isPathInsideRealDirectory(validFile, insideImagesDir), true, "File inside images dir should be allowed");
assert.equal(isPathInsideRealDirectory(outsideFile, insideImagesDir), false, "File outside images dir should be rejected");
assert.equal(isPathInsideRealDirectory(traversalTarget, insideImagesDir), false, "Traversal target outside images dir should be rejected");

// Test symlink escape if OS supports creating symlinks
try {
  const symlinkPath = path.join(insideImagesDir, "symlink-escape.png");
  fs.symlinkSync(outsideFile, symlinkPath, "file");
  // Symlink points to outsideFile. Realpath check MUST detect that real file is outside and reject!
  assert.equal(isPathInsideRealDirectory(symlinkPath, insideImagesDir), false, "Symlink escape outside allowed dir MUST be rejected");
} catch (symlinkErr) {
  // On Windows, non-admin users might not have symlink creation privilege without developer mode; skip symlink creation if error
  if (symlinkErr.code !== "EPERM" && symlinkErr.code !== "EACCES") {
    throw symlinkErr;
  }
}

// 5. Test validateMediaDeleteTarget
const deleteContext = {
  getImageOutputDir: () => insideImagesDir,
  getVideoOutputDir: () => path.join(tempTestDir, "videos"),
  loadSettings: () => ({}),
  app: { getPath: () => tempTestDir },
};

// Case A: Valid image inside imageOutputDir -> Allowed
const resValid = validateMediaDeleteTarget(validFile, deleteContext);
assert.equal(resValid.valid, true, "Valid image in imageOutputDir should be allowed for deletion");

// Case B: .json project file inside imageOutputDir -> Rejected due to disallowed extension
const jsonFile = path.join(insideImagesDir, "project.json");
fs.writeFileSync(jsonFile, "{}");
const resJson = validateMediaDeleteTarget(jsonFile, deleteContext);
assert.equal(resJson.valid, false, ".json file must be rejected for deletion in Media Library");

// Case C: Outside file -> Rejected
const resOutside = validateMediaDeleteTarget(outsideFile, deleteContext);
assert.equal(resOutside.valid, false, "Outside file must be rejected");

// Cleanup temp test directory
try {
  fs.rmSync(tempTestDir, { recursive: true, force: true });
} catch {}

console.log("Production Media Library security & boundary tests passed successfully.");
