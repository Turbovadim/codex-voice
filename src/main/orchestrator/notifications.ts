export function statusFromNotification(method: string, params?: Record<string, unknown>): string | null {
  if (method === "turn/started") return "Codex started working.";
  if (method === "turn/completed") {
    const turn = (params?.turn ?? {}) as { status?: string };
    return turn.status === "failed" ? "Codex turn failed." : "Codex finished.";
  }
  if (method === "item/started") {
    const item = (params?.item ?? {}) as { type?: string; command?: string; server?: string; tool?: string; query?: string };
    if (item.type === "commandExecution") return `Codex is running: ${item.command ?? "a command"}`;
    if (item.type === "fileChange") return "Codex is preparing file changes.";
    if (item.type === "mcpToolCall") return `Codex is using ${item.server ?? "an app"} ${item.tool ?? "tool"}.`;
    if (item.type === "webSearch") return `Codex is searching: ${item.query ?? "the web"}`;
    if (item.type === "collabAgentToolCall") return "Codex is coordinating a sub-agent.";
    if (item.type === "agentMessage") return "Codex is writing a response.";
    return `Codex started ${item.type ?? "work"}.`;
  }
  if (method === "item/completed") {
    const item = (params?.item ?? {}) as { type?: string };
    if (item.type === "commandExecution") return "Codex finished a command.";
    if (item.type === "fileChange") return "Codex finished file changes.";
    if (item.type === "mcpToolCall") return "Codex finished using an app tool.";
  }
  if (method === "serverRequest/resolved") return "Codex request resolved.";
  if (method === "error") return "Codex reported an error.";
  return null;
}

