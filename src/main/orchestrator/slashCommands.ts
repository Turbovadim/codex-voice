import type {
  CodexModelSummary,
  CodexSettings,
  CodexSettingsScope,
  CodexThreadTokenUsage,
  ReasoningEffort,
} from "../../shared/types";
import { FAST_CODEX_SERVICE_TIER } from "../../shared/types";
import type { ReviewTarget } from "./types";
import { permissionProfile } from "./permissions";

export function parseSlashInput(text: string): { command: string; args: string[]; rest: string } {
  const raw = text.slice(1).trim();
  const firstSpace = raw.search(/\s/);
  const command = firstSpace === -1 ? raw : raw.slice(0, firstSpace);
  const rest = firstSpace === -1 ? "" : raw.slice(firstSpace + 1).trim();
  return { command, args: rest ? rest.split(/\s+/) : [], rest };
}

export function nativeSlashHelpText(): string {
  return [
    "Native Codex slash commands exposed in this debug app:",
    "/status - show thread, model/reasoning, context, and rate-limit state.",
    "/model [chat|next] [model|effort] [effort] - headless model picker.",
    "/fast [on|off|status] - show or update Fast mode for supported models.",
    "/review [base <branch>|commit <sha>|custom <instructions>] [detached] - start app-server review.",
    "/compact - compact the active Codex thread context.",
    "/mcp [verbose] - list MCP servers reported by app-server.",
    "/apps - list apps/connectors reported by app-server.",
    "/plugins - list plugins reported by app-server.",
    "/permissions [default|auto-review|full-access] - show or update chat permission mode.",
    "/new [name] - create a Codex thread in the active workspace. /resume [workspaceId] - resume a linked workspace.",
    "Recognized but UI-only or not wired yet: /feedback, /plan-mode, /diff, /init, /agent, /mention, /stop, /fork, /side, /clear, /copy, /quit.",
  ].join("\n");
}

export function nativeUnsupportedSlashCommand(command: string): string | null {
  const messages: Record<string, string> = {
    feedback:
      "Recognized native /feedback. This debug UI does not open the Codex feedback dialog or upload logs yet.",
    "plan-mode":
      "Recognized native /plan-mode. The v0 voice app intentionally keeps Realtime as a voice layer around normal Codex execution, so plan-mode is not wired here yet.",
    plan:
      "Recognized native /plan. The v0 voice app intentionally routes tasks to Codex execution rather than switching this debug surface into plan mode.",
    diff: "Recognized native /diff. This debug UI does not render Codex's diff view yet.",
    init: "Recognized native /init. Ask Codex to create or update AGENTS.md as a normal task for now.",
    "sandbox-add-read-dir":
      "Recognized native /sandbox-add-read-dir. Extra sandbox readable roots are not wired into this debug UI yet.",
    agent: "Recognized native /agent. Subagent thread switching is not exposed in this debug UI yet.",
    mention: "Recognized native /mention. File attachment UI is not wired yet; include the path in your request for now.",
    personality: "Recognized native /personality. This voice app currently starts Codex with the friendly personality.",
    ps: "Recognized native /ps. Background terminal inventory is not exposed in this debug UI yet.",
    stop:
      "Recognized native /stop, which stops background terminals in Codex CLI. This debug app does not track those yet; use Interrupt to stop the active Codex turn.",
    fork: "Recognized native /fork. Forking Codex threads is not wired into the voice-project folder model yet.",
    side: "Recognized native /side. Side conversations are not wired into this debug UI yet.",
    clear: "Recognized native /clear. Use the Event Log Clear button for debug output; Codex thread history is unchanged.",
    copy: "Recognized native /copy. Copying the latest Codex output is not wired into this debug UI yet.",
    exit: "Recognized native /exit. This debug app does not close itself through slash commands.",
    quit: "Recognized native /quit. This debug app does not close itself through slash commands.",
    logout: "Recognized native /logout. Account logout is not exposed in this debug UI yet.",
    experimental: "Recognized native /experimental. Feature toggles are not exposed in this debug UI yet.",
    "debug-config": "Recognized native /debug-config. Config diagnostics are not rendered here yet; /status shows the effective basics.",
    statusline: "Recognized native /statusline. TUI status-line configuration does not apply to this debug UI.",
    title: "Recognized native /title. Terminal-title configuration does not apply to this debug UI.",
    keymap: "Recognized native /keymap. TUI keymap configuration does not apply to this debug UI.",
    interrupt: "Interrupt is a voice-app control rather than a native Codex slash command. Use the Interrupt button.",
    summarize: "Summarize is a voice-app action rather than a native Codex slash command. Use Summarize Active.",
  };
  return messages[command] ?? null;
}

