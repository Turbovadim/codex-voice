import type { VoiceChat, VoiceProject } from "../../shared/types";

export type TurnWaiter = {
  text: string;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type ThreadReadResponse = {
  thread?: {
    turns?: CodexThreadTurn[];
  };
};

export type ThreadListResponse = {
  data?: CodexThreadSummary[];
};

export type CodexThreadSummary = {
  id?: string;
  name?: string | null;
  preview?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  status?: unknown;
};

export type CodexThreadTurn = {
  id?: string;
  status?: string;
  items?: CodexThreadItem[];
  error?: { message?: string } | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
};

export type CodexThreadItem = {
  type?: string;
  text?: string;
  phase?: string | null;
};

export type ChatContext = {
  project: VoiceProject;
  chat: VoiceChat;
  recovered?: boolean;
};

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title: string | null }
  | { type: "custom"; instructions: string };
