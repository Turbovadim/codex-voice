import { contextBridge, ipcRenderer } from "electron";
import type {
  AppEvent,
  AppState,
  ApprovalDecision,
  CodexSettingsScope,
  CodexVoiceApi,
  ReasoningEffort,
  ToolQuestionAnswer,
} from "../shared/types";

const api: CodexVoiceApi = {
  getState: () => ipcRenderer.invoke("app:getState"),
  createSession: (name?: string) => ipcRenderer.invoke("sessions:create", { name }),
  resumeSession: (sessionId: string) => ipcRenderer.invoke("sessions:resume", { sessionId }),
  summarizeSession: (sessionId?: string) => ipcRenderer.invoke("sessions:summarize", { sessionId }),
  sendToCodex: (text: string) => ipcRenderer.invoke("codex:send", { text }),
  steerCodex: (text: string) => ipcRenderer.invoke("codex:steer", { text }),
  interruptCodex: () => ipcRenderer.invoke("codex:interrupt"),
  setCodexSettings: (
    settings: { model?: string | null; reasoningEffort?: ReasoningEffort | null },
    scope: CodexSettingsScope,
  ) => ipcRenderer.invoke("codex:setSettings", { settings, scope }),
  answerApproval: (requestId: string | number, decision: ApprovalDecision) =>
    ipcRenderer.invoke("codex:answerApproval", { requestId, decision }),
  answerToolQuestion: (requestId: string | number, answers: ToolQuestionAnswer[]) =>
    ipcRenderer.invoke("codex:answerToolQuestion", { requestId, answers }),
  saveOpenAiApiKey: (apiKey: string) => ipcRenderer.invoke("settings:saveOpenAiApiKey", { apiKey }),
  clearOpenAiApiKey: () => ipcRenderer.invoke("settings:clearOpenAiApiKey"),
  createRealtimeClientSecret: () => ipcRenderer.invoke("realtime:createClientSecret"),
  onAppState: (listener: (state: AppState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState) => listener(state);
    ipcRenderer.on("app:state", handler);
    return () => ipcRenderer.off("app:state", handler);
  },
  onAppEvent: (listener: (event: AppEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, appEvent: AppEvent) => listener(appEvent);
    ipcRenderer.on("app:event", handler);
    return () => ipcRenderer.off("app:event", handler);
  },
};

contextBridge.exposeInMainWorld("codexVoice", api);
