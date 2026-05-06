import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { clearOpenAiApiKey, saveOpenAiApiKey } from "./apiKeyStore";
import appIcon from "./assets/app-icon.png?asset";
import { CodexBridge } from "./codexBridge";
import { VoiceCodexOrchestrator } from "./orchestrator";
import { SessionStore } from "./sessionStore";
import type {
  ApprovalDecision,
  CodexSettingsScope,
  ReasoningEffort,
  ToolQuestionAnswer,
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let orchestrator: VoiceCodexOrchestrator | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 444,
    height: 653,
    minWidth: 410,
    minHeight: 640,
    title: "Codex Voice",
    icon: appIcon,
    backgroundColor: "#121212",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  window.webContents.setZoomFactor(0.85);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
}

function sendToMainWindow(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

async function boot(): Promise<void> {
  const store = new SessionStore();
  const codex = new CodexBridge();
  orchestrator = new VoiceCodexOrchestrator(store, codex);

  orchestrator.on("state", (state) => sendToMainWindow("app:state", state));
  orchestrator.on("event", (event) => sendToMainWindow("app:event", event));

  createWindow();
  await orchestrator.initialize();
}

function requireOrchestrator(): VoiceCodexOrchestrator {
  if (!orchestrator) throw new Error("App is still starting.");
  return orchestrator;
}

app.whenReady().then(() => {
  app.dock?.setIcon(appIcon);
  registerIpc();
  void boot();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  orchestrator?.shutdown();
});

function registerIpc(): void {
  ipcMain.handle("app:getState", () => requireOrchestrator().state());
  ipcMain.handle("sessions:create", (_event, payload: { name?: string }) =>
    requireOrchestrator().createSession(payload.name),
  );
  ipcMain.handle("sessions:resume", (_event, payload: { sessionId: string }) =>
    requireOrchestrator().resumeSession(payload.sessionId),
  );
  ipcMain.handle("sessions:summarize", (_event, payload: { sessionId?: string }) =>
    requireOrchestrator().summarizeSession(payload.sessionId),
  );
  ipcMain.handle("codex:send", (_event, payload: { text: string }) =>
    requireOrchestrator().sendToCodex(payload.text),
  );
  ipcMain.handle("codex:steer", (_event, payload: { text: string }) =>
    requireOrchestrator().steerCodex(payload.text),
  );
  ipcMain.handle("codex:interrupt", () => requireOrchestrator().interruptCodex());
  ipcMain.handle(
    "codex:setSettings",
    (
      _event,
      payload: {
        settings: { model?: string | null; reasoningEffort?: ReasoningEffort | null };
        scope: CodexSettingsScope;
      },
    ) => requireOrchestrator().setCodexSettings(payload.settings, payload.scope),
  );
  ipcMain.handle(
    "codex:answerApproval",
    (_event, payload: { requestId: string | number; decision: ApprovalDecision }) =>
      requireOrchestrator().answerApproval(payload.requestId, payload.decision),
  );
  ipcMain.handle(
    "codex:answerToolQuestion",
    (_event, payload: { requestId: string | number; answers: ToolQuestionAnswer[] }) =>
      requireOrchestrator().answerToolQuestion(payload.requestId, payload.answers),
  );
  ipcMain.handle("settings:saveOpenAiApiKey", (_event, payload: { apiKey: string }) => {
    saveOpenAiApiKey(payload.apiKey);
  });
  ipcMain.handle("settings:clearOpenAiApiKey", () => {
    clearOpenAiApiKey();
  });
  ipcMain.handle("realtime:createClientSecret", () =>
    requireOrchestrator().createRealtimeClientSecret(),
  );
}
