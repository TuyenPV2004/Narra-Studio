/// <reference types="vite/client" />

interface NarraBridge {
  readonly runtime: 'electron';
  readonly version: number;
}

interface Window {
  readonly narra?: NarraBridge;
}

