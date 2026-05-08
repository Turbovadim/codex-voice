import type { VoiceChat } from "../../shared/types";

export type AppWindowKind = "voice" | "debug";

export type ContextMenuTarget =
  | {
      kind: "project";
      projectId: string;
      label: string;
      x: number;
      y: number;
    }
  | {
      kind: "chat";
      projectId: string;
      chatId: string;
      label: string;
      x: number;
      y: number;
    };

export type ArchivedChat = {
  projectId: string;
  projectName: string;
  chat: VoiceChat;
};

export type ChatSummary = {
  id: string;
  title: string;
  detail: string;
  tone: "active" | "waiting" | "idle";
  active: boolean;
};

export type RunAction = (action: () => Promise<unknown>) => Promise<void>;
