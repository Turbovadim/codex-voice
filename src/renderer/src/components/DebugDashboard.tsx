import React from "react";
import {
  CODEX_PERMISSION_PROFILES,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_REASONING_EFFORT,
  FAST_CODEX_SERVICE_TIER,
  type AppEvent,
  type AppState,
  type CodexPermissionMode,
  type CodexServiceTier,
  type ReasoningEffort,
} from "../../../shared/types";
import {
  formatServiceTier,
  formatTokenUsage,
  modelsForValue,
  permissionProfile,
} from "../displayUtils";
import type { RunAction } from "../rendererTypes";
import { ErrorOverlay } from "./ErrorOverlay";
import { PendingRequestCard } from "./PendingRequests";

export function DebugDashboard({
  state,
  events,
  error,
  message,
  steer,
  setMessage,
  setSteer,
  onDismissError,
  onAction,
  onClearEvents,
  onRefresh,
  onLogEvent,
}: {
  state: AppState;
  events: AppEvent[];
  error: string | null;
  message: string;
  steer: string;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setSteer: React.Dispatch<React.SetStateAction<string>>;
  onDismissError: () => void;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  onClearEvents: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogEvent: (event: AppEvent) => Promise<void>;
}): React.ReactElement {
  const projects = state.projects;
  const activeProject = state.activeProject;
  const activeProjectId = state.runtime.activeProjectId;
  const activeFolder = activeProject?.folderPath ?? "No active project.";
  const activeChatName =
    (activeProject?.chats ?? []).find((chat) => chat.id === state.runtime.activeChatId && !chat.archivedAt)
      ?.displayName ?? "none";
  const effectiveNextModel =
    state.codexSettings.nextTurnModel ??
    state.codexSettings.chatModel ??
    state.codexSettings.defaultModel ??
    DEFAULT_CODEX_MODEL;
  const effectiveNextEffort =
    state.codexSettings.nextTurnReasoningEffort ??
    state.codexSettings.chatReasoningEffort ??
    state.codexSettings.defaultReasoningEffort ??
    DEFAULT_CODEX_REASONING_EFFORT;

  return (
    <main className="debug-shell app-shell">
      <header className="topbar">
        <div>
          <h1>Codex Voice Debug</h1>
          <p>Voice is the front door. Codex owns the computer work.</p>
        </div>
        <div className="status-stack">
          <StatusPill label={state.runtime.ready ? "Codex ready" : "Codex starting"} tone={state.runtime.ready ? "good" : "warn"} />
          <StatusPill label={`Next: ${effectiveNextModel} / ${effectiveNextEffort}`} tone="muted" />
          <StatusPill label="Voice in main window" tone="muted" />
        </div>
      </header>

      {error && <ErrorOverlay message={error} onDismiss={onDismissError} />}

      <section className="workspace-bar">
        <div>
          <span className="label">Metadata folder</span>
          <code>{state.baseFolder || "Loading..."}</code>
        </div>
        <div>
          <span className="label">Active folder</span>
          <code>{activeFolder}</code>
        </div>
      </section>

      <section className="grid">
        <aside className="panel projects-panel">
          <div className="panel-header">
            <h2>Projects</h2>
            <button onClick={() => void onRefresh()}>Refresh</button>
          </div>
          <div className="new-project-row">
            <button
              className="primary"
              onClick={() => void onAction(() => window.codexVoice.addWorkspaceProject())}
            >
              Add project
            </button>
          </div>
          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project.id}
                className={`project-card ${project.id === activeProjectId ? "active" : ""}`}
                onClick={() => void onAction(() => window.codexVoice.resumeProject(project.id))}
              >
                <strong>{project.displayName}</strong>
                <span>{new Date(project.updatedAt).toLocaleString()}</span>
                <small>{project.lastStatus ?? "No status yet."}</small>
              </button>
            ))}
            {projects.length === 0 && <p className="empty">No projects linked yet.</p>}
          </div>
        </aside>

        <section className="panel command-panel">
          <div className="panel-header">
            <h2>Codex Control</h2>
          </div>
          <p className="help">
            {state.realtime.available
              ? `Realtime voice is controlled from the main Codex Voice window. Model: ${state.realtime.model}, voice: ${state.realtime.voice}, reasoning: ${state.realtime.reasoningEffort}.`
              : state.realtime.reason}
          </p>

          <div className="status-card">
            <span className="label">Codex status</span>
            <strong>{state.runtime.status}</strong>
            <small>
              Chat: {activeChatName} | Thread: {activeProject?.codexThreadId ?? "none"} | Turn:{" "}
              {state.runtime.activeTurnId ?? "none"}
            </small>
            <small>
              Thread state: {state.runtime.threadStatus ?? "unknown"} | Context:{" "}
              {formatTokenUsage(state.runtime.tokenUsage)}
            </small>
          </div>

          <CodexSettingsPanel state={state} onAction={onAction} />
          <NativeSlashPanel />

          <label className="stacked-input">
            Send request to Codex or native slash command
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Type a request, /status, /model, /model next gpt-5.5 high, /review, /compact, /mcp verbose..."
            />
          </label>
          <div className="button-row">
            <button
              className="primary"
              onClick={() =>
                void onAction(async () => {
                  await window.codexVoice.sendToCodex(message);
                  setMessage("");
                })
              }
            >
              Send
            </button>
            <button
              onClick={() =>
                void onAction(async () => {
                  const summary = await window.codexVoice.summarizeProject(activeProject?.id);
                  await onLogEvent({
                    at: new Date().toISOString(),
                    source: "app",
                    kind: "summary",
                    message: summary,
                  });
                })
              }
            >
              Summarize Active
            </button>
            <button className="danger" onClick={() => void onAction(() => window.codexVoice.interruptCodex())}>
              Interrupt
            </button>
          </div>

          <label className="stacked-input compact">
            Steer active turn
            <div className="inline-form">
              <input
                value={steer}
                onChange={(event) => setSteer(event.target.value)}
                placeholder="Actually, use the PDF from yesterday..."
              />
              <button
                onClick={() =>
                  void onAction(async () => {
                    await window.codexVoice.steerCodex(steer);
                    setSteer("");
                  })
                }
              >
                Steer
              </button>
            </div>
          </label>
        </section>

        <section className="panel approvals-panel">
          <div className="panel-header">
            <h2>Approvals / Questions</h2>
            <span>{state.runtime.pendingRequests.length}</span>
          </div>
          <p className="help">Voice can answer with allow, allow for this session, decline, or cancel.</p>
          {state.runtime.pendingRequests.length === 0 ? (
            <p className="empty">Nothing waiting on the user.</p>
          ) : (
            state.runtime.pendingRequests.map((request) => (
              <PendingRequestCard key={String(request.requestId)} request={request} onAction={onAction} />
            ))
          )}
        </section>

        <section className="panel event-panel">
          <div className="panel-header">
            <h2>Event Log</h2>
            <button onClick={() => void onClearEvents()}>Clear</button>
          </div>
          <div className="event-list">
            {events.map((event, index) => (
              <article key={`${event.at}-${index}`} className={`event ${event.source}`}>
                <div>
                  <strong>{event.kind}</strong>
                  <span>{event.source}</span>
                  <time>{new Date(event.at).toLocaleTimeString()}</time>
                </div>
                <p>{event.message}</p>
              </article>
            ))}
            {events.length === 0 && <p className="empty">No events yet.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}

