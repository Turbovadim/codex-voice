import { app } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VoiceSession } from "../shared/types";

type SessionIndex = {
  version: 1;
  sessions: VoiceSession[];
};

const INDEX_FILE = ".codex-voice-index.json";
const SESSION_FILE = ".codex-voice-session.json";

export class SessionStore {
  readonly baseFolder: string;
  private readonly indexPath: string;

  constructor(baseFolder = path.join(app.getPath("documents"), "Codex Voice Sessions")) {
    this.baseFolder = baseFolder;
    this.indexPath = path.join(baseFolder, INDEX_FILE);
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.baseFolder, { recursive: true });
    if (!existsSync(this.indexPath)) {
      await this.writeIndex({ version: 1, sessions: [] });
      await this.importExistingFolders();
    }
  }

  async listSessions(): Promise<VoiceSession[]> {
    const index = await this.readIndex();
    return index.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(id: string): Promise<VoiceSession | null> {
    const sessions = await this.listSessions();
    return sessions.find((session) => session.id === id) ?? null;
  }

  async getMostRecent(): Promise<VoiceSession | null> {
    const sessions = await this.listSessions();
    return sessions[0] ?? null;
  }

  async createSession(displayName?: string): Promise<VoiceSession> {
    const now = new Date();
    const id = randomUUID();
    const safeName = sanitizeSessionName(displayName || "Voice Session");
    const folderName = `${formatFolderTimestamp(now)} - ${safeName}`;
    const folderPath = await this.uniqueFolderPath(folderName);

    await mkdir(folderPath, { recursive: true });

    const session: VoiceSession = {
      id,
      displayName: displayName?.trim() || "Voice Session",
      folderPath,
      codexThreadId: null,
      model: null,
      reasoningEffort: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      lastSummary: null,
      lastStatus: "Created session folder.",
    };

    await this.upsertSession(session);
    return session;
  }

  async upsertSession(session: VoiceSession): Promise<VoiceSession> {
    await mkdir(session.folderPath, { recursive: true });
    const index = await this.readIndex();
    const nextSession = { ...session, updatedAt: new Date().toISOString() };
    const nextSessions = [
      nextSession,
      ...index.sessions.filter((existing) => existing.id !== session.id),
    ];
    await this.writeIndex({ version: 1, sessions: nextSessions });
    await writeFile(path.join(session.folderPath, SESSION_FILE), JSON.stringify(nextSession, null, 2));
    return nextSession;
  }

  async updateSession(id: string, patch: Partial<VoiceSession>): Promise<VoiceSession> {
    const existing = await this.getSession(id);
    if (!existing) {
      throw new Error(`Unknown voice session: ${id}`);
    }
    return this.upsertSession({ ...existing, ...patch });
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

  private async readIndex(): Promise<SessionIndex> {
    await mkdir(this.baseFolder, { recursive: true });
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as SessionIndex;
      return {
        version: 1,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeSession) : [],
      };
    } catch {
      return { version: 1, sessions: [] };
    }
  }

  private async writeIndex(index: SessionIndex): Promise<void> {
    await mkdir(this.baseFolder, { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  private async importExistingFolders(): Promise<void> {
    const entries = await readdir(this.baseFolder, { withFileTypes: true });
    const sessions: VoiceSession[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(this.baseFolder, entry.name, SESSION_FILE);
      if (!existsSync(sessionPath)) continue;
      try {
        const session = normalizeSession(JSON.parse(await readFile(sessionPath, "utf8")));
        sessions.push(session);
      } catch {
        // Ignore malformed sidecar files; the debug UI should remain bootable.
      }
    }
    if (sessions.length > 0) {
      await this.writeIndex({ version: 1, sessions });
    }
  }
}

function normalizeSession(value: unknown): VoiceSession {
  const session = value as VoiceSession;
  return {
    ...session,
    model: session.model ?? null,
    reasoningEffort: session.reasoningEffort ?? null,
  };
}

function sanitizeSessionName(name: string): string {
  return name
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .replace(/\s/g, "-")
    .toLowerCase() || "voice-session";
}

function formatFolderTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}
