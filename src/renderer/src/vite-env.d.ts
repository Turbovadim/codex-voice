/// <reference types="vite/client" />

import type { CodexVoiceApi } from "../../shared/types";

declare global {
  interface Window {
    codexVoice: CodexVoiceApi;
  }
}
