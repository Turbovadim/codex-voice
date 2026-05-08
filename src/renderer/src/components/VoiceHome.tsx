import React, { useEffect, useMemo, useState } from "react";
import {
  CODEX_PERMISSION_PROFILES,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_CODEX_SERVICE_TIER,
  FAST_CODEX_SERVICE_TIER,
  type AppState,
  type ReasoningEffort,
  type VoiceProject,
} from "../../../shared/types";
import {
  archivedChatsForProjects,
  chatSummariesForProject,
  formatEffort,
  formatModelName,
  formatProjectTime,
  isFastServiceTier,
  modelsForValue,
  permissionProfile,
  supportsFastMode,
  voiceOrbAriaLabel,
  voiceStateLabel,
} from "../displayUtils";
import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  DownIcon,
  EllipsisIcon,
  FolderIcon,
  LightningIcon,
  PlusIcon,
  ShieldIcon,
  WaveformIcon,
} from "../icons";
import type { ChatSummary, ContextMenuTarget, RunAction } from "../rendererTypes";
import { ErrorOverlay } from "./ErrorOverlay";
import { VoicePendingRequestPanel } from "./PendingRequests";
import {
  ArchiveContextMenu,
  ArchivedDialog,
  FeaturedProjectCard,
  ProjectChatsPanel,
} from "./VoiceProjectPanels";

