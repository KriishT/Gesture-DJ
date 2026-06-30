/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin when frontend and backend are on different hosts (e.g. https://api.example.com). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