export function parseModelSlashArgs(
  args: string[],
  defaultScope: CodexSettingsScope,
): { scope: CodexSettingsScope; model?: string | null; reasoningEffort?: ReasoningEffort | null } {
  let scope = defaultScope;
  let tokens = [...args];
  if (isScopeToken(tokens[0])) {
    scope = scopeFromToken(tokens[0]);
    tokens = tokens.slice(1);
  }
  if (tokens.length > 1 && isScopeToken(tokens[tokens.length - 1])) {
    scope = scopeFromToken(tokens[tokens.length - 1]);
    tokens = tokens.slice(0, -1);
  }
  if (tokens.length === 0) {
    throw new Error("Missing model or reasoning effort for /model.");
  }

  const first = tokens[0].toLowerCase();
  if (first === "effort" || first === "reasoning") {
    const effortToken = tokens[1];
    if (!effortToken) throw new Error("Missing reasoning effort for /model.");
    return { scope, reasoningEffort: parseNullableReasoningEffort(effortToken) };
  }

  if (isResetToken(first)) {
    return { scope, model: null, reasoningEffort: null };
  }

  if (isReasoningEffortToken(first)) {
    return { scope, reasoningEffort: first as ReasoningEffort };
  }

  return {
    scope,
    model: tokens[0],
    ...(tokens[1] ? { reasoningEffort: parseNullableReasoningEffort(tokens[1]) } : {}),
  };
}

export function parseReviewSlashArgs(args: string[]): { target: ReviewTarget; delivery?: "inline" | "detached" } {
  const tokens = [...args];
  let delivery: "inline" | "detached" | undefined;
  const deliveryIndex = tokens.findIndex((token) => ["inline", "detached"].includes(token.toLowerCase()));
  if (deliveryIndex !== -1) {
    delivery = tokens[deliveryIndex].toLowerCase() as "inline" | "detached";
    tokens.splice(deliveryIndex, 1);
  }

  const mode = tokens[0]?.toLowerCase();
  if (!mode) return { target: { type: "uncommittedChanges" }, delivery };
  if (mode === "base" || mode === "branch") {
    const branch = tokens[1];
    if (!branch) throw new Error("Missing branch for /review base <branch>.");
    return { target: { type: "baseBranch", branch }, delivery };
  }
  if (mode === "commit") {
    const sha = tokens[1];
    if (!sha) throw new Error("Missing sha for /review commit <sha>.");
    const title = tokens.slice(2).join(" ").trim() || null;
    return { target: { type: "commit", sha, title }, delivery };
  }
  if (mode === "custom") {
    const instructions = tokens.slice(1).join(" ").trim();
    if (!instructions) throw new Error("Missing instructions for /review custom <instructions>.");
    return { target: { type: "custom", instructions }, delivery };
  }
  return { target: { type: "custom", instructions: tokens.join(" ") }, delivery };
}

export function isScopeToken(value: string | undefined): value is string {
  return value === "chat" || value === "next" || value === "nextturn" || value === "next-turn";
}

