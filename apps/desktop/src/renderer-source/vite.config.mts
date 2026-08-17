import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const outputRoot =
  process.env.NARRA_SOURCE_RUNTIME_OUT_DIR ||
  fileURLToPath(new URL("../../dist-source-renderer/", import.meta.url));

export default defineConfig({
  root: sourceRoot,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": sourceRoot,
    },
  },
  build: {
    outDir: outputRoot,
    emptyOutDir: true,
  },
});
