/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The game server, e.g. https://bfg-server.example.workers.dev. Unset: no online play. */
  readonly VITE_SERVER_URL?: string;
  /** The engine build id; must match the server's ENGINE_BUILD (network/SPEC.md §9). */
  readonly VITE_ENGINE_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
