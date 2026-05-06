export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type CodexModelSummary = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden: boolean;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort;
    description: string;
  }>;
};

export type CodexSettingsScope = "session" | "nextTurn";

export type CodexSettings = {
  sessionModel: string | null;
  sessionReasoningEffort: ReasoningEffort | null;
  nextTurnModel: string | null;
  nextTurnReasoningEffort: ReasoningEffort | null;
  activeTurnModel: string | null;
  activeTurnReasoningEffort: ReasoningEffort | null;
  defaultModel: string | null;
  defaultReasoningEffort: ReasoningEffort | null;
  models: CodexModelSummary[];
};

export type VoiceSession = {
  id: string;
  displayName: string;
  folderPath: string;
  codexThreadId: string | null;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  createdAt: string;
  updatedAt: string;
  lastSummary: string | null;
  lastStatus: string | null;
};

export type CodexRuntimeState = {
  ready: boolean;
  activeSessionId: string | null;
  activeTurnId: string | null;
  status: string;
  threadStatus: string | null;
  tokenUsage: CodexThreadTokenUsage | null;
  pendingRequests: PendingCodexRequest[];
};

export type CodexTokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type CodexThreadTokenUsage = {
  total: CodexTokenUsageBreakdown;
  last: CodexTokenUsageBreakdown;
  modelContextWindow: number | null;
};

export type PendingCodexRequest = {
  requestId: number | string;
  method: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  title: string;
  body: string;
  options?: string[];
  raw: unknown;
};

export type AppState = {
  baseFolder: string;
  sessions: VoiceSession[];
  activeSession: VoiceSession | null;
  runtime: CodexRuntimeState;
  codexSettings: CodexSettings;
  realtime: {
    available: boolean;
    model: string;
    voice: string;
    reason: string | null;
    apiKeySource: "environment" | "saved" | null;
    apiKeyEncrypted: boolean;
  };
};

export type CodexActionResult = {
  kind: "turn" | "command";
  message: string;
  turnId: string | null;
  session: VoiceSession | null;
};

export type AppEvent = {
  at: string;
  source: "app" | "codex" | "realtime";
  kind: string;
  message: string;
  raw?: unknown;
};

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export type ToolQuestionAnswer = {
  questionId: string;
  answers: string[];
};

export type RealtimeClientSecret = {
  value: string;
  expiresAt?: number;
  model: string;
  voice: string;
};

export type CodexVoiceApi = {
  getState(): Promise<AppState>;
  createSession(name?: string): Promise<VoiceSession>;
  resumeSession(sessionId: string): Promise<VoiceSession>;
  summarizeSession(sessionId?: string): Promise<string>;
  sendToCodex(text: string): Promise<CodexActionResult>;
  steerCodex(text: string): Promise<{ turnId: string }>;
  interruptCodex(): Promise<void>;
  setCodexSettings(
    settings: { model?: string | null; reasoningEffort?: ReasoningEffort | null },
    scope: CodexSettingsScope,
  ): Promise<CodexSettings>;
  answerApproval(requestId: string | number, decision: ApprovalDecision): Promise<void>;
  answerToolQuestion(requestId: string | number, answers: ToolQuestionAnswer[]): Promise<void>;
  saveOpenAiApiKey(apiKey: string): Promise<void>;
  clearOpenAiApiKey(): Promise<void>;
  createRealtimeClientSecret(): Promise<RealtimeClientSecret>;
  onAppState(listener: (state: AppState) => void): () => void;
  onAppEvent(listener: (event: AppEvent) => void): () => void;
};