function CodexSettingsPanel({
  state,
  onAction,
}: {
  state: AppState;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
}): React.ReactElement {
  const efforts: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
  const models = state.codexSettings.models;
  const chatModel = state.codexSettings.chatModel ?? "";
  const nextTurnModel = state.codexSettings.nextTurnModel ?? "";
  const chatEffort = state.codexSettings.chatReasoningEffort ?? "";
  const nextTurnEffort = state.codexSettings.nextTurnReasoningEffort ?? "";
  const chatServiceTier = state.codexSettings.chatServiceTier ?? "";
  const nextTurnServiceTier = state.codexSettings.nextTurnServiceTier ?? "";
  const chatPermissionMode = state.codexSettings.chatPermissionMode;
  const nextTurnPermissionMode = state.codexSettings.nextTurnPermissionMode ?? "";
  const chatModelOptions = modelsForValue(models, chatModel);
  const nextTurnModelOptions = modelsForValue(models, nextTurnModel);

  return (
    <section className="settings-panel">
      <div className="settings-grid">
        <SettingReadout
          label="Default"
          model={state.codexSettings.defaultModel ?? "unknown"}
          effort={state.codexSettings.defaultReasoningEffort ?? "unknown"}
          speed={formatServiceTier(state.codexSettings.defaultServiceTier)}
          permission={permissionProfile(state.codexSettings.defaultPermissionMode).displayName}
        />
        <SettingReadout
          label="Chat"
          model={state.codexSettings.chatModel ?? "default"}
          effort={state.codexSettings.chatReasoningEffort ?? "default"}
          speed={formatServiceTier(state.codexSettings.chatServiceTier)}
          permission={permissionProfile(state.codexSettings.chatPermissionMode).displayName}
        />
        <SettingReadout
          label="Next Turn"
          model={state.codexSettings.nextTurnModel ?? "chat/default"}
          effort={state.codexSettings.nextTurnReasoningEffort ?? "chat/default"}
          speed={
            state.codexSettings.nextTurnServiceTier
              ? formatServiceTier(state.codexSettings.nextTurnServiceTier)
              : "chat/default"
          }
          permission={
            state.codexSettings.nextTurnPermissionMode
              ? permissionProfile(state.codexSettings.nextTurnPermissionMode).displayName
              : "chat/default"
          }
        />
        <SettingReadout
          label="Active Turn"
          model={state.codexSettings.activeTurnModel ?? "none"}
          effort={state.codexSettings.activeTurnReasoningEffort ?? "none"}
          speed={
            state.codexSettings.activeTurnServiceTier
              ? formatServiceTier(state.codexSettings.activeTurnServiceTier)
              : "none"
          }
          permission={
            state.codexSettings.activeTurnPermissionMode
              ? permissionProfile(state.codexSettings.activeTurnPermissionMode).displayName
              : "none"
          }
        />
      </div>

      <div className="settings-controls">
        <label>
          Chat model
          <select
            value={chatModel}
            disabled={!state.activeProject}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings({ model: event.target.value || null }, "chat"),
              )
            }
          >
            <option value="">Default ({state.codexSettings.defaultModel ?? "unknown"})</option>
            {chatModelOptions.map((model) => (
              <option key={model.id} value={model.model}>
                {model.displayName} ({model.model})
              </option>
            ))}
          </select>
        </label>

        <label>
          Chat effort
          <select
            value={chatEffort}
            disabled={!state.activeProject}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings(
                  { reasoningEffort: (event.target.value || null) as ReasoningEffort | null },
                  "chat",
                ),
              )
            }
          >
            <option value="">Default ({state.codexSettings.defaultReasoningEffort ?? "unknown"})</option>
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </label>

        <label>
          Chat speed
          <select
            value={chatServiceTier}
            disabled={!state.activeProject}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings(
                  { serviceTier: (event.target.value || null) as CodexServiceTier | null },
                  "chat",
                ),
              )
            }
          >
            <option value="">Standard</option>
            <option value={FAST_CODEX_SERVICE_TIER}>Fast</option>
          </select>
        </label>

        <label>
          Chat permissions
          <select
            value={chatPermissionMode}
            disabled={!state.activeProject}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings(
                  { permissionMode: event.target.value as CodexPermissionMode },
                  "chat",
                ),
              )
            }
          >
            {CODEX_PERMISSION_PROFILES.map((profile) => (
              <option key={profile.mode} value={profile.mode}>
                {profile.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          Next-turn model
          <select
            value={nextTurnModel}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings({ model: event.target.value || null }, "nextTurn"),
              )
            }
          >
            <option value="">Use chat/default</option>
            {nextTurnModelOptions.map((model) => (
              <option key={model.id} value={model.model}>
                {model.displayName} ({model.model})
              </option>
            ))}
          </select>
        </label>

        <label>
          Next-turn effort
          <select
            value={nextTurnEffort}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings(
                  { reasoningEffort: (event.target.value || null) as ReasoningEffort | null },
                  "nextTurn",
                ),
              )
            }
          >
            <option value="">Use chat/default</option>
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </label>

        <label>
          Next-turn speed
          <select
            value={nextTurnServiceTier}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings(
                  { serviceTier: (event.target.value || null) as CodexServiceTier | null },
                  "nextTurn",
                ),
              )
            }
          >
            <option value="">Use chat/default</option>
            <option value={FAST_CODEX_SERVICE_TIER}>Fast</option>
          </select>
        </label>

        <label>
          Next-turn permissions
          <select
            value={nextTurnPermissionMode}
            onChange={(event) =>
              void onAction(() =>
                window.codexVoice.setCodexSettings(
                  { permissionMode: (event.target.value || null) as CodexPermissionMode | null },
                  "nextTurn",
                ),
              )
            }
          >
            <option value="">Use chat/default</option>
            {CODEX_PERMISSION_PROFILES.map((profile) => (
              <option key={profile.mode} value={profile.mode}>
                {profile.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function SettingReadout({
  label,
  model,
  effort,
  speed,
  permission,
}: {
  label: string;
  model: string;
  effort: string;
  speed: string;
  permission: string;
}): React.ReactElement {
  return (
    <div className="setting-readout">
      <span>{label}</span>
      <strong>{model}</strong>
      <small>
        {effort} / {speed}
      </small>
      <small>{permission}</small>
    </div>
  );
}

function NativeSlashPanel(): React.ReactElement {
  const backed = ["/status", "/model", "/fast", "/review", "/compact", "/mcp", "/apps", "/plugins"];
  const projectCommands = ["/new", "/resume"];
  const recognized = ["/feedback", "/plan-mode", "/diff", "/init", "/permissions", "/agent", "/stop"];
  return (
    <section className="slash-panel">
      <div>
        <span className="label">App-server backed</span>
        <div className="slash-chip-row">
          {backed.map((command) => (
            <code key={command}>{command}</code>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Voice project controls</span>
        <div className="slash-chip-row">
          {projectCommands.map((command) => (
            <code key={command}>{command}</code>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Recognized, not wired</span>
        <div className="slash-chip-row muted">
          {recognized.map((command) => (
            <code key={command}>{command}</code>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "good" | "warn" | "muted" }): React.ReactElement {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}
