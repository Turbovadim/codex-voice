import type { VoiceChat, VoiceProject } from "../../shared/types";
import type { CodexThreadItem, CodexThreadSummary, CodexThreadTurn } from "./types";

export function finalAssistantTextFromTurn(turn: CodexThreadTurn): string | null {
  const agentMessages = (turn.items ?? []).filter(
    (item): item is CodexThreadItem & { text: string } =>
      item.type === "agentMessage" && typeof item.text === "string" && item.text.trim().length > 0,
  );
  const finalMessage =
    [...agentMessages].reverse().find((item) => item.phase === "final_answer") ??
    agentMessages[agentMessages.length - 1] ??
    null;
  return finalMessage?.text ?? null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function activeChatForProject(project: VoiceProject): VoiceChat | null {
  const chats = project.chats.filter((chat) => !chat.archivedAt);
  return (
    chats.find((chat) => chat.id === project.activeChatId) ??
    chats.find((chat) => chat.codexThreadId === project.codexThreadId) ??
    chats[0] ??
    null
  );
}

export function titleFromText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 48) || "Codex thread";
}

export function titleFromThread(thread: CodexThreadSummary): string {
  const title = thread.name?.trim() || userRequestFromVoiceWrapper(thread.preview)?.trim() || thread.preview?.trim();
  return title ? title.replace(/\s+/g, " ").slice(0, 72) : "Codex thread";
}

export function updatedChatTitle(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 72) || "Codex thread";
}

export function userRequestFromVoiceWrapper(text: string | null | undefined): string | null {
  if (!text?.includes("User's spoken request:")) return null;
  const request = text.split("User's spoken request:").pop()?.trim();
  return request || null;
}

export function unixSecondsToIso(value: unknown, fallback: string): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : fallback;
}

export function describeThreadSummaryStatus(status: unknown): string | null {
  if (!status || typeof status !== "object") return null;
  const value = status as { type?: unknown; activeFlags?: unknown[] };
  if (value.type === "active") return `Active (${value.activeFlags?.length ?? 0} flags)`;
  return typeof value.type === "string" && value.type ? value.type : null;
}

export function isMissingCodexThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no rollout found for thread id/i.test(message) || /unknown thread/i.test(message);
}

export function codexThreadDeveloperInstructions(): string {
  return [
    "Requests in this thread may come through a local Realtime voice interface.",
    "Treat the current working directory as the active Codex workspace.",
    "Codex owns the actual planning, computer use, tool use, browser use, and execution.",
    "For requests that may require controlling desktop apps, the model should use tool_search to discover computer-use before choosing an approach; do this only once per new tool or plugin requested by the user.",
    "If the user's request mentions the Computer Use plugin, Codex must satisfy that request by discovering and using the actual computer-use plugin. Do not replace it with shell commands, open -a, AppleScript via terminal, or other terminal workarounds.",
    "Ask for clarification or approval when needed, and keep final status concise enough to relay by voice.",
  ].join("\n");
}
