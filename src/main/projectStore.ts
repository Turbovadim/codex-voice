import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type CodexTurnOutput,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_CODEX_SERVICE_TIER,
  type CodexPermissionMode,
  type CodexServiceTier,
  type ReasoningEffort,
  type VoiceChat,
  type VoiceProject,
} from "../shared/types";

type ProjectIndex = {
  version: 1;
  projects: VoiceProject[];
};

type ListProjectsOptions = {
  includeArchived?: boolean;
};

type CodexGlobalState = {
  "project-order"?: unknown;
  "electron-saved-workspace-roots"?: unknown;
  "active-workspace-roots"?: unknown;
};

const INDEX_FILE = ".codex-voice-projects.json";
const PROJECT_FILE = ".codex-voice-project.json";
const EXTERNAL_PROJECTS_FOLDER = "linked-projects";

export class ProjectStore {
  readonly baseFolder: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly codexGlobalStatePath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(baseFolder = path.join(app.getPath("userData"), "workspace-links")) {
    this.baseFolder = baseFolder;
    this.indexPath = path.join(baseFolder, INDEX_FILE);
    this.lockPath = `${this.indexPath}.lock`;
    this.codexGlobalStatePath = path.join(process.env.CODEX_HOME || path.join(app.getPath("home"), ".codex"), ".codex-global-state.json");
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.baseFolder, { recursive: true });
    await this.enqueueMutation(async () => {
      const index = await this.readIndexFile();
      if (!index) {
        await this.writeIndex({ version: 1, projects: await this.readProjectsFromFolders() });
        return;
      }
      if (index.projects.length === 0) {
        const projects = await this.readProjectsFromFolders();
        if (projects.length > 0) {
          await this.writeIndex({ version: 1, projects });
        }
      }
    });
  }

  async listProjects(options: ListProjectsOptions = {}): Promise<VoiceProject[]> {
    const index = await this.readIndex();
    return index.projects
      .filter((project) => options.includeArchived || !project.archivedAt);
  }

  async listArchivedProjects(): Promise<VoiceProject[]> {
    const projects = await this.listProjects({ includeArchived: true });
    return projects.filter((project) => project.archivedAt);
  }

  async getProject(id: string, options: ListProjectsOptions = {}): Promise<VoiceProject | null> {
    const projects = await this.listProjects(options);
    return projects.find((project) => project.id === id) ?? null;
  }

  async getMostRecentProject(): Promise<VoiceProject | null> {
    const projects = await this.listProjects();
    return projects[0] ?? null;
  }

  async createProject(displayName?: string): Promise<VoiceProject> {
    const now = new Date();
    const id = randomUUID();
    const safeName = sanitizeProjectName(displayName || "Codex Workspace");
    const folderName = `${formatFolderTimestamp(now)} - ${safeName}`;
    const folderPath = await this.uniqueFolderPath(folderName);

    await mkdir(folderPath, { recursive: true });

    const project: VoiceProject = {
      id,
      displayName: displayName?.trim() || "Codex Workspace",
      folderPath,
      activeChatId: null,
      chats: [],
      codexThreadId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: DEFAULT_CODEX_SERVICE_TIER,
      permissionMode: DEFAULT_CODEX_PERMISSION_MODE,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      archivedAt: null,
      lastSummary: null,
      lastStatus: "Created project folder.",
    };

    await this.upsertProject(project);
    return project;
  }

  async ensureLinkedWorkspace(folderPath: string, displayName?: string): Promise<VoiceProject> {
    const resolvedFolderPath = path.resolve(folderPath);
    await mkdir(resolvedFolderPath, { recursive: true });
    await this.rememberCodexDesktopProject(resolvedFolderPath);

    const existing = (await this.listProjects({ includeArchived: true })).find(
      (project) => path.resolve(project.folderPath) === resolvedFolderPath,
    );
    if (existing) {
      return this.upsertProject({
        ...existing,
        displayName: displayName?.trim() || existing.displayName,
        archivedAt: null,
        lastStatus: "Linked to Codex workspace.",
      });
    }

    const now = new Date().toISOString();
    const project: VoiceProject = {
      id: projectIdForFolder(resolvedFolderPath),
      displayName: displayName?.trim() || path.basename(resolvedFolderPath) || "Codex Workspace",
      folderPath: resolvedFolderPath,
      activeChatId: null,
      chats: [],
      codexThreadId: null,
      model: null,
      reasoningEffort: null,
      serviceTier: DEFAULT_CODEX_SERVICE_TIER,
      permissionMode: DEFAULT_CODEX_PERMISSION_MODE,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      lastSummary: null,
      lastStatus: "Linked to Codex workspace.",
    };

    return this.upsertProject(project);
  }

  async upsertProject(project: VoiceProject): Promise<VoiceProject> {
    return this.enqueueMutation(async () => {
      await mkdir(project.folderPath, { recursive: true });
      const index = await this.readIndex();
      const nextProject = { ...project, updatedAt: new Date().toISOString() };
      const nextProjects = [
        nextProject,
        ...index.projects.filter((existing) => existing.id !== project.id),
      ];
      const projectFilePath = this.projectFilePath(nextProject);
      await mkdir(path.dirname(projectFilePath), { recursive: true });
      await this.writeJsonAtomic(projectFilePath, nextProject);
      await this.writeIndex({ version: 1, projects: nextProjects });
      return nextProject;
    });
  }

  async updateProject(id: string, patch: Partial<VoiceProject>): Promise<VoiceProject> {
    const existing = await this.getProject(id);
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${id}`);
    }
    return this.upsertProject({ ...existing, ...patch });
  }

  async archiveProject(id: string): Promise<VoiceProject> {
    const existing = await this.getProject(id, { includeArchived: true });
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${id}`);
    }
    if (existing.archivedAt) return existing;
    return this.upsertProject({
      ...existing,
      archivedAt: new Date().toISOString(),
      lastStatus: "Archived project.",
    });
  }

  async restoreProject(id: string): Promise<VoiceProject> {
    const existing = await this.getProject(id, { includeArchived: true });
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${id}`);
    }
    return this.upsertProject({
      ...existing,
      archivedAt: null,
      lastStatus: "Restored project.",
    });
  }

  async addChat(
    projectId: string,
    displayName: string,
    codexThreadId: string,
    settings: {
      model?: string | null;
      reasoningEffort?: ReasoningEffort | null;
      serviceTier?: CodexServiceTier | null;
      permissionMode?: CodexPermissionMode;
    } = {},
  ): Promise<VoiceProject> {
    const existing = await this.getProject(projectId);
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${projectId}`);
    }

    const now = new Date().toISOString();
    const model = settings.model ?? existing.model ?? DEFAULT_CODEX_MODEL;
    const reasoningEffort =
      settings.reasoningEffort ?? existing.reasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT;
    const serviceTier = settings.serviceTier ?? existing.serviceTier ?? DEFAULT_CODEX_SERVICE_TIER;
    const permissionMode = settings.permissionMode ?? existing.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE;
    const chat: VoiceChat = {
      id: randomUUID(),
      displayName: displayName.trim() || "New chat",
      codexThreadId,
      model,
      reasoningEffort,
      serviceTier,
      permissionMode,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      lastSummary: null,
      lastStatus: "Codex thread started.",
      lastTurnOutput: null,
    };

    return this.upsertProject({
      ...existing,
      activeChatId: chat.id,
      codexThreadId,
      chats: [...existing.chats, chat],
      lastStatus: `Active chat: ${chat.displayName}`,
    });
  }

  async archiveChat(projectId: string, chatId: string): Promise<VoiceProject> {
    return this.setChatArchived(projectId, chatId, new Date().toISOString());
  }

  async restoreChat(projectId: string, chatId: string): Promise<VoiceProject> {
    return this.setChatArchived(projectId, chatId, null);
  }

  async setActiveChat(projectId: string, chatId: string): Promise<VoiceProject> {
    const existing = await this.getProject(projectId);
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${projectId}`);
    }
    const chat = existing.chats.find((candidate) => candidate.id === chatId);
    if (!chat) {
      throw new Error(`Unknown chat: ${chatId}`);
    }
    return this.upsertProject({
      ...existing,
      activeChatId: chat.id,
      codexThreadId: chat.codexThreadId,
      lastStatus: `Active chat: ${chat.displayName}`,
    });
  }

  async updateChat(projectId: string, chatId: string, patch: Partial<VoiceChat>): Promise<VoiceProject> {
    const existing = await this.getProject(projectId);
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${projectId}`);
    }
    const now = new Date().toISOString();
    let activeThreadId = existing.codexThreadId;
    const chats = existing.chats.map((chat) => {
      if (chat.id !== chatId) return chat;
      const updated = { ...chat, ...patch, updatedAt: now };
      if (existing.activeChatId === chatId) activeThreadId = updated.codexThreadId;
      return updated;
    });
    if (!chats.some((chat) => chat.id === chatId)) {
      throw new Error(`Unknown chat: ${chatId}`);
    }
    return this.upsertProject({
      ...existing,
      chats,
      codexThreadId: activeThreadId,
      lastStatus: patch.lastStatus ?? existing.lastStatus,
      lastSummary: patch.lastSummary ?? existing.lastSummary,
    });
  }

  async replaceChats(projectId: string, chats: VoiceChat[], activeChatId?: string | null): Promise<VoiceProject> {
    const existing = await this.getProject(projectId);
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${projectId}`);
    }

    const unarchivedChats = chats.filter((chat) => !chat.archivedAt);
    const nextActiveChatId =
      activeChatId && unarchivedChats.some((chat) => chat.id === activeChatId)
        ? activeChatId
        : existing.activeChatId && unarchivedChats.some((chat) => chat.id === existing.activeChatId)
          ? existing.activeChatId
          : unarchivedChats[0]?.id ?? null;
    const activeChat = nextActiveChatId ? unarchivedChats.find((chat) => chat.id === nextActiveChatId) ?? null : null;

    return this.upsertProject({
      ...existing,
      activeChatId: nextActiveChatId,
      codexThreadId: activeChat?.codexThreadId ?? null,
      chats,
      lastStatus: chats.length ? "Synced Codex workspace threads." : "No Codex threads in this workspace yet.",
    });
  }

  private async setChatArchived(
    projectId: string,
    chatId: string,
    archivedAt: string | null,
  ): Promise<VoiceProject> {
    const existing = await this.getProject(projectId, { includeArchived: true });
    if (!existing) {
      throw new Error(`Unknown Codex workspace: ${projectId}`);
    }

    const now = new Date().toISOString();
    let changed = false;
    const chats = existing.chats.map((chat) => {
      if (chat.id !== chatId) return chat;
      changed = true;
      return {
        ...chat,
        archivedAt,
        updatedAt: now,
        lastStatus: archivedAt ? "Archived chat." : "Restored chat.",
      };
    });
    if (!changed) {
      throw new Error(`Unknown chat: ${chatId}`);
    }

    const currentActiveChat =
      existing.activeChatId && chats.find((chat) => chat.id === existing.activeChatId && !chat.archivedAt)
        ? existing.activeChatId
        : null;
    const restoredTarget = !archivedAt ? chats.find((chat) => chat.id === chatId) ?? null : null;
    const activeChatId =
      currentActiveChat ??
      (restoredTarget && !restoredTarget.archivedAt ? restoredTarget.id : null) ??
      chats.find((chat) => !chat.archivedAt)?.id ??
      null;
    const activeChat = activeChatId ? chats.find((chat) => chat.id === activeChatId) ?? null : null;

    return this.upsertProject({
      ...existing,
      activeChatId,
      codexThreadId: activeChat?.codexThreadId ?? null,
      chats,
      lastStatus: archivedAt ? "Archived chat." : "Restored chat.",
    });
  }

  private async uniqueFolderPath(folderName: string): Promise<string> {
    let candidate = path.join(this.baseFolder, folderName);
    let suffix = 2;
    while (existsSync(candidate)) {
      candidate = path.join(this.baseFolder, `${folderName} ${suffix}`);
      suffix += 1;
    }
    return candidate;
  }

  private async readIndex(): Promise<ProjectIndex> {
    await mkdir(this.baseFolder, { recursive: true });
    const index = await this.readIndexFile();
    const localIndex = index ?? { version: 1, projects: await this.readProjectsFromFolders() };
    return this.mergeCodexDesktopProjects(localIndex);
  }

  private async readIndexFile(): Promise<ProjectIndex | null> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as ProjectIndex;
      return {
        version: 1,
        projects: Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProject) : [],
      };
    } catch {
      return null;
    }
  }

  private async writeIndex(index: ProjectIndex): Promise<void> {
    await mkdir(this.baseFolder, { recursive: true });
    await this.writeJsonAtomic(this.indexPath, index);
  }

  private async mergeCodexDesktopProjects(index: ProjectIndex): Promise<ProjectIndex> {
    const desktopProjects = await this.readCodexDesktopProjects(index.projects);
    if (desktopProjects.length === 0) return index;

    const desktopIds = new Set(desktopProjects.map((project) => project.id));
    return {
      version: 1,
      projects: [
        ...desktopProjects,
        ...index.projects.filter((project) => !desktopIds.has(project.id) && project.archivedAt),
      ],
    };
  }

  private async readCodexDesktopProjects(existingProjects: VoiceProject[]): Promise<VoiceProject[]> {
    let parsed: CodexGlobalState;
    try {
      parsed = JSON.parse(await readFile(this.codexGlobalStatePath, "utf8")) as CodexGlobalState;
    } catch {
      return [];
    }

    const roots = orderedUniqueStrings(
      arrayOfStrings(parsed["project-order"]),
      arrayOfStrings(parsed["active-workspace-roots"]),
      arrayOfStrings(parsed["electron-saved-workspace-roots"]),
    ).map((folderPath) => path.resolve(folderPath));

    const existingByPath = new Map(existingProjects.map((project) => [path.resolve(project.folderPath), project]));
    const now = new Date().toISOString();
    return roots
      .filter((folderPath) => existsSync(folderPath))
      .map((folderPath) => {
        const existing = existingByPath.get(folderPath);
        const id = projectIdForFolder(folderPath);
        const displayName = path.basename(folderPath) || folderPath;
        return {
          id,
          displayName,
          folderPath,
          activeChatId: existing?.activeChatId ?? null,
          chats: existing?.chats ?? [],
          codexThreadId: existing?.codexThreadId ?? null,
          model: existing?.model ?? null,
          reasoningEffort: existing?.reasoningEffort ?? null,
          serviceTier: existing?.serviceTier ?? DEFAULT_CODEX_SERVICE_TIER,
          permissionMode: existing?.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
          createdAt: existing?.createdAt ?? now,
          updatedAt: existing?.updatedAt ?? now,
          archivedAt: null,
          lastSummary: existing?.lastSummary ?? null,
          lastStatus: existing?.lastStatus ?? "Codex Desktop project.",
        };
      });
  }

  private async rememberCodexDesktopProject(folderPath: string): Promise<void> {
    let parsed: CodexGlobalState;
    try {
      parsed = JSON.parse(await readFile(this.codexGlobalStatePath, "utf8")) as CodexGlobalState;
    } catch {
      parsed = {};
    }

    const projectOrder = orderedUniqueStrings([folderPath], arrayOfStrings(parsed["project-order"]));
    const savedRoots = orderedUniqueStrings([folderPath], arrayOfStrings(parsed["electron-saved-workspace-roots"]));
    const nextState = {
      ...parsed,
      "project-order": projectOrder,
      "electron-saved-workspace-roots": savedRoots,
      "active-workspace-roots": [folderPath],
    };

    await mkdir(path.dirname(this.codexGlobalStatePath), { recursive: true });
    await this.writeJsonAtomic(this.codexGlobalStatePath, nextState);
  }

  private projectFilePath(project: VoiceProject): string {
    const resolvedProjectFolder = path.resolve(project.folderPath);
    const resolvedBaseFolder = path.resolve(this.baseFolder);
    const relativeToBase = path.relative(resolvedBaseFolder, resolvedProjectFolder);
    if (relativeToBase && !relativeToBase.startsWith("..") && !path.isAbsolute(relativeToBase)) {
      return path.join(resolvedProjectFolder, PROJECT_FILE);
    }
    return path.join(this.baseFolder, EXTERNAL_PROJECTS_FOLDER, `${project.id}.json`);
  }

  private async readProjectsFromFolders(): Promise<VoiceProject[]> {
    const entries = await readdir(this.baseFolder, { withFileTypes: true });
    const projects: VoiceProject[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(this.baseFolder, entry.name, PROJECT_FILE);
      if (!existsSync(projectPath)) continue;
      try {
        const project = normalizeProject(JSON.parse(await readFile(projectPath, "utf8")));
        projects.push(project);
      } catch {
        // Ignore malformed sidecar files; the debug UI should remain bootable.
      }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}-${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
      await rename(tempPath, filePath);
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // Best-effort cleanup; preserve the original error.
      }
      throw error;
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(
      () => this.withMutationLock(operation),
      () => this.withMutationLock(operation),
    );
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireMutationLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async acquireMutationLock(): Promise<() => Promise<void>> {
    const staleAfterMs = 30_000;
    while (true) {
      try {
        await mkdir(this.lockPath);
        return async () => {
          try {
            await rmdir(this.lockPath);
          } catch {
            // A stale-lock cleanup race should not hide the successful write.
          }
        };
      } catch (error) {
        if (!isErrorWithCode(error, "EEXIST")) throw error;
        try {
          const lock = await stat(this.lockPath);
          if (Date.now() - lock.mtimeMs > staleAfterMs) {
            await rmdir(this.lockPath);
            continue;
          }
        } catch (lockError) {
          if (!isErrorWithCode(lockError, "ENOENT")) throw lockError;
        }
        await delay(25);
      }
    }
  }
}

function normalizeProject(value: unknown): VoiceProject {
  const project = value as VoiceProject & {
    activeChatId?: string | null;
    chats?: VoiceChat[];
  };
  const createdAt = stringOrNow(project.createdAt);
  const updatedAt = stringOrNow(project.updatedAt);
  const projectModel = stringOrNull(project.model) ?? DEFAULT_CODEX_MODEL;
  const projectReasoningEffort =
    reasoningEffortOrNull(project.reasoningEffort) ?? DEFAULT_CODEX_REASONING_EFFORT;
  const projectServiceTier = serviceTierOrNull(project.serviceTier) ?? DEFAULT_CODEX_SERVICE_TIER;
  const projectPermissionMode = permissionModeOrDefault(project.permissionMode);
  const chats = Array.isArray(project.chats)
    ? project.chats
        .map((chat) =>
          normalizeChat(
            chat,
            createdAt,
            updatedAt,
            projectModel,
            projectReasoningEffort,
            projectServiceTier,
            projectPermissionMode,
          ),
        )
        .filter((chat) => chat.id)
    : [];

  const unarchivedChats = chats.filter((chat) => !chat.archivedAt);
  const activeChatId =
    stringOrNull(project.activeChatId) && unarchivedChats.some((chat) => chat.id === project.activeChatId)
      ? project.activeChatId
      : unarchivedChats[0]?.id ?? null;
  const activeChat = unarchivedChats.find((chat) => chat.id === activeChatId) ?? null;

  return {
    ...project,
    createdAt,
    updatedAt,
    archivedAt: stringOrNull(project.archivedAt),
    activeChatId,
    chats,
    codexThreadId: activeChat?.codexThreadId ?? null,
    model: stringOrNull(project.model),
    reasoningEffort: reasoningEffortOrNull(project.reasoningEffort),
    serviceTier: serviceTierOrNull(project.serviceTier),
    permissionMode: permissionModeOrDefault(project.permissionMode),
  };
}

function normalizeChat(
  value: unknown,
  fallbackCreatedAt: string,
  fallbackUpdatedAt: string,
  fallbackModel: string,
  fallbackReasoningEffort: ReasoningEffort,
  fallbackServiceTier: CodexServiceTier | null,
  fallbackPermissionMode: CodexPermissionMode,
): VoiceChat {
  const chat = value as VoiceChat & {
    reasoningEffort?: ReasoningEffort | null;
    serviceTier?: CodexServiceTier | null;
    permissionMode?: CodexPermissionMode;
  };
  const hasStoredServiceTier = Object.prototype.hasOwnProperty.call(chat, "serviceTier");
  return {
    id: String(chat.id ?? randomUUID()),
    displayName: String(chat.displayName ?? "New chat"),
    codexThreadId: stringOrNull(chat.codexThreadId),
    model: stringOrNull(chat.model) ?? fallbackModel,
    reasoningEffort: reasoningEffortOrNull(chat.reasoningEffort) ?? fallbackReasoningEffort,
    serviceTier: hasStoredServiceTier ? serviceTierOrNull(chat.serviceTier) : fallbackServiceTier,
    permissionMode: permissionModeOrDefault(chat.permissionMode, fallbackPermissionMode),
    createdAt: stringOrNow(chat.createdAt, fallbackCreatedAt),
    updatedAt: stringOrNow(chat.updatedAt, fallbackUpdatedAt),
    archivedAt: stringOrNull(chat.archivedAt),
    lastSummary: chat.lastSummary ?? null,
    lastStatus: chat.lastStatus ?? null,
    lastTurnOutput: normalizeCodexTurnOutput(chat.lastTurnOutput),
  };
}

function normalizeCodexTurnOutput(value: unknown): CodexTurnOutput | null {
  const output = value as Partial<CodexTurnOutput> | null | undefined;
  if (!output || typeof output !== "object") return null;
  if (
    typeof output.threadId !== "string" ||
    typeof output.turnId !== "string" ||
    typeof output.status !== "string" ||
    typeof output.finalAssistantText !== "string"
  ) {
    return null;
  }
  return {
    threadId: output.threadId,
    turnId: output.turnId,
    status: output.status,
    finalAssistantText: output.finalAssistantText,
    startedAt: numberOrNull(output.startedAt),
    completedAt: numberOrNull(output.completedAt),
    durationMs: numberOrNull(output.durationMs),
    ...(typeof output.errorMessage === "string" && output.errorMessage ? { errorMessage: output.errorMessage } : {}),
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reasoningEffortOrNull(value: unknown): ReasoningEffort | null {
  return typeof value === "string" && ["none", "minimal", "low", "medium", "high", "xhigh"].includes(value)
    ? (value as ReasoningEffort)
    : null;
}

function serviceTierOrNull(value: unknown): CodexServiceTier | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function permissionModeOrDefault(value: unknown, fallback = DEFAULT_CODEX_PERMISSION_MODE): CodexPermissionMode {
  return typeof value === "string" && ["default", "auto-review", "full-access"].includes(value)
    ? (value as CodexPermissionMode)
    : fallback;
}

function stringOrNow(value: unknown, fallback = new Date().toISOString()): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function projectIdForFolder(folderPath: string): string {
  return `codex:${createHash("sha256").update(path.resolve(folderPath)).digest("hex").slice(0, 24)}`;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function orderedUniqueStrings(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const value of group) {
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function sanitizeProjectName(name: string): string {
  return name
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .replace(/\s/g, "-")
    .toLowerCase() || "voice-project";
}

function formatFolderTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}
