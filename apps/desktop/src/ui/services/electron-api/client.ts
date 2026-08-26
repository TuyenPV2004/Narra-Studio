import type { NarraElectronApi } from "@/types/electron-api";

export function getElectronApi(): NarraElectronApi {
  if (!window.api) {
    throw new Error("Narra Electron preload API is unavailable.");
  }

  return window.api;
}
