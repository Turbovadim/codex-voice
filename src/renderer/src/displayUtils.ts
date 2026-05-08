import {
  CODEX_PERMISSION_PROFILES,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_CODEX_REASONING_EFFORT,
  FAST_CODEX_SERVICE_TIER,
  type AppState,
  type CodexModelSummary,
  type CodexPermissionMode,
  type CodexServiceTier,
  type CodexThreadTokenUsage,
  type PendingCodexRequest,
  type PendingRequestQuestion,
  type VoiceProject,
} from "../../shared/types";
import type { ArchivedChat, ChatSummary } from "./rendererTypes";

export function voiceStateLabel(
  state: AppState,
  voiceConnected: boolean,
  voiceConnecting: boolean,
  voicePaused: boolean,
): { label: string; tone: "off" | "listening" | "working" | "connecting" | "paused" | "waiting" } {
  if (voiceConnecting) return { label: "Connecting", tone: "connecting" };
  if (state.runtime.pendingRequests.length > 0) return { label: "Needs input", tone: "waiting" };
  if (voiceConnected && voicePaused && state.runtime.activeTurnId) {
    return { label: "Working, voice paused", tone: "paused" };
  }
  if (voiceConnected && voicePaused) return { label: "Voice paused", tone: "paused" };
  if (state.runtime.activeTurnId) return { label: "Working", tone: "working" };
  if (voiceConnected) return { label: "Listening", tone: "listening" };
  return { label: "Voice off", tone: "off" };
}

export function voiceOrbAriaLabel(
  state: AppState,
  voiceConnected: boolean,
  voiceConnecting: boolean,
  voicePaused: boolean,
): string {
  if (voiceConnecting) return "Voice connecting";
  if (state.runtime.pendingRequests.length > 0) return "Respond to pending Codex request";
  if (voiceConnected && voicePaused && state.runtime.activeTurnId) {
    return "Resume voice while Codex keeps working";
  }
  if (voiceConnected && voicePaused) return "Resume voice";
  if (voiceConnected && state.runtime.activeTurnId) return "Pause voice while Codex keeps working";
  if (voiceConnected) return "Pause voice";
  return "Start voice";
}

export function chatSummariesForProject(project: VoiceProject | null, state: AppState): ChatSummary[] {
  if (!project) return [];
  return (project.chats ?? []).filter((chat) => !chat.archivedAt).map((chat) => {
    const runtime = (state.runtime.chats ?? []).find((candidate) => candidate.chatId === chat.id);
    const waiting = Boolean(runtime?.pendingRequests.length);
    const working = Boolean(runtime?.activeTurnId);
    return {
      id: chat.id,
      title: chat.displayName,
      detail: runtime?.status ?? chat.lastStatus ?? "Idle",
      tone: waiting ? "waiting" : working ? "active" : "idle",
      active: chat.id === state.runtime.activeChatId,
    };
  });
}

export function archivedChatsForProjects(projects: VoiceProject[]): ArchivedChat[] {
  return projects.flatMap((project) =>
    (project.chats ?? [])
      .filter((chat) => chat.archivedAt)
      .map((chat) => ({
        projectId: project.id,
        projectName: project.displayName,
        chat,
      })),
  );
}

export function formatProjectTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDelta = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (dayDelta === 0) return `Today, ${time}`;
  if (dayDelta === 1) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${time}`;
}

export function formatModelName(model: string | null): string {
  if (!model) return "Default";
  return model.replace(/^gpt-/i, "GPT-");
}

export function modelsForValue(models: CodexModelSummary[], value: string | null): CodexModelSummary[] {
  if (!value || models.some((model) => model.model === value)) return models;
  return [
    {
      id: value,
      model: value,
      displayName: formatModelName(value),
      description: "",
      isDefault: false,
      hidden: false,
      defaultReasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
      supportedReasoningEfforts: [],
      additionalSpeedTiers: [],
      serviceTiers: [],
    },
    ...models,
  ];
}

export function supportsFastMode(model: CodexModelSummary | null): boolean {
  if (!model) return false;
  return (
    model.serviceTiers.some((tier) => tier.id === FAST_CODEX_SERVICE_TIER || tier.name.toLowerCase() === "fast") ||
    model.additionalSpeedTiers.includes("fast")
  );
}

export function isFastServiceTier(value: CodexServiceTier | null | undefined): boolean {
  return value === FAST_CODEX_SERVICE_TIER || value === "fast";
}

export function formatServiceTier(value: CodexServiceTier | null | undefined): string {
  return isFastServiceTier(value) ? "Fast" : "Standard";
}

export function formatEffort(effort: string | null): string {
  if (!effort) return "Default";
  if (effort === "xhigh") return "Extra High";
  return effort.slice(0, 1).toUpperCase() + effort.slice(1);
}

export function permissionProfile(mode: CodexPermissionMode) {
  return CODEX_PERMISSION_PROFILES.find((profile) => profile.mode === mode) ?? CODEX_PERMISSION_PROFILES[0];
}

export function formatTokenUsage(usage: CodexThreadTokenUsage | null): string {
  if (!usage) return "not reported";
  const total = usage.total.totalTokens;
  if (!usage.modelContextWindow) return `${total.toLocaleString()} tokens`;
  return `${total.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()}`;
}

export function questionsFromRawRequest(request: PendingCodexRequest): PendingRequestQuestion[] {
  const raw = request.raw as { params?: { questions?: Array<any> }; raw?: { params?: { questions?: Array<any> } } };
  const questions = raw.params?.questions ?? raw.raw?.params?.questions ?? [];
  if (!Array.isArray(questions)) return [];
  return questions
    .map((question, index): PendingRequestQuestion | null => {
      if (!question || typeof question !== "object") return null;
      const record = question as Record<string, unknown>;
      const id = typeof record.id === "string" && record.id.trim() ? record.id : `question-${index + 1}`;
      const options = Array.isArray(record.options)
        ? record.options
            .map((option) => {
              if (!option || typeof option !== "object") return null;
              const optionRecord = option as Record<string, unknown>;
              return typeof optionRecord.label === "string"
                ? {
                    label: optionRecord.label,
                    description: typeof optionRecord.description === "string" ? optionRecord.description : "",
                  }
                : null;
            })
            .filter((option): option is { label: string; description: string } => option !== null)
        : null;
      return {
        id,
        header: typeof record.header === "string" ? record.header : `Question ${index + 1}`,
        question: typeof record.question === "string" ? record.question : "Codex is asking for input.",
        isOther: Boolean(record.isOther),
        isSecret: Boolean(record.isSecret),
        options,
      };
    })
    .filter((question): question is PendingRequestQuestion => question !== null);
}

export function defaultQuestionAnswer(question: PendingRequestQuestion): string {
  return question.options?.[0]?.label ?? "";
}

export function customQuestionAnswer(question: PendingRequestQuestion, answer: string | undefined): string {
  if (!answer) return "";
  if (!question.options?.some((option) => option.label === answer)) return answer;
  return "";
}

export function requestKindLabel(request: PendingCodexRequest): string {
  if (request.kind === "question") return "Question";
  if (request.kind === "approval") return "Approval";
  if (request.kind === "elicitation") return "MCP request";
  if (request.kind === "tool") return "Tool call";
  if (request.kind === "auth") return "Auth";
  return "Request";
}

export function requestContextLabel(request: PendingCodexRequest): string {
  return [request.projectName, request.chatName].filter(Boolean).join(" / ");
}