export function VoiceHome({
  state,
  error,
  voiceConnected,
  voiceConnecting,
  voicePaused,
  onAction,
  onDismissError,
  onOrbAction,
  onRefresh,
  onShowDebug,
  onToggleVoice,
}: {
  state: AppState;
  error: string | null;
  voiceConnected: boolean;
  voiceConnecting: boolean;
  voicePaused: boolean;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  onDismissError: () => void;
  onOrbAction: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onShowDebug: () => Promise<void>;
  onToggleVoice: () => Promise<void>;
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [switchChatOpen, setSwitchChatOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [newChatName, setNewChatName] = useState("");
  const [query, setQuery] = useState("");
  const projects = state.projects;
  const archivedProjects = state.archivedProjects;
  const activeProject = state.activeProject;
  const activeProjectId = state.runtime.activeProjectId;
  const showProjectChats = state.runtime.showProjectChats;
  const featuredProject = activeProject ?? projects[0] ?? null;
  const projectChats = useMemo(
    () => chatSummariesForProject(activeProject, state),
    [activeProject, state],
  );
  const archivedChats = useMemo(() => archivedChatsForProjects(projects), [projects]);
  const archivedCount = archivedProjects.length + archivedChats.length;
  const recentProjects = projects.slice(0, 3);
  const modelScope = activeProject ? "chat" : "nextTurn";
  const effectiveModel =
    state.codexSettings.nextTurnModel ??
    state.codexSettings.chatModel ??
    state.codexSettings.defaultModel ??
    DEFAULT_CODEX_MODEL;
  const effectiveEffort =
    state.codexSettings.nextTurnReasoningEffort ??
    state.codexSettings.chatReasoningEffort ??
    state.codexSettings.defaultReasoningEffort ??
    DEFAULT_CODEX_REASONING_EFFORT;
  const effectiveServiceTier =
    state.codexSettings.nextTurnServiceTier ??
    state.codexSettings.chatServiceTier ??
    state.codexSettings.defaultServiceTier ??
    DEFAULT_CODEX_SERVICE_TIER;
  const effectivePermissionMode =
    state.codexSettings.nextTurnPermissionMode ??
    state.codexSettings.chatPermissionMode ??
    state.codexSettings.defaultPermissionMode ??
    DEFAULT_CODEX_PERMISSION_MODE;
  const effectivePermission = permissionProfile(effectivePermissionMode);
  const modelOptions = modelsForValue(state.codexSettings.models, effectiveModel);
  const modelSupportsFast = supportsFastMode(modelOptions.find((model) => model.model === effectiveModel) ?? null);
  const fastModeOn = isFastServiceTier(effectiveServiceTier);
  const pendingRequests = state.runtime.pendingRequests;
  const primaryPendingRequest = pendingRequests[0] ?? null;
  const filteredProjects = projects.filter((project) => {
    const haystack = [
      project.displayName,
      project.folderPath,
      project.lastStatus ?? "",
      project.lastSummary ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  const voiceState = voiceStateLabel(state, voiceConnected, voiceConnecting, voicePaused);
  const voiceOrbLabel = voiceOrbAriaLabel(state, voiceConnected, voiceConnecting, voicePaused);

  useEffect(() => {
    setChatsOpen(false);
  }, [activeProject?.id]);

  useEffect(() => {
    setChatsOpen(showProjectChats);
  }, [showProjectChats]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  async function resumeProject(projectId: string): Promise<void> {
    await onAction(() => window.codexVoice.resumeProject(projectId));
    setBrowseOpen(false);
  }

  async function addWorkspaceProject(): Promise<void> {
    await onAction(async () => {
      const project = await window.codexVoice.addWorkspaceProject();
      if (project) {
        setBrowseOpen(false);
        setChatsOpen(true);
      }
    });
  }

  async function createNewChat(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = newChatName.trim();
    if (!name) return;
    await onAction(async () => {
      await window.codexVoice.createChat(name);
      setNewChatName("");
      setNewChatOpen(false);
      setChatsOpen(true);
    });
  }

  async function switchChat(chatId: string): Promise<void> {
    await onAction(async () => {
      await window.codexVoice.switchChat(chatId);
      setSwitchChatOpen(false);
      setChatsOpen(true);
    });
  }

  function openProjectContextMenu(
    event: React.MouseEvent<HTMLElement>,
    project: VoiceProject,
  ): void {
    event.preventDefault();
    setContextMenu({
      kind: "project",
      projectId: project.id,
      label: project.displayName,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openChatContextMenu(event: React.MouseEvent<HTMLElement>, chat: ChatSummary): void {
    if (!activeProject) return;
    event.preventDefault();
    setContextMenu({
      kind: "chat",
      projectId: activeProject.id,
      chatId: chat.id,
      label: chat.title,
      x: event.clientX,
      y: event.clientY,
    });
  }

  async function archiveContextTarget(): Promise<void> {
    const target = contextMenu;
    if (!target) return;
    setContextMenu(null);
    if (target.kind === "project") {
      await onAction(() => window.codexVoice.archiveProject(target.projectId));
      return;
    }
    await onAction(() => window.codexVoice.archiveChat(target.chatId, target.projectId));
  }

  async function restoreProject(projectId: string): Promise<void> {
    await onAction(() => window.codexVoice.restoreProject(projectId));
  }

  async function restoreChat(projectId: string, chatId: string): Promise<void> {
    await onAction(() => window.codexVoice.restoreChat(chatId, projectId));
  }

  async function saveApiKey(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onAction(async () => {
      await window.codexVoice.saveOpenAiApiKey(apiKey);
      setApiKey("");
      setApiKeyOpen(false);
    });
  }

  async function clearApiKey(): Promise<void> {
    await onAction(async () => {
      await window.codexVoice.clearOpenAiApiKey();
      setApiKey("");
      setApiKeyOpen(false);
    });
  }

  return (
    <main className="voice-home">
      <div className="voice-home-content">
        <header className="voice-home-header">
          <h1>
            Codex Voice <span>BETA</span>
          </h1>
          <div className="voice-menu-wrap">
            <button
              className="voice-icon-button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <EllipsisIcon />
            </button>
            {menuOpen && (
              <div className="voice-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void onShowDebug();
                  }}
                >
                  Debug UI
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void onRefresh();
                  }}
                >
                  Refresh
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setArchivedOpen(true);
                  }}
                >
                  Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setApiKeyOpen(true);
                  }}
                >
                  OpenAI API key
                </button>
                {voiceConnected && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void onToggleVoice();
                    }}
                  >
                    Disconnect voice
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        <div className="voice-home-scroll">
          <section className="voice-model-picker" aria-label="Model settings">
            <button
              className="voice-model-trigger"
              aria-expanded={modelOpen}
              onClick={() => setModelOpen((current) => !current)}
            >
              {fastModeOn && <LightningIcon />}
              <span className="voice-model-trigger-name">{formatModelName(effectiveModel)}</span>
              <span className="voice-model-trigger-separator" aria-hidden="true">·</span>
              <span className="voice-model-trigger-effort">{formatEffort(effectiveEffort)}</span>
              <DownIcon />
            </button>

            {modelOpen && (
              <div className="voice-model-panel">
                <label className="voice-model-field">
                  Model
                  <span className="voice-model-select-wrap">
                    <select
                      value={effectiveModel}
                      onChange={(event) => {
                        const model = event.target.value || null;
                        const nextModel = modelOptions.find((candidate) => candidate.model === model) ?? null;
                        const serviceTier =
                          model && !supportsFastMode(nextModel) ? DEFAULT_CODEX_SERVICE_TIER : effectiveServiceTier;
                        void onAction(() =>
                          window.codexVoice.setCodexSettings({ model, serviceTier }, modelScope),
                        );
                      }}
                    >
                      {modelOptions.length === 0 && (
                        <option value={effectiveModel}>{formatModelName(effectiveModel)}</option>
                      )}
                      {modelOptions.map((model) => (
                        <option key={model.id} value={model.model}>
                          {model.displayName || formatModelName(model.model)}
                        </option>
                      ))}
                    </select>
                    <DownIcon />
                  </span>
                </label>

                <div className="voice-effort-list">
                  <span>Reasoning effort</span>
                  {(["low", "medium", "high", "xhigh"] as ReasoningEffort[]).map((effort) => (
                    <button
                      key={effort}
                      className={effort === effectiveEffort ? "selected" : ""}
                      onClick={() =>
                        void onAction(() =>
                          window.codexVoice.setCodexSettings({ reasoningEffort: effort }, modelScope),
                        )
                      }
                    >
                      {formatEffort(effort)}
                      {effort === effectiveEffort && <CheckIcon />}
                    </button>
                  ))}
                </div>

                <div className="voice-speed-list">
                  <span>Speed</span>
                  <button
                    className={!fastModeOn ? "selected" : ""}
                    onClick={() =>
                      void onAction(() =>
                        window.codexVoice.setCodexSettings({ serviceTier: DEFAULT_CODEX_SERVICE_TIER }, modelScope),
                      )
                    }
                  >
                    <span>
                      Standard
                      <small>Default speed, normal usage</small>
                    </span>
                    {!fastModeOn && <CheckIcon />}
                  </button>
                  <button
                    className={fastModeOn ? "selected" : ""}
                    disabled={!modelSupportsFast}
                    onClick={() =>
                      void onAction(() =>
                        window.codexVoice.setCodexSettings({ serviceTier: FAST_CODEX_SERVICE_TIER }, modelScope),
                      )
                    }
                  >
                    <span>
                      Fast
                      <small>{modelSupportsFast ? "1.5x speed, increased usage" : "Not available for this model"}</small>
                    </span>
                    {fastModeOn && <CheckIcon />}
                  </button>
                </div>
              </div>
            )}

          </section>

          <section className="voice-hero" aria-label="Voice status">
            <button
              className={`voice-orb ${voiceState.tone}`}
              aria-label={voiceOrbLabel}
              onClick={() => void onOrbAction()}
            >
              <span className="voice-orb-shine" />
            </button>
            <div className="voice-state-line">
              <WaveformIcon />
              <span>{voiceState.label}</span>
            </div>
          </section>

          {error && <ErrorOverlay message={error} onDismiss={onDismissError} />}

          {primaryPendingRequest && (
            <VoicePendingRequestPanel
              request={primaryPendingRequest}
              requestCount={pendingRequests.length}
              onAction={onAction}
            />
          )}

          <section className="voice-project-region" aria-label="Codex workspace">
            <FeaturedProjectCard
              activeProjectId={activeProjectId}
              project={featuredProject}
              chatsOpen={chatsOpen}
              onCreate={() => setBrowseOpen(true)}
              onResume={resumeProject}
              onOpenMenu={openProjectContextMenu}
              onToggleChats={() => {
                const next = !chatsOpen;
                setChatsOpen(next);
                void onAction(() => window.codexVoice.showProjectChats(next));
              }}
            />

            {chatsOpen && activeProject ? (
              <ProjectChatsPanel
                projectName={activeProject.displayName}
                chats={projectChats}
                onNewChat={() => setNewChatOpen(true)}
                onSwitchChat={() => setSwitchChatOpen(true)}
                onSelectChat={switchChat}
                onOpenChatMenu={openChatContextMenu}
              />
            ) : (
              <div className="voice-actions">
                <button className="voice-action-button" onClick={() => void addWorkspaceProject()}>
                  <PlusIcon />
                  <span>Add project</span>
                </button>
                <button className="voice-action-button" onClick={() => setBrowseOpen(true)}>
                  <FolderIcon />
                  <span>Browse projects</span>
                </button>
              </div>
            )}

            {(!chatsOpen || !activeProject) && (
              <div className="recent-block">
                <h2>Projects</h2>
                <div className="recent-list">
                  {recentProjects.map((project) => (
                    <button
                      key={project.id}
                      className="recent-row"
                      onClick={() => void resumeProject(project.id)}
                      onContextMenu={(event) => openProjectContextMenu(event, project)}
                    >
                      <span>
                        <strong>{project.displayName}</strong>
                        <small>{formatProjectTime(project.updatedAt)}</small>
                      </span>
                      <ChevronIcon />
                    </button>
                  ))}
                  {recentProjects.length === 0 && (
                    <div className="recent-empty">Add a workspace folder to begin.</div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="voice-footer">
          <span className={`voice-dot ${state.runtime.ready ? "ready" : ""}`} />
          <span>{state.runtime.ready ? "Codex app-server connected" : "Codex app-server starting"}</span>
          <div className="voice-permission-wrap footer-permissions">
            <button
              className={`voice-permission-trigger ${effectivePermissionMode}`}
              aria-expanded={permissionsOpen}
              onClick={() => setPermissionsOpen((current) => !current)}
            >
              <ShieldIcon />
              <span>{effectivePermission.displayName}</span>
              <DownIcon />
            </button>

            {permissionsOpen && (
              <div className="voice-permission-menu" role="menu">
                {CODEX_PERMISSION_PROFILES.map((profile) => (
                  <button
                    key={profile.mode}
                    className={profile.mode === effectivePermissionMode ? "selected" : ""}
                    role="menuitemradio"
                    aria-checked={profile.mode === effectivePermissionMode}
                    onClick={() =>
                      void onAction(() =>
                        window.codexVoice.setCodexSettings({ permissionMode: profile.mode }, modelScope),
                      )
                    }
                  >
                    <ShieldIcon />
                    <span>{profile.displayName}</span>
                    {profile.mode === effectivePermissionMode && <CheckIcon />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </footer>
      </div>

      {browseOpen && (
        <div className="voice-modal-backdrop" role="presentation">
          <section className="voice-dialog browse-dialog" aria-label="Browse projects">
            <div className="voice-dialog-header">
              <h2>Browse projects</h2>
              <button type="button" aria-label="Close" onClick={() => setBrowseOpen(false)}>
                <CloseIcon />
              </button>
            </div>
            <label className="voice-field">
              Search
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
              />
            </label>
            <div className="voice-dialog-actions browse-actions">
              <button type="button" className="voice-primary" onClick={() => void addWorkspaceProject()}>
                Add project
              </button>
            </div>
            <div className="browse-list">
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  className="browse-row"
                  onClick={() => void resumeProject(project.id)}
                  onContextMenu={(event) => openProjectContextMenu(event, project)}
                >
                  <FolderIcon />
                  <span>
                    <strong>{project.displayName}</strong>
                    <small>{formatProjectTime(project.updatedAt)}</small>
                  </span>
                  <ChevronIcon />
                </button>
              ))}
              {filteredProjects.length === 0 && <p className="browse-empty">No matching projects.</p>}
            </div>
          </section>
        </div>
      )}

      {newChatOpen && (
        <div className="voice-modal-backdrop" role="presentation">
          <form className="voice-dialog" onSubmit={(event) => void createNewChat(event)}>
            <div className="voice-dialog-header">
              <h2>New chat</h2>
              <button type="button" aria-label="Close" onClick={() => setNewChatOpen(false)}>
                <CloseIcon />
              </button>
            </div>
            <label className="voice-field">
              Chat name
              <input
                autoFocus
                value={newChatName}
                onChange={(event) => setNewChatName(event.target.value)}
                placeholder="Research thread"
              />
            </label>
            <div className="voice-dialog-actions">
              <button type="button" onClick={() => setNewChatOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="voice-primary" disabled={!newChatName.trim()}>
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {switchChatOpen && (
        <div className="voice-modal-backdrop" role="presentation">
          <section className="voice-dialog browse-dialog" aria-label="Switch chat">
            <div className="voice-dialog-header">
              <h2>Switch chat</h2>
              <button type="button" aria-label="Close" onClick={() => setSwitchChatOpen(false)}>
                <CloseIcon />
              </button>
            </div>
            <div className="browse-list">
              {projectChats.map((chat) => (
                <button
                  key={chat.id}
                  className={`browse-row ${chat.active ? "selected-chat" : ""}`}
                  onClick={() => void switchChat(chat.id)}
                >
                  <span className={`chat-status-dot ${chat.tone}`} />
                  <span>
                    <strong>{chat.title}</strong>
                    <small>{chat.detail}</small>
                  </span>
                  <span className="browse-row-trailing">
                    {chat.active && <span className="active-chat-pill">Active</span>}
                    <ChevronIcon />
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {apiKeyOpen && (
        <div className="voice-modal-backdrop" role="presentation">
          <form className="voice-dialog api-key-dialog" onSubmit={(event) => void saveApiKey(event)}>
            <div className="voice-dialog-header">
              <h2>OpenAI API key</h2>
              <button type="button" aria-label="Close" onClick={() => setApiKeyOpen(false)}>
                <CloseIcon />
              </button>
            </div>
            <p className="voice-dialog-note">
              {state.realtime.available
                ? `A key is configured from ${
                    state.realtime.apiKeySource === "environment" ? "the environment" : "saved settings"
                  }.`
                : "Add a key to enable Realtime voice."}
            </p>
            <label className="voice-field">
              API key
              <input
                autoFocus
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={state.realtime.available ? "Enter a new key to replace saved key" : "sk-..."}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="voice-dialog-actions split-actions">
              <button
                type="button"
                onClick={() => void clearApiKey()}
              >
                Clear saved key
              </button>
              <span />
              <button type="button" onClick={() => setApiKeyOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="voice-primary" disabled={!apiKey.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {archivedOpen && (
        <ArchivedDialog
          projects={archivedProjects}
          chats={archivedChats}
          onClose={() => setArchivedOpen(false)}
          onRestoreProject={restoreProject}
          onRestoreChat={restoreChat}
        />
      )}

      {contextMenu && (
        <ArchiveContextMenu
          target={contextMenu}
          onArchive={() => void archiveContextTarget()}
        />
      )}
    </main>
  );
}
