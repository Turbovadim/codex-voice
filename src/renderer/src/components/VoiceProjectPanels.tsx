import React from "react";
import type { VoiceProject } from "../../../shared/types";
import { formatProjectTime } from "../displayUtils";
import { ChevronIcon, CloseIcon, FolderIcon, PlusIcon, SwitchIcon } from "../icons";
import type { ArchivedChat, ChatSummary, ContextMenuTarget } from "../rendererTypes";

export function FeaturedProjectCard({
  activeProjectId,
  chatsOpen,
  project,
  onCreate,
  onResume,
  onOpenMenu,
  onToggleChats,
}: {
  activeProjectId: string | null;
  chatsOpen: boolean;
  project: VoiceProject | null;
  onCreate: () => void;
  onResume: (projectId: string) => Promise<void>;
  onOpenMenu: (event: React.MouseEvent<HTMLElement>, project: VoiceProject) => void;
  onToggleChats: () => void;
}): React.ReactElement {
  if (!project) {
    return (
      <button className="featured-project-card empty-feature" onClick={onCreate}>
        <span className="voice-folder-tile">
          <FolderIcon />
          </span>
          <span className="featured-copy">
          <strong>No project selected</strong>
          <small>Add a workspace folder to begin</small>
        </span>
        <ChevronIcon />
      </button>
    );
  }

  const active = project.id === activeProjectId;
  return (
    <button
      className={`featured-project-card ${chatsOpen && active ? "expanded" : ""}`}
      aria-expanded={active ? chatsOpen : undefined}
      onContextMenu={(event) => onOpenMenu(event, project)}
      onClick={() => {
        if (active) {
          onToggleChats();
          return;
        }
        void onResume(project.id);
      }}
    >
      <span className="voice-folder-tile">
        <FolderIcon />
      </span>
      <span className="featured-copy">
        <strong>{project.displayName}</strong>
        <small>
          {formatProjectTime(project.updatedAt)}
          {active && (
            <>
              <span className="voice-meta-dot">.</span>
              <span className="active-project-text">Active project</span>
            </>
          )}
        </small>
      </span>
      <ChevronIcon className={chatsOpen && active ? "chevron-open" : ""} />
    </button>
  );
}

export function ProjectChatsPanel({
  projectName,
  chats,
  onNewChat,
  onSwitchChat,
  onSelectChat,
  onOpenChatMenu,
}: {
  projectName: string;
  chats: ChatSummary[];
  onNewChat: () => void;
  onSwitchChat: () => void;
  onSelectChat: (chatId: string) => Promise<void>;
  onOpenChatMenu: (event: React.MouseEvent<HTMLElement>, chat: ChatSummary) => void;
}): React.ReactElement {
  const activeChat = chats.find((chat) => chat.active) ?? null;
  const visibleChats = visiblePanelChats(chats);
  return (
    <div className="project-chats-panel">
      <div className="project-chats-header">
        <div>
          <h2>Chats in {projectName}</h2>
          {activeChat && (
            <p>
              Active chat: <strong>{activeChat.title}</strong>
            </p>
          )}
        </div>
        <span>{chats.length}</span>
      </div>
      <div className="project-chat-list">
        {visibleChats.map((chat) => (
          <button
            key={chat.id}
            className={`project-chat-row ${chat.active ? "active" : ""}`}
            onClick={() => void onSelectChat(chat.id)}
            onContextMenu={(event) => onOpenChatMenu(event, chat)}
          >
            <span className={`chat-status-dot ${chat.tone}`} />
            <span className="project-chat-copy">
              <strong>{chat.title}</strong>
              <small>{chat.detail}</small>
            </span>
            {chat.active && (
              <span className="project-chat-trailing">
                <span className="active-chat-pill">Active</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="voice-actions chat-actions">
        <button className="voice-action-button" type="button" onClick={onNewChat}>
          <PlusIcon />
          <span>New chat</span>
        </button>
        <button className="voice-action-button" type="button" onClick={onSwitchChat}>
          <SwitchIcon />
          <span>{chats.length > visibleChats.length ? "All chats" : "Switch chat"}</span>
        </button>
      </div>
    </div>
  );
}

function visiblePanelChats(chats: ChatSummary[]): ChatSummary[] {
  const active = chats.find((chat) => chat.active) ?? null;
  const recent = chats.filter((chat) => !chat.active).slice(0, active ? 7 : 8);
  return active ? [active, ...recent] : recent;
}

export function ArchiveContextMenu({
  target,
  onArchive,
}: {
  target: ContextMenuTarget;
  onArchive: () => void;
}): React.ReactElement {
  const left = Math.max(8, Math.min(target.x, window.innerWidth - 188));
  const top = Math.max(8, Math.min(target.y, window.innerHeight - 54));
  return (
    <div
      className="voice-context-menu"
      role="menu"
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
    >
      <button role="menuitem" onClick={onArchive}>
        {target.kind === "project" ? "Archive project" : "Archive chat"}
      </button>
    </div>
  );
}

export function ArchivedDialog({
  projects,
  chats,
  onClose,
  onRestoreProject,
  onRestoreChat,
}: {
  projects: VoiceProject[];
  chats: ArchivedChat[];
  onClose: () => void;
  onRestoreProject: (projectId: string) => Promise<void>;
  onRestoreChat: (projectId: string, chatId: string) => Promise<void>;
}): React.ReactElement {
  const empty = projects.length === 0 && chats.length === 0;
  return (
    <div className="voice-modal-backdrop" role="presentation">
      <section className="voice-dialog archived-dialog" aria-label="Archived">
        <div className="voice-dialog-header">
          <h2>Archived</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {empty ? (
          <p className="browse-empty">Archived chats and projects will appear here.</p>
        ) : (
          <div className="archived-sections">
            {projects.length > 0 && (
              <section className="archived-section">
                <h3>Projects</h3>
                <div className="archived-list">
                  {projects.map((project) => (
                    <article key={project.id} className="archived-row">
                      <FolderIcon />
                      <span>
                        <strong>{project.displayName}</strong>
                        <small>{project.archivedAt ? formatProjectTime(project.archivedAt) : "Archived"}</small>
                      </span>
                      <button type="button" onClick={() => void onRestoreProject(project.id)}>
                        Restore
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {chats.length > 0 && (
              <section className="archived-section">
                <h3>Chats</h3>
                <div className="archived-list">
                  {chats.map(({ projectId, projectName, chat }) => (
                    <article key={chat.id} className="archived-row">
                      <span className="chat-status-dot idle" />
                      <span>
                        <strong>{chat.displayName}</strong>
                        <small>
                          {projectName}
                          <span className="voice-meta-dot">.</span>
                          {chat.archivedAt ? formatProjectTime(chat.archivedAt) : "Archived"}
                        </small>
                      </span>
                      <button type="button" onClick={() => void onRestoreChat(projectId, chat.id)}>
                        Restore
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