export function scopeFromToken(value: string): CodexSettingsScope {
  return value === "next" || value === "nextturn" || value === "next-turn" ? "nextTurn" : "chat";
}

export function isResetToken(value: string): boolean {
  return value === "default" || value === "reset" || value === "clear";
}

export function isReasoningEffortToken(value: string): value is ReasoningEffort {
  return ["none", "minimal", "low", "medium", "high", "xhigh"].includes(value);
}

export function parseNullableReasoningEffort(value: string): ReasoningEffort | null {
  const lower = value.toLowerCase();
  return isResetToken(lower) ? null : (lower as ReasoningEffort);
}

export function formatModelList(models: CodexModelSummary[]): string {
  if (models.length === 0) return "No Codex models were returned by app-server.";
  return models
    .map((model) => {
      const efforts = model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort).join(", ");
      const speed = model.serviceTiers.some((tier) => tier.name.toLowerCase() === "fast") ? " + Fast" : "";
      return `${model.model}${model.isDefault ? " (default)" : ""}: ${
        efforts || model.defaultReasoningEffort
      }${speed}`;
    })
    .join("\n");
}

export function describeReviewTarget(target: ReviewTarget): string {
  if (target.type === "uncommittedChanges") return "uncommitted changes";
  if (target.type === "baseBranch") return `base branch ${target.branch}`;
  if (target.type === "commit") return `commit ${target.sha}`;
  return "custom instructions";
}

export function describeThreadStatus(status: unknown): string {
  if (!status || typeof status !== "object") return "unknown";
  const value = status as { type?: string; activeFlags?: unknown[] };
  if (value.type === "active") return `active (${value.activeFlags?.length ?? 0} flags)`;
  return value.type ?? "unknown";
}

export function formatTokenUsage(usage: CodexThreadTokenUsage | null): string {
  if (!usage) return "no token usage reported yet";
  const total = usage.total.totalTokens;
  if (!usage.modelContextWindow) return `${total.toLocaleString()} tokens used`;
  const percent = Math.round((total / usage.modelContextWindow) * 100);
  return `${total.toLocaleString()} / ${usage.modelContextWindow.toLocaleString()} tokens (${percent}%), last turn ${usage.last.totalTokens.toLocaleString()}`;
}

export function formatRateLimit(value: unknown): string {
  if (!value || typeof value !== "object") return "not reported";
  const snapshot = value as {
    limitName?: string | null;
    primary?: { usedPercent?: number; resetsAt?: number | null } | null;
    secondary?: { usedPercent?: number; resetsAt?: number | null } | null;
    credits?: { hasCredits?: boolean; unlimited?: boolean; balance?: string | null } | null;
    planType?: string | null;
  };
  const primary = snapshot.primary
    ? `${Math.round(snapshot.primary.usedPercent ?? 0)}% used${formatResetTime(snapshot.primary.resetsAt)}`
    : "primary not reported";
  const secondary = snapshot.secondary
    ? `, secondary ${Math.round(snapshot.secondary.usedPercent ?? 0)}% used${formatResetTime(snapshot.secondary.resetsAt)}`
    : "";
  const credits = snapshot.credits
    ? `, credits ${snapshot.credits.unlimited ? "unlimited" : snapshot.credits.balance ?? (snapshot.credits.hasCredits ? "available" : "none")}`
    : "";
  return `${snapshot.limitName ?? "codex"} (${snapshot.planType ?? "unknown"}): ${primary}${secondary}${credits}`;
}

export function formatResetTime(resetsAt: number | null | undefined): string {
  if (typeof resetsAt !== "number") return "";
  return `, resets ${new Date(resetsAt * 1000).toLocaleTimeString()}`;
}

export function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "default";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function isFastServiceTier(value: string | null | undefined): boolean {
  return value === FAST_CODEX_SERVICE_TIER || value === "fast";
}

export function formatServiceTier(value: string | null | undefined): string {
  return isFastServiceTier(value) ? "Fast" : "Standard";
}

