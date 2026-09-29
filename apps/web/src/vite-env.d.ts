/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to `1` at build time to force the mock app (T-0069). */
  readonly VITE_MOCK?: string;
}