export function formatMcpServers(
  servers: Array<{ name: string; tools?: Record<string, unknown>; authStatus?: string }>,
  verbose: boolean,
): string {
  if (servers.length === 0) return "No MCP servers reported by app-server.";
  return [
    verbose ? "MCP servers (verbose)" : "MCP servers",
    ...servers.map((server) => {
      const toolNames = Object.keys(server.tools ?? {});
      const suffix = verbose && toolNames.length > 0 ? `: ${toolNames.slice(0, 12).join(", ")}` : "";
      return `${server.name} - ${server.authStatus ?? "auth unknown"} - ${toolNames.length} tools${suffix}`;
    }),
  ].join("\n");
}

export function formatApps(
  apps: Array<{ id: string; name: string; isEnabled: boolean; isAccessible: boolean; pluginDisplayNames?: string[] }>,
): string {
  if (apps.length === 0) return "No apps/connectors reported by app-server.";
  return [
    "Apps/connectors",
    ...apps.map((app) => {
      const state = [app.isEnabled ? "enabled" : "disabled", app.isAccessible ? "accessible" : "not accessible"].join(", ");
      const plugins = app.pluginDisplayNames?.length ? ` via ${app.pluginDisplayNames.join(", ")}` : "";
      return `${app.name} (${app.id}) - ${state}${plugins}`;
    }),
  ].join("\n");
}

export function formatPlugins(
  marketplaces: Array<{
    name: string;
    plugins?: Array<{ id: string; name: string; installed: boolean; enabled: boolean }>;
  }>,
  errors: unknown[],
): string {
  const pluginLines = marketplaces.flatMap((marketplace) =>
    (marketplace.plugins ?? []).map(
      (plugin) =>
        `${plugin.name} (${plugin.id}) - ${plugin.installed ? "installed" : "not installed"}, ${
          plugin.enabled ? "enabled" : "disabled"
        } - ${marketplace.name}`,
    ),
  );
  return [
    "Plugins",
    ...(pluginLines.length > 0 ? pluginLines : ["No plugins reported by app-server."]),
    ...(errors.length > 0 ? [`Marketplace load errors: ${errors.length}`] : []),
  ].join("\n");
}

export function settingsText(settings: CodexSettings): string {
  const effectiveNextModel =
    settings.nextTurnModel ?? settings.chatModel ?? settings.defaultModel ?? "default";
  const effectiveNextEffort =
    settings.nextTurnReasoningEffort ??
    settings.chatReasoningEffort ??
    settings.defaultReasoningEffort ??
    "default";
  const effectiveNextServiceTier =
    settings.nextTurnServiceTier ?? settings.chatServiceTier ?? settings.defaultServiceTier;
  const effectiveNextPermissions =
    settings.nextTurnPermissionMode ?? settings.chatPermissionMode ?? settings.defaultPermissionMode;
  return [
    `Current chat default: model ${settings.chatModel ?? settings.defaultModel ?? "default"}, reasoning ${
      settings.chatReasoningEffort ?? settings.defaultReasoningEffort ?? "default"
    }, speed ${formatServiceTier(settings.chatServiceTier)}, permissions ${
      permissionProfile(settings.chatPermissionMode).displayName
    }.`,
    `Next turn: model ${effectiveNextModel}, reasoning ${effectiveNextEffort}, speed ${formatServiceTier(
      effectiveNextServiceTier,
    )}, permissions ${
      permissionProfile(effectiveNextPermissions).displayName
    }.`,
    `Active turn: model ${settings.activeTurnModel ?? "none"}, reasoning ${
      settings.activeTurnReasoningEffort ?? "none"
    }, speed ${formatServiceTier(settings.activeTurnServiceTier)}, permissions ${
      settings.activeTurnPermissionMode ? permissionProfile(settings.activeTurnPermissionMode).displayName : "none"
    }.`,
  ].join("\n");
}
