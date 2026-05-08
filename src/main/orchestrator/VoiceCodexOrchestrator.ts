import { EventEmitter } from "node:events";
import type {
  AppEvent,
  AppState,
  ApprovalDecision,
  CodexActionResult,
  CodexChatRuntime,
  CodexModelSummary,
  CodexPermissionMode,
  CodexRuntimeState,
  CodexServiceTier,
  CodexSettings,
  CodexSettingsScope,
  CodexThreadTokenUsage,
  CodexTurnOutput,
  PendingCodexRequest,
  ReasoningEffort,
  ToolQuestionAnswer,
  VoiceChat,
  VoiceProject,
} from "../../shared/types";
import {
  CODEX_PERMISSION_PROFILES,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_CODEX_SERVICE_TIER,
  FAST_CODEX_SERVICE_TIER,
} from "../../shared/types";
import { CodexBridge, type CodexJsonMessage } from "../codexBridge";
import { createRealtimeClientSecret, realtimeConfig } from "../realtime";
import { ProjectStore } from "../projectStore";

import type {
  ChatContext,
  CodexThreadSummary,
  ThreadListResponse,
  ThreadReadResponse,
  TurnWaiter,
} from "./types";
import {
  activeChatForProject,
  codexThreadDeveloperInstructions,
  finalAssistantTextFromTurn,
  isMissingCodexThreadError,
  numberOrNull,
  titleFromText,
  titleFromThread,
  unixSecondsToIso,
  updatedChatTitle,
  describeThreadSummaryStatus,
} from "./threadText";
import {
  describeServerRequest,
  dynamicToolResponseFromMcpResult,
  isAcceptDecision,
  normalizeToolQuestionAnswers,
  responseForDecision,
  stringField,
  type ServerRequestResponse,
} from "./serverRequests";
import { statusFromNotification } from "./notifications";
import {
  permissionModeFromText,
  permissionParams,
  permissionProfile,
} from "./permissions";
import {
  describeThreadStatus,
  describeReviewTarget,
  formatApps,
  formatConfigValue,
  formatServiceTier,
  formatMcpServers,
  formatModelList,
  formatPlugins,
  formatRateLimit,
  formatTokenUsage,
  isFastServiceTier,
  nativeSlashHelpText,
  nativeUnsupportedSlashCommand,
  parseModelSlashArgs,
  parseReviewSlashArgs,
  parseSlashInput,
  settingsText,
} from "./slashCommands";

export class VoiceCodexOrchestrator extends EventEmitter {
  private activeProjectId: string | null = null;
  private showProjectChatsFlag = false;
  private nextTurnModel: string | null = null;
  private nextTurnReasoningEffort: ReasoningEffort | null = null;
  private nextTurnServiceTier: CodexServiceTier | null = null;
  private nextTurnPermissionMode: CodexPermissionMode | null = null;
  private defaultModel: string | null = DEFAULT_CODEX_MODEL;
  private defaultReasoningEffort: ReasoningEffort | null = DEFAULT_CODEX_REASONING_EFFORT;
  private defaultServiceTier: CodexServiceTier | null = DEFAULT_CODEX_SERVICE_TIER;
  private defaultPermissionMode: CodexPermissionMode = DEFAULT_CODEX_PERMISSION_MODE;
  private models: CodexModelSummary[] = [];
  private status = "Starting Codex app-server.";
  private pendingRequests = new Map<string, PendingCodexRequest>();
  private turnWaiters = new Map<string, TurnWaiter>();
  private activeTurnByThread = new Map<string, string>();
  private activeTurnModelByThread = new Map<string, string | null>();
  private activeTurnReasoningEffortByThread = new Map<string, ReasoningEffort | null>();
  private activeTurnServiceTierByThread = new Map<string, CodexServiceTier | null>();
  private activeTurnPermissionModeByThread = new Map<string, CodexPermissionMode | null>();
  private threadByTurn = new Map<string, string>();
  private tokenUsageByThread = new Map<string, CodexThreadTokenUsage>();
  private threadStatusByThread = new Map<string, string>();
  private resumeProjectRunId = 0;

  constructor(
    private readonly store: ProjectStore,
    private readonly codex: CodexBridge,
  ) {
    super();
    this.codex.on("notification", (message) => this.handleNotification(message as CodexJsonMessage));
    this.codex.on("serverRequest", (message) => this.handleServerRequest(message as CodexJsonMessage));
    this.codex.on("stderr", (text) => this.emitEvent("codex", "stderr", text));
    this.codex.on("exit", (info) => {
      this.status = "Codex app-server exited.";
      this.emitEvent("codex", "exit", `Codex app-server exited: ${JSON.stringify(info)}`, info);
      this.emitState();
    });
  }

  async initialize(): Promise<void> {
    await this.store.ensureReady();
    await this.codex.start();
    await this.refreshModels();
    const initialProject = await this.store.getMostRecentProject();
    if (initialProject) {
      this.activeProjectId = initialProject.id;
      this.showProjectChatsFlag = true;
      await this.syncWorkspaceThreads(initialProject.id);
    }
    this.status = "Ready.";
    this.emitEvent("app", "ready", "Codex app-server is ready.");
    this.emitState();
  }

  async attachWorkspace(folderPath: string): Promise<VoiceProject> {
    const linked = await this.store.ensureLinkedWorkspace(folderPath);
    this.activeProjectId = linked.id;
    this.showProjectChatsFlag = true;
    const synced = await this.syncWorkspaceThreads(linked.id);
    this.status = `Attached Codex workspace: ${synced.displayName}`;
    this.emitEvent("app", "workspaceAttached", this.status, {
      projectId: synced.id,
      folderPath: synced.folderPath,
      threads: synced.chats.length,
    });
    this.emitState();
    return synced;
  }

  shutdown(): void {
    this.codex.stop();
  }

  async state(): Promise<AppState> {
    const projects = await this.store.listProjects();
    const archivedProjects = await this.store.listArchivedProjects();
    let activeProject = this.activeProjectId
      ? projects.find((project) => project.id === this.activeProjectId) ?? null
      : null;
    if (this.activeProjectId && !activeProject) {
      this.activeProjectId = null;
      this.showProjectChatsFlag = false;
      activeProject = null;
    }
    return {
      baseFolder: this.store.baseFolder,
      projects,
      archivedProjects,
      activeProject,
      runtime: this.runtimeState(activeProject, projects),
      codexSettings: this.codexSettings(activeProject),
      realtime: realtimeConfig(),
    };
  }

  async createProject(name?: string): Promise<VoiceProject> {
    const project = await this.store.createProject(name);
    this.activeProjectId = project.id;
    this.showProjectChatsFlag = false;
    this.status = `Active project: ${project.displayName}`;
    this.emitEvent("app", "projectCreated", `Created project "${project.displayName}".`, project);
    this.emitState();
    return project;
  }

  async resumeProject(projectId: string): Promise<VoiceProject> {
    const project = await this.store.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);

    const runId = ++this.resumeProjectRunId;
    this.activeProjectId = project.id;
    this.showProjectChatsFlag = false;
    this.status = `Opening project: ${project.displayName}`;
    this.emitEvent("app", "projectSelected", `Selected project "${project.displayName}".`, project);
    this.emitState();

    void this.hydrateResumedProject(project.id, runId);
    return project;
  }

  private async hydrateResumedProject(projectId: string, runId: number): Promise<void> {
    try {
      const project = await this.syncWorkspaceThreads(
        projectId,
        () => runId === this.resumeProjectRunId && this.activeProjectId === projectId,
      );
      if (runId !== this.resumeProjectRunId || this.activeProjectId !== project.id) {
        return;
      }
      const chat = activeChatForProject(project);
      if (!chat) {
        this.activeProjectId = project.id;
        this.showProjectChatsFlag = false;
        this.status = `Resumed project: ${project.displayName}`;
        this.emitEvent("app", "projectResumed", `Resumed project "${project.displayName}".`, project);
        this.emitState();
        return;
      }

      const resumed = await this.resumeChatThread(project, chat);

      const updated = await this.store.updateProject(resumed.project.id, {
        activeChatId: resumed.chat.id,
        codexThreadId: resumed.chat.codexThreadId,
        lastStatus: resumed.recovered ? "Started a fresh Codex thread." : "Codex thread resumed.",
      });
      if (runId !== this.resumeProjectRunId || this.activeProjectId !== updated.id) {
        return;
      }
      this.activeProjectId = updated.id;
      this.showProjectChatsFlag = false;
      this.status = resumed.recovered
        ? `Recovered project chat: ${resumed.chat.displayName}`
        : `Resumed project: ${updated.displayName}`;
      this.emitEvent("app", "projectResumed", `Resumed project "${updated.displayName}".`, updated);
      this.emitState();
    } catch (error) {
      if (runId !== this.resumeProjectRunId || this.activeProjectId !== projectId) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.status = `Unable to finish opening project: ${message}`;
      this.emitEvent("app", "projectResumeFailed", this.status, { projectId, error: message });
      this.emitState();
    }
  }

  async archiveProject(projectId: string): Promise<VoiceProject> {
    const updated = await this.store.archiveProject(projectId);
    if (this.activeProjectId === projectId) {
      this.activeProjectId = null;
      this.showProjectChatsFlag = false;
    }
    this.status = `Archived project: ${updated.displayName}`;
    this.emitEvent("app", "projectArchived", this.status, updated);
    this.emitState();
    return updated;
  }

  async restoreProject(projectId: string): Promise<VoiceProject> {
    const updated = await this.store.restoreProject(projectId);
    this.status = `Restored project: ${updated.displayName}`;
    this.emitEvent("app", "projectRestored", this.status, updated);
    this.emitState();
    return updated;
  }

  async createChat(name: string, projectId?: string): Promise<VoiceProject> {
    const displayName = name.trim();
    if (!displayName) throw new Error("Chat name is required.");
    const project = await this.requireProject(projectId);
    const updated = await this.startChatThread(project, displayName);
    this.activeProjectId = updated.id;
    this.showProjectChatsFlag = true;
    this.status = `Active chat: ${displayName}`;
    this.emitEvent("app", "chatCreated", `Created chat "${displayName}".`, activeChatForProject(updated));
    this.emitState();
    return updated;
  }

  async switchChat(chatId: string, projectId?: string): Promise<VoiceProject> {
    const project = projectId ? await this.requireProject(projectId) : await this.requireProjectForChat(chatId);
    const chat = project.chats.find((candidate) => candidate.id === chatId);
    if (!chat) throw new Error(`Unknown chat: ${chatId}`);
    if (!chat.codexThreadId) throw new Error(`Chat "${chat.displayName}" does not have a Codex thread id.`);

    const resumed = await this.resumeChatThread(project, chat);

    const updated = await this.store.setActiveChat(resumed.project.id, resumed.chat.id);
    this.activeProjectId = updated.id;
    this.showProjectChatsFlag = true;
    this.status = resumed.recovered
      ? `Recovered and switched to chat: ${resumed.chat.displayName}`
      : `Active chat: ${resumed.chat.displayName}`;
    this.emitEvent("app", "chatSwitched", `Switched to chat "${resumed.chat.displayName}".`, resumed.chat);
    this.emitState();
    return updated;
  }

  async archiveChat(chatId: string, projectId?: string): Promise<VoiceProject> {
    const project = projectId ? await this.requireProject(projectId) : await this.requireProjectForChat(chatId);
    const chat = project.chats.find((candidate) => candidate.id === chatId && !candidate.archivedAt);
    if (!chat) throw new Error(`Unknown chat: ${chatId}`);

    const updated = await this.store.archiveChat(project.id, chat.id);
    if (this.activeProjectId === project.id) {
      this.activeProjectId = updated.id;
      this.showProjectChatsFlag = Boolean(updated.activeChatId);
    }
    this.status = `Archived chat: ${chat.displayName}`;
    this.emitEvent("app", "chatArchived", this.status, { projectId: project.id, chatId: chat.id });
    this.emitState();
    return updated;
  }

  async restoreChat(chatId: string, projectId?: string): Promise<VoiceProject> {
    const project = projectId
      ? await this.store.getProject(projectId, { includeArchived: true })
      : await this.findProjectForChat(chatId, true);
    if (!project) throw new Error(`Unknown chat: ${chatId}`);
    const chat = project.chats.find((candidate) => candidate.id === chatId);
    if (!chat) throw new Error(`Unknown chat: ${chatId}`);

    const updated = await this.store.restoreChat(project.id, chat.id);
    this.status = `Restored chat: ${chat.displayName}`;
    this.emitEvent("app", "chatRestored", this.status, { projectId: project.id, chatId: chat.id });
    this.emitState();
    return updated;
  }

  async listChats(projectId?: string): Promise<VoiceChat[]> {
    const project = await this.requireProject(projectId);
    const synced = await this.syncWorkspaceThreads(project.id);
    return synced.chats.filter((chat) => !chat.archivedAt);
  }

  async showProjectChats(open = true): Promise<void> {
    this.showProjectChatsFlag = open;
    this.status = open ? "Showing open chats." : "Hiding open chats.";
    this.emitEvent("app", "showProjectChats", this.status, { open });
    this.emitState();
  }

  async sendToCodex(text: string, chatId?: string): Promise<CodexActionResult> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Cannot send an empty request to Codex.");

    if (trimmed.startsWith("/")) {
      return this.handleNativeSlashCommand(trimmed);
    }

    let context: ChatContext;
    if (!this.activeProjectId && !chatId) {
      const project = await this.createProject(titleFromText(trimmed));
      const updated = await this.startChatThread(project, titleFromText(trimmed));
      context = this.requireActiveChatContextFromProject(updated);
    } else {
      context = await this.requireChatContextForPrompt(trimmed, chatId);
    }
    const { project, chat } = await this.resumeChatThread(context.project, context.chat);
    if (!chat.codexThreadId) throw new Error("Active chat is missing a Codex thread id.");

    const turnSettings = this.resolveTurnSettings(project, chat);
    const result = (await this.codex.request("turn/start", {
      threadId: chat.codexThreadId,
      cwd: project.folderPath,
      ...permissionParams(turnSettings.permissionMode),
      personality: "friendly",
      ...(turnSettings.model ? { model: turnSettings.model } : {}),
      ...(turnSettings.serviceTier ? { serviceTier: turnSettings.serviceTier } : {}),
      ...(turnSettings.reasoningEffort ? { effort: turnSettings.reasoningEffort } : {}),
      input: [
        {
          type: "text",
          text: trimmed,
          text_elements: [],
        },
      ],
    })) as { turn?: { id?: string } };

    const turnId = result.turn?.id;
    if (!turnId) throw new Error("Codex did not return a turn id.");

    this.activeTurnByThread.set(chat.codexThreadId, turnId);
    this.threadByTurn.set(turnId, chat.codexThreadId);
    this.activeTurnModelByThread.set(chat.codexThreadId, turnSettings.model);
    this.activeTurnReasoningEffortByThread.set(chat.codexThreadId, turnSettings.reasoningEffort);
    this.activeTurnServiceTierByThread.set(chat.codexThreadId, turnSettings.serviceTier);
    this.activeTurnPermissionModeByThread.set(chat.codexThreadId, turnSettings.permissionMode);
    this.nextTurnModel = null;
    this.nextTurnReasoningEffort = null;
    this.nextTurnServiceTier = null;
    this.nextTurnPermissionMode = null;
    this.status = `${chat.displayName}: Codex is working.`;
    const updated = await this.store.updateChat(project.id, chat.id, {
      lastStatus: "Codex is working.",
    });
    this.emitEvent("app", "turnStarted", `Sent request to "${chat.displayName}".`, { turnId, chatId: chat.id, text: trimmed });
    this.emitState();
    return {
      kind: "turn",
      message: `Codex started with ${this.describeModelEffort(
        turnSettings.model,
        turnSettings.reasoningEffort,
        turnSettings.serviceTier,
      )}.`,
      turnId,
      project: updated,
      chat: updated.chats.find((candidate) => candidate.id === chat.id) ?? null,
    };
  }

  async steerCodex(text: string, chatId?: string): Promise<{ turnId: string }> {
    const { project, chat } = await this.requireChatContext(chatId);
    const threadId = chat.codexThreadId;
    const turnId = threadId ? this.activeTurnByThread.get(threadId) ?? null : null;
    if (!threadId || !turnId) {
      throw new Error("There is no active Codex turn to steer.");
    }
    await this.codex.request("turn/steer", {
      threadId,
      expectedTurnId: turnId,
      input: [
        {
          type: "text",
          text: text.trim(),
          text_elements: [],
        },
      ],
    });
    await this.store.updateChat(project.id, chat.id, { lastStatus: "Steered active turn." });
    this.status = `Steered "${chat.displayName}".`;
    this.emitEvent("app", "turnSteered", `Steered "${chat.displayName}".`, { text, chatId: chat.id });
    this.emitState();
    return { turnId };
  }

  async interruptCodex(chatId?: string): Promise<void> {
    const { project, chat } = await this.requireChatContext(chatId);
    const threadId = chat.codexThreadId;
    const turnId = threadId ? this.activeTurnByThread.get(threadId) ?? null : null;
    if (!threadId || !turnId) {
      throw new Error("There is no active Codex turn to interrupt.");
    }
    await this.codex.request("turn/interrupt", {
      threadId,
      turnId,
    });
    await this.store.updateChat(project.id, chat.id, { lastStatus: "Requested Codex interruption." });
    this.status = `Requested interruption for "${chat.displayName}".`;
    this.emitEvent("app", "turnInterrupted", this.status, { chatId: chat.id, turnId });
    this.emitState();
  }

  async summarizeProject(projectId?: string, chatId?: string): Promise<string> {
    const target =
      (projectId ? await this.store.getProject(projectId) : null) ??
      (this.activeProjectId ? await this.store.getProject(this.activeProjectId) : null) ??
      (await this.store.getMostRecentProject());
    if (!target) throw new Error("No recent projects are available to summarize.");

    const chat = chatId
      ? target.chats.find((candidate) => candidate.id === chatId && !candidate.archivedAt) ?? null
      : activeChatForProject(target) ?? target.chats.find((candidate) => !candidate.archivedAt) ?? null;
    if (chatId && !chat) throw new Error(`Unknown chat for project "${target.displayName}": ${chatId}`);
    if (!chat?.codexThreadId) throw new Error("Project is missing a Codex chat thread id.");
    const resumed = await this.resumeChatThread(target, chat);
    const resumedThreadId = resumed.chat.codexThreadId;
    if (!resumedThreadId) throw new Error("Project is missing a Codex chat thread id.");

    const turnSettings = this.resolveTurnSettings(resumed.project, resumed.chat);
    const result = (await this.codex.request("turn/start", {
      threadId: resumedThreadId,
      cwd: resumed.project.folderPath,
      ...permissionParams(turnSettings.permissionMode),
      personality: "friendly",
      ...(turnSettings.model ? { model: turnSettings.model } : {}),
      ...(turnSettings.serviceTier ? { serviceTier: turnSettings.serviceTier } : {}),
      ...(turnSettings.reasoningEffort ? { effort: turnSettings.reasoningEffort } : {}),
      input: [
        {
          type: "text",
          text:
            "Please summarize this Codex workspace thread for the user in 4-6 concise bullets. Focus on what the user was trying to do, what Codex changed or found, current status, and useful next steps. Do not invent context.",
          text_elements: [],
        },
      ],
    })) as { turn?: { id?: string } };

    const turnId = result.turn?.id;
    if (!turnId) throw new Error("Codex did not return a summary turn id.");
    this.activeTurnByThread.set(resumedThreadId, turnId);
    this.threadByTurn.set(turnId, resumedThreadId);
    this.activeTurnModelByThread.set(resumedThreadId, turnSettings.model);
    this.activeTurnReasoningEffortByThread.set(resumedThreadId, turnSettings.reasoningEffort);
    this.activeTurnServiceTierByThread.set(resumedThreadId, turnSettings.serviceTier);
    this.activeTurnPermissionModeByThread.set(resumedThreadId, turnSettings.permissionMode);
    this.nextTurnModel = null;
    this.nextTurnReasoningEffort = null;
    this.nextTurnServiceTier = null;
    this.nextTurnPermissionMode = null;
    this.status = `Codex is summarizing "${resumed.chat.displayName}".`;
    this.emitEvent("app", "summaryStarted", `Summarizing "${resumed.chat.displayName}".`, {
      turnId,
      chatId: resumed.chat.id,
    });
    this.emitState();

    const summary = await this.waitForTurnText(turnId);
    await this.store.updateChat(resumed.project.id, resumed.chat.id, {
      lastSummary: summary,
      lastStatus: "Chat summarized.",
    });
    this.emitEvent("app", "summaryCompleted", "Codex summarized the project.", { summary });
    this.emitState();
    return summary;
  }

  async answerApproval(requestId: string | number, decision: ApprovalDecision): Promise<void> {
    const request = this.pendingRequests.get(String(requestId));
    if (!request) throw new Error(`Unknown pending request: ${requestId}`);

    const response = await this.responseForDecision(request, decision);
    if (response.kind === "error") {
      this.codex.rejectRequest(requestId, response.message);
    } else {
      this.codex.respond(requestId, response.result);
    }
    this.pendingRequests.delete(String(requestId));
    this.status = `Answered ${request.title}: ${decision}`;
    if (request.threadId) {
      this.updateChatForThread(request.threadId, { lastStatus: `Answered ${request.title}: ${decision}` });
    }
    this.emitEvent("app", "approvalAnswered", `Answered ${request.title}: ${decision}`, {
      requestId,
      decision,
    });
    this.emitState();
  }

  private async responseForDecision(
    request: PendingCodexRequest,
    decision: ApprovalDecision,
  ): Promise<ServerRequestResponse> {
    if (request.method === "item/tool/call") {
      return this.responseForDynamicToolCall(request, decision);
    }
    if (request.method === "account/chatgptAuthTokens/refresh" && isAcceptDecision(decision)) {
      return this.responseForChatgptAuthRefresh(request);
    }
    return responseForDecision(request, decision);
  }

  private async responseForDynamicToolCall(
    request: PendingCodexRequest,
    decision: ApprovalDecision,
  ): Promise<ServerRequestResponse> {
    if (!isAcceptDecision(decision)) {
      return {
        kind: "result",
        result: {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: `User ${decision === "cancel" ? "cancelled" : "declined"} the requested tool call.`,
            },
          ],
        },
      };
    }

    const params = request.raw as {
      params?: {
        threadId?: unknown;
        namespace?: unknown;
        tool?: unknown;
        arguments?: unknown;
      };
    };
    const threadId = stringField(params.params?.threadId);
    const server = stringField(params.params?.namespace);
    const tool = stringField(params.params?.tool);

    if (!threadId || !server || !tool) {
      return {
        kind: "result",
        result: {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: "The app-server tool call did not include enough MCP routing information to run it.",
            },
          ],
        },
      };
    }

    try {
      const result = await this.codex.request("mcpServer/tool/call", {
        threadId,
        server,
        tool,
        ...(params.params?.arguments !== undefined ? { arguments: params.params.arguments } : {}),
      });
      return dynamicToolResponseFromMcpResult(result);
    } catch (error) {
      return {
        kind: "result",
        result: {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: `MCP tool call failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        },
      };
    }
  }

  private async responseForChatgptAuthRefresh(request: PendingCodexRequest): Promise<ServerRequestResponse> {
    const params = request.raw as { params?: { previousAccountId?: unknown } };
    const previousAccountId = stringField(params.params?.previousAccountId);

    try {
      const authStatus = (await this.codex.request("getAuthStatus", {
        includeToken: true,
        refreshToken: true,
      })) as { authToken?: string | null };
      const accountResponse = (await this.codex.request("account/read", {
        refreshToken: true,
      })) as { account?: { type?: string; planType?: string | null } | null };
      const token = stringField(authStatus.authToken);
      if (!token || !previousAccountId) {
        return responseForDecision(request, "decline");
      }
      return {
        kind: "result",
        result: {
          accessToken: token,
          chatgptAccountId: previousAccountId,
          chatgptPlanType:
            accountResponse.account?.type === "chatgpt" ? accountResponse.account.planType ?? null : null,
        },
      };
    } catch {
      return responseForDecision(request, "decline");
    }
  }

  async answerToolQuestion(requestId: string | number, answers: ToolQuestionAnswer[]): Promise<void> {
    const request = this.pendingRequests.get(String(requestId));
    if (!request) throw new Error(`Unknown pending request: ${requestId}`);
    if (request.method !== "item/tool/requestUserInput") {
      throw new Error(`Pending request ${requestId} is not a Codex question.`);
    }
    const normalizedAnswers = normalizeToolQuestionAnswers(request, answers);
    const result = {
      answers: Object.fromEntries(
        normalizedAnswers.map((answer) => [answer.questionId, { answers: answer.answers }]),
      ),
    };
    this.codex.respond(requestId, result);
    this.pendingRequests.delete(String(requestId));
    this.status = "Answered Codex question.";
    if (request.threadId) {
      this.updateChatForThread(request.threadId, { lastStatus: "Answered Codex question." });
    }
    this.emitEvent("app", "questionAnswered", "Answered a Codex question.", {
      requestId,
      answers: normalizedAnswers,
    });
    this.emitState();
  }

  async getChatStatus(chatId?: string): Promise<CodexChatRuntime[]> {
    const project = chatId ? await this.requireProjectForChat(chatId) : await this.requireProject();
    const runtimes = this.chatRuntimeStates(project);
    return chatId ? runtimes.filter((runtime) => runtime.chatId === chatId) : runtimes;
  }

  async setCodexSettings(
    settings: {
      model?: string | null;
      reasoningEffort?: ReasoningEffort | null;
      serviceTier?: CodexServiceTier | null;
      permissionMode?: CodexPermissionMode | null;
    },
    scope: CodexSettingsScope,
  ): Promise<CodexSettings> {
    if (settings.model !== undefined && settings.model !== null) {
      this.assertKnownModel(settings.model);
    }
    if (settings.reasoningEffort !== undefined && settings.reasoningEffort !== null) {
      this.assertReasoningEffort(settings.reasoningEffort);
    }
    if (settings.serviceTier !== undefined && settings.serviceTier !== null) {
      this.assertServiceTier(settings.serviceTier, settings.model);
    }
    if (settings.permissionMode !== undefined && settings.permissionMode !== null) {
      this.assertPermissionMode(settings.permissionMode);
    }

    if (scope === "nextTurn") {
      if (settings.model !== undefined) this.nextTurnModel = settings.model;
      if (settings.reasoningEffort !== undefined) {
        this.nextTurnReasoningEffort = settings.reasoningEffort;
      }
      if (settings.serviceTier !== undefined) this.nextTurnServiceTier = settings.serviceTier;
      if (settings.permissionMode !== undefined) this.nextTurnPermissionMode = settings.permissionMode;
      this.status = `Updated next-turn Codex settings: ${this.describeModelEffort(
        this.nextTurnModel,
        this.nextTurnReasoningEffort,
        this.nextTurnServiceTier,
      )}, ${this.describePermissions(this.nextTurnPermissionMode ?? DEFAULT_CODEX_PERMISSION_MODE)}.`;
      this.emitEvent("app", "settingsChanged", this.status);
      this.emitState();
      return this.codexSettings(await this.getActiveProject());
    }

    const project = await this.requireProject();
    const chat = activeChatForProject(project);
    if (!chat) {
      const updated = await this.store.updateProject(project.id, {
        ...(settings.model !== undefined ? { model: settings.model } : {}),
        ...(settings.reasoningEffort !== undefined
          ? { reasoningEffort: settings.reasoningEffort }
          : {}),
        ...(settings.serviceTier !== undefined ? { serviceTier: settings.serviceTier } : {}),
        ...(settings.permissionMode !== undefined
          ? { permissionMode: settings.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE }
          : {}),
        lastStatus: "Updated Codex settings.",
      });
      this.status = `Updated project Codex settings: ${this.describeModelEffort(
        updated.model,
        updated.reasoningEffort,
        updated.serviceTier,
      )}, ${this.describePermissions(updated.permissionMode)}.`;
      this.emitEvent("app", "settingsChanged", this.status, updated);
      this.emitState();
      return this.codexSettings(updated);
    }

    const updated = await this.store.updateChat(project.id, chat.id, {
      ...(settings.model !== undefined ? { model: settings.model } : {}),
      ...(settings.reasoningEffort !== undefined
        ? { reasoningEffort: settings.reasoningEffort }
        : {}),
      ...(settings.serviceTier !== undefined ? { serviceTier: settings.serviceTier } : {}),
      ...(settings.permissionMode !== undefined
        ? { permissionMode: settings.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE }
        : {}),
      lastStatus: "Updated Codex settings.",
    });
    const updatedChat = updated.chats.find((candidate) => candidate.id === chat.id) ?? chat;
    this.status = `Updated chat Codex settings: ${this.describeModelEffort(
      updatedChat.model,
      updatedChat.reasoningEffort,
      updatedChat.serviceTier,
    )}, ${this.describePermissions(updatedChat.permissionMode)}.`;
    this.emitEvent("app", "settingsChanged", this.status, updated);
    this.emitState();
    return this.codexSettings(updated);
  }

  createRealtimeClientSecret = createRealtimeClientSecret;

  private async getActiveProject(): Promise<VoiceProject | null> {
    return this.activeProjectId ? this.store.getProject(this.activeProjectId) : null;
  }

  private async requireProject(projectId?: string): Promise<VoiceProject> {
    const id = projectId ?? this.activeProjectId;
    if (!id) throw new Error("No active Codex project.");
    const project = await this.store.getProject(id);
    if (!project) throw new Error(`Unknown Codex workspace: ${id}`);
    return project;
  }

  private async requireProjectForChat(chatId: string): Promise<VoiceProject> {
    const project = await this.findProjectForChat(chatId, false);
    if (!project) throw new Error(`Unknown chat: ${chatId}`);
    return project;
  }

  private async findProjectForChat(chatId: string, includeArchived: boolean): Promise<VoiceProject | null> {
    const projects = await this.store.listProjects({ includeArchived });
    return (
      projects.find((candidate) =>
        candidate.chats.some((chat) => chat.id === chatId && (includeArchived || !chat.archivedAt)),
      ) ?? null
    );
  }

  private async requireActiveProject(): Promise<VoiceProject> {
    return this.requireProject();
  }

  private async requireChatContext(chatId?: string): Promise<ChatContext> {
    if (chatId) {
      const project = await this.requireProjectForChat(chatId);
      const chat = project.chats.find((candidate) => candidate.id === chatId && !candidate.archivedAt);
      if (!chat) throw new Error(`Unknown chat: ${chatId}`);
      return { project, chat };
    }

    const project = await this.requireProject();
    const chat = activeChatForProject(project);
    if (!chat) throw new Error("Active project does not have an active chat.");
    return { project, chat };
  }

  private async requireChatContextForPrompt(text: string, chatId?: string): Promise<ChatContext> {
    if (chatId) return this.requireChatContext(chatId);

    let project = await this.requireProject();
    let chat = activeChatForProject(project);
    if (!chat) {
      project = await this.startChatThread(project, titleFromText(text));
      chat = activeChatForProject(project);
    }
    if (!chat) throw new Error("Active project does not have an active chat.");
    return { project, chat };
  }

  private requireActiveChatContextFromProject(project: VoiceProject): ChatContext {
    const chat = activeChatForProject(project);
    if (!chat) throw new Error("Project does not have an active chat.");
    return { project, chat };
  }

  private async resumeChatThread(project: VoiceProject, chat: VoiceChat): Promise<ChatContext> {
    if (!chat.codexThreadId) {
      throw new Error(`Chat "${chat.displayName}" does not have a Codex thread id.`);
    }
    const chatSettings = this.threadSettingsForChat(project, chat);

    try {
      await this.codex.request("thread/resume", {
        threadId: chat.codexThreadId,
        cwd: project.folderPath,
        ...permissionParams(chatSettings.permissionMode),
        personality: "friendly",
        excludeTurns: true,
        ...(chatSettings.model ? { model: chatSettings.model } : {}),
        ...(chatSettings.serviceTier ? { serviceTier: chatSettings.serviceTier } : {}),
      });
      return { project, chat };
    } catch (error) {
      if (!isMissingCodexThreadError(error)) throw error;
    }

    const result = (await this.codex.request("thread/start", {
      cwd: project.folderPath,
      ...(chatSettings.model ? { model: chatSettings.model } : {}),
      ...(chatSettings.serviceTier ? { serviceTier: chatSettings.serviceTier } : {}),
      ...permissionParams(chatSettings.permissionMode),
      developerInstructions: codexThreadDeveloperInstructions(),
      personality: "friendly",
      serviceName: "codex_voice",
    })) as { thread?: { id?: string } };

    const codexThreadId = result.thread?.id;
    if (!codexThreadId) throw new Error("Codex did not return a replacement thread id.");
    await this.setThreadName(codexThreadId, updatedChatTitle(chat.displayName));

    const updatedProject = await this.store.updateChat(project.id, chat.id, {
      codexThreadId,
      lastStatus: "Started a fresh Codex thread.",
    });
    const updatedChat = updatedProject.chats.find((candidate) => candidate.id === chat.id);
    if (!updatedChat) throw new Error(`Unknown chat after recovery: ${chat.id}`);

    this.emitEvent(
      "app",
      "chatThreadRecovered",
      `Started a fresh Codex thread for "${updatedChat.displayName}" because the previous rollout was unavailable.`,
      { chatId: updatedChat.id, oldThreadId: chat.codexThreadId, newThreadId: codexThreadId },
    );
    return { project: updatedProject, chat: updatedChat, recovered: true };
  }

  private async startChatThread(project: VoiceProject, displayName: string): Promise<VoiceProject> {
    const chatSettings = this.initialChatSettings(project);
    const result = (await this.codex.request("thread/start", {
      cwd: project.folderPath,
      ...(chatSettings.model ? { model: chatSettings.model } : {}),
      ...(chatSettings.serviceTier ? { serviceTier: chatSettings.serviceTier } : {}),
      ...permissionParams(chatSettings.permissionMode),
      developerInstructions: codexThreadDeveloperInstructions(),
      personality: "friendly",
      serviceName: "codex_voice",
    })) as { thread?: { id?: string } };

    const codexThreadId = result.thread?.id;
    if (!codexThreadId) throw new Error("Codex did not return a thread id.");
    await this.setThreadName(codexThreadId, updatedChatTitle(displayName));

    return this.store.addChat(project.id, displayName, codexThreadId, chatSettings);
  }

  private async setThreadName(threadId: string, name: string): Promise<void> {
    try {
      await this.codex.request("thread/name/set", { threadId, name });
    } catch (error) {
      this.emitEvent("app", "threadNameUnavailable", "Codex thread was created, but its display name could not be saved.", {
        threadId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async syncWorkspaceThreads(projectId: string, shouldApply?: () => boolean): Promise<VoiceProject> {
    const project = await this.requireProject(projectId);
    const response = (await this.codex.request("thread/list", {
      cwd: project.folderPath,
      archived: false,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
    })) as ThreadListResponse;

    const existingByThread = new Map(
      project.chats
        .filter((chat): chat is VoiceChat & { codexThreadId: string } => Boolean(chat.codexThreadId))
        .map((chat) => [chat.codexThreadId, chat]),
    );
    const threads = Array.isArray(response.data) ? response.data : [];
    const chats = threads
      .filter((thread): thread is CodexThreadSummary & { id: string } => typeof thread.id === "string" && Boolean(thread.id))
      .map((thread) => {
        const existing = existingByThread.get(thread.id);
        const createdAt = unixSecondsToIso(thread.createdAt, existing?.createdAt ?? project.createdAt);
        const updatedAt = unixSecondsToIso(thread.updatedAt, existing?.updatedAt ?? createdAt);
        return {
          id: existing?.id ?? thread.id,
          displayName: titleFromThread(thread),
          codexThreadId: thread.id,
          model: existing?.model ?? project.model ?? DEFAULT_CODEX_MODEL,
          reasoningEffort: existing?.reasoningEffort ?? project.reasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
          serviceTier: existing?.serviceTier ?? project.serviceTier ?? DEFAULT_CODEX_SERVICE_TIER,
          permissionMode: existing?.permissionMode ?? project.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
          createdAt,
          updatedAt,
          archivedAt: existing?.archivedAt ?? null,
          lastSummary: existing?.lastSummary ?? null,
          lastStatus: describeThreadSummaryStatus(thread.status) ?? existing?.lastStatus ?? "Codex thread",
          lastTurnOutput: existing?.lastTurnOutput ?? null,
        } satisfies VoiceChat;
      });

    if (shouldApply && !shouldApply()) {
      return project;
    }
    return this.store.replaceChats(project.id, chats);
  }

  private handleServerRequest(message: CodexJsonMessage): void {
    if (message.id === undefined || !message.method) return;
    const pending = describeServerRequest(message);
    this.pendingRequests.set(String(message.id), pending);
    this.status = pending.title;
    this.emitEvent("codex", "serverRequest", pending.title, pending);
    if (pending.threadId) {
      this.updateChatForThread(pending.threadId, { lastStatus: pending.title });
    }
    this.emitState();
  }

  private handleNotification(message: CodexJsonMessage): void {
    const method = message.method ?? "notification";
    const params = message.params as Record<string, unknown> | undefined;
    const threadId = stringField(params?.threadId);
    const status = statusFromNotification(method, params);
    if (status) {
      this.status = status;
      this.emitEvent("codex", method, status, message.params);
      if (threadId) this.updateChatForThread(threadId, { lastStatus: status });
    } else if (method !== "item/agentMessage/delta") {
      this.emitEvent("codex", method, method, message.params);
    }

    if (method === "turn/started") {
      const turn = (params?.turn ?? {}) as { id?: string };
      if (threadId && turn.id) {
        this.activeTurnByThread.set(threadId, turn.id);
        this.threadByTurn.set(turn.id, threadId);
      }
    }

    if (method === "thread/status/changed") {
      const statusParams = params as { threadId?: string; status?: unknown };
      if (statusParams.threadId) {
        this.threadStatusByThread.set(statusParams.threadId, describeThreadStatus(statusParams.status));
      }
    }

    if (method === "serverRequest/resolved") {
      const resolvedParams = params as { requestId?: string | number; threadId?: string };
      if (resolvedParams.requestId !== undefined) {
        const resolved = this.pendingRequests.get(String(resolvedParams.requestId));
        this.pendingRequests.delete(String(resolvedParams.requestId));
        if (resolved?.threadId) {
          this.updateChatForThread(resolved.threadId, { lastStatus: "Codex request resolved." });
        }
      }
    }

    if (method === "thread/tokenUsage/updated") {
      const usageParams = params as { threadId?: string; tokenUsage?: CodexThreadTokenUsage };
      if (usageParams.threadId && usageParams.tokenUsage) {
        this.tokenUsageByThread.set(usageParams.threadId, usageParams.tokenUsage);
      }
    }

    if (method === "item/agentMessage/delta") {
      const deltaParams = params as { turnId?: string; delta?: string };
      if (deltaParams.turnId && deltaParams.delta) {
        const waiter = this.turnWaiters.get(deltaParams.turnId);
        if (waiter) waiter.text += deltaParams.delta;
      }
    }

    if (method === "turn/completed") {
      const turn = (params?.turn ?? {}) as { id?: string; status?: string; error?: { message?: string } };
      const completedThreadId = threadId ?? (turn.id ? this.threadByTurn.get(turn.id) : undefined);
      if (completedThreadId) {
        const activeTurnId = this.activeTurnByThread.get(completedThreadId);
        const completedCurrentTurn = !turn.id || activeTurnId === turn.id;
        if (completedCurrentTurn) {
          this.activeTurnByThread.delete(completedThreadId);
          this.activeTurnModelByThread.delete(completedThreadId);
          this.activeTurnReasoningEffortByThread.delete(completedThreadId);
          this.activeTurnServiceTierByThread.delete(completedThreadId);
          this.activeTurnPermissionModeByThread.delete(completedThreadId);
          const lastStatus = turn.status === "failed" ? "Codex turn failed." : "Codex finished.";
          if (turn.id) {
            void this.captureCompletedTurnOutput(completedThreadId, turn.id, lastStatus);
          } else {
            this.updateChatForThread(completedThreadId, { lastStatus });
          }
        }
      }
      if (turn.id) {
        this.threadByTurn.delete(turn.id);
        const waiter = this.turnWaiters.get(turn.id);
        if (waiter) {
          clearTimeout(waiter.timeout);
          this.turnWaiters.delete(turn.id);
          if (turn.status === "failed") {
            waiter.reject(new Error(turn.error?.message ?? "Codex summary turn failed."));
          } else {
            waiter.resolve(waiter.text.trim() || "Codex finished, but no summary text was returned.");
          }
        }
      }
    }

    this.emitState();
  }

  private waitForTurnText(turnId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turnWaiters.delete(turnId);
        reject(new Error("Timed out waiting for Codex summary text."));
      }, 180_000);
      this.turnWaiters.set(turnId, { text: "", resolve, reject, timeout });
    });
  }

  private async captureCompletedTurnOutput(threadId: string, turnId: string, lastStatus: string): Promise<void> {
    try {
      const response = (await this.codex.request("thread/read", {
        threadId,
        includeTurns: true,
      })) as ThreadReadResponse;
      const turn = response.thread?.turns?.find((candidate) => candidate.id === turnId);
      if (!turn) {
        await this.updateCompletedTurnStatus(threadId, lastStatus);
        this.emitEvent("app", "turnOutputUnavailable", "Codex completed, but thread/read did not include the completed turn.", {
          threadId,
          turnId,
        });
        return;
      }

      const finalAssistantText = finalAssistantTextFromTurn(turn);
      if (!finalAssistantText) {
        await this.updateCompletedTurnStatus(threadId, lastStatus);
        this.emitEvent("app", "turnOutputUnavailable", "Codex completed, but no final assistant output was available.", {
          threadId,
          turnId,
          status: turn.status,
        });
        return;
      }

      const output: CodexTurnOutput = {
        threadId,
        turnId,
        status: turn.status ?? "completed",
        finalAssistantText,
        startedAt: numberOrNull(turn.startedAt),
        completedAt: numberOrNull(turn.completedAt),
        durationMs: numberOrNull(turn.durationMs),
        ...(turn.error?.message ? { errorMessage: turn.error.message } : {}),
      };
      const context = await this.findChatByThread(threadId);
      if (context) {
        await this.store.updateChat(context.project.id, context.chat.id, {
          lastStatus,
          lastTurnOutput: output,
        });
      }
      this.emitEvent("codex", "turn/finalOutput", "Codex final output is available for voice context.", output);
      this.emitState();
    } catch (error) {
      await this.updateCompletedTurnStatus(threadId, lastStatus);
      this.emitEvent(
        "app",
        "turnOutputUnavailable",
        error instanceof Error ? error.message : "Unable to read Codex final turn output.",
        { threadId, turnId },
      );
    }
  }

  private async updateCompletedTurnStatus(threadId: string, lastStatus: string): Promise<void> {
    try {
      const context = await this.findChatByThread(threadId);
      if (!context) return;
      await this.store.updateChat(context.project.id, context.chat.id, { lastStatus });
      this.emitState();
    } catch (error) {
      this.emitEvent(
        "app",
        "chatUpdateFailed",
        error instanceof Error ? error.message : "Unable to update chat status.",
        { threadId },
      );
    }
  }

  private runtimeState(activeProject: VoiceProject | null, projects: VoiceProject[]): CodexRuntimeState {
    const activeChat = activeProject ? activeChatForProject(activeProject) : null;
    const activeThreadId = activeChat?.codexThreadId ?? null;
    const chatRuntimes = activeProject ? this.chatRuntimeStates(activeProject) : [];
    const activeRuntime = activeChat
      ? chatRuntimes.find((runtime) => runtime.chatId === activeChat.id) ?? null
      : null;
    return {
      ready: this.codex.ready,
      activeProjectId: this.activeProjectId,
      activeChatId: activeChat?.id ?? null,
      activeTurnId: activeRuntime?.activeTurnId ?? null,
      status: activeRuntime?.status ?? this.status,
      threadStatus: activeThreadId ? this.threadStatusByThread.get(activeThreadId) ?? null : null,
      tokenUsage: activeThreadId ? this.tokenUsageByThread.get(activeThreadId) ?? null : null,
      pendingRequests: this.runtimePendingRequests(activeProject, chatRuntimes, projects),
      chats: chatRuntimes,
      showProjectChats: this.showProjectChatsFlag,
    };
  }

  private chatRuntimeStates(project: VoiceProject): CodexChatRuntime[] {
    return project.chats.filter((chat) => !chat.archivedAt).map((chat) => {
      const threadId = chat.codexThreadId;
      const pendingRequests = threadId
        ? [...this.pendingRequests.values()]
            .filter((request) => request.threadId === threadId)
            .map((request) => ({
              ...request,
              projectId: project.id,
              projectName: project.displayName,
              chatId: chat.id,
              chatName: chat.displayName,
            }))
        : [];
      const activeTurnId = threadId ? this.activeTurnByThread.get(threadId) ?? null : null;
      return {
        chatId: chat.id,
        threadId,
        displayName: chat.displayName,
        activeTurnId,
        status: pendingRequests[0]?.title ?? (activeTurnId ? "Codex is working." : chat.lastStatus ?? "Idle"),
        threadStatus: threadId ? this.threadStatusByThread.get(threadId) ?? null : null,
        tokenUsage: threadId ? this.tokenUsageByThread.get(threadId) ?? null : null,
        pendingRequests,
        activeTurnModel: threadId ? this.activeTurnModelByThread.get(threadId) ?? null : null,
        activeTurnReasoningEffort: threadId
          ? this.activeTurnReasoningEffortByThread.get(threadId) ?? null
          : null,
        activeTurnServiceTier: threadId ? this.activeTurnServiceTierByThread.get(threadId) ?? null : null,
      };
    });
  }

  private runtimePendingRequests(
    activeProject: VoiceProject | null,
    chatRuntimes: CodexChatRuntime[],
    projects: VoiceProject[],
  ): PendingCodexRequest[] {
    const chatByThread = new Map(
      chatRuntimes
        .filter((runtime): runtime is CodexChatRuntime & { threadId: string } => Boolean(runtime.threadId))
        .map((runtime) => [runtime.threadId, runtime]),
    );
    const storedChatByThread = new Map<string, { project: VoiceProject; chat: VoiceChat }>();
    for (const project of projects) {
      for (const chat of project.chats) {
        if (chat.codexThreadId && !chat.archivedAt) {
          storedChatByThread.set(chat.codexThreadId, { project, chat });
        }
      }
    }
    return [...this.pendingRequests.values()].map((request) => {
      if (!request.threadId) return request;
      const runtime = chatByThread.get(request.threadId);
      const stored = storedChatByThread.get(request.threadId);
      if (!runtime && !stored) return request;
      return {
        ...request,
        projectId: stored?.project.id ?? activeProject?.id,
        chatId: runtime?.chatId ?? stored?.chat.id,
        projectName: stored?.project.displayName,
        chatName: runtime?.displayName ?? stored?.chat.displayName,
      };
    });
  }

  private async refreshModels(): Promise<void> {
    try {
      const result = (await this.codex.request("model/list", {
        limit: 100,
        includeHidden: false,
      })) as { data?: CodexModelSummary[] };
      this.models = (result.data ?? []).map((model) => ({
        id: model.id,
        model: model.model,
        displayName: model.displayName,
        description: model.description,
        isDefault: model.isDefault,
        hidden: model.hidden,
        defaultReasoningEffort: model.defaultReasoningEffort,
        supportedReasoningEfforts: model.supportedReasoningEfforts ?? [],
        additionalSpeedTiers: model.additionalSpeedTiers ?? [],
        serviceTiers: model.serviceTiers ?? [],
      }));
      this.defaultModel = DEFAULT_CODEX_MODEL;
      this.defaultReasoningEffort = DEFAULT_CODEX_REASONING_EFFORT;
      this.defaultServiceTier = DEFAULT_CODEX_SERVICE_TIER;
    } catch (error) {
      this.emitEvent(
        "app",
        "modelListFailed",
        error instanceof Error ? error.message : "Unable to list Codex models.",
      );
    }
  }

  private codexSettings(activeProject: VoiceProject | null): CodexSettings {
    const activeChat = activeProject ? activeChatForProject(activeProject) : null;
    const activeThreadId = activeChat?.codexThreadId ?? null;
    const chatModel = activeChat?.model ?? activeProject?.model ?? null;
    const chatReasoningEffort = activeChat?.reasoningEffort ?? activeProject?.reasoningEffort ?? null;
    const chatServiceTier = activeChat ? activeChat.serviceTier : activeProject?.serviceTier ?? null;
    const chatPermissionMode = activeChat?.permissionMode ?? activeProject?.permissionMode ?? this.defaultPermissionMode;
    return {
      chatModel,
      chatReasoningEffort,
      chatServiceTier,
      chatPermissionMode,
      nextTurnModel: this.nextTurnModel,
      nextTurnReasoningEffort: this.nextTurnReasoningEffort,
      nextTurnServiceTier: this.nextTurnServiceTier,
      nextTurnPermissionMode: this.nextTurnPermissionMode,
      activeTurnModel: activeThreadId ? this.activeTurnModelByThread.get(activeThreadId) ?? null : null,
      activeTurnReasoningEffort: activeThreadId
        ? this.activeTurnReasoningEffortByThread.get(activeThreadId) ?? null
        : null,
      activeTurnServiceTier: activeThreadId ? this.activeTurnServiceTierByThread.get(activeThreadId) ?? null : null,
      activeTurnPermissionMode: activeThreadId
        ? this.activeTurnPermissionModeByThread.get(activeThreadId) ?? null
        : null,
      defaultModel: this.defaultModel,
      defaultReasoningEffort: this.defaultReasoningEffort,
      defaultServiceTier: this.defaultServiceTier,
      defaultPermissionMode: this.defaultPermissionMode,
      models: this.models,
    };
  }

  private resolveTurnSettings(project: VoiceProject, chat?: VoiceChat | null): {
    model: string | null;
    reasoningEffort: ReasoningEffort | null;
    serviceTier: CodexServiceTier | null;
    permissionMode: CodexPermissionMode;
  } {
    const settings = this.threadSettingsForChat(project, chat ?? activeChatForProject(project));
    return {
      model: this.nextTurnModel ?? settings.model,
      reasoningEffort:
        this.nextTurnReasoningEffort ??
        settings.reasoningEffort,
      serviceTier: this.nextTurnServiceTier ?? settings.serviceTier,
      permissionMode: this.nextTurnPermissionMode ?? settings.permissionMode,
    };
  }

  private initialChatSettings(project: VoiceProject): {
    model: string | null;
    reasoningEffort: ReasoningEffort | null;
    serviceTier: CodexServiceTier | null;
    permissionMode: CodexPermissionMode;
  } {
    return {
      model: project.model ?? this.defaultModel ?? DEFAULT_CODEX_MODEL,
      reasoningEffort:
        project.reasoningEffort ?? this.defaultReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
      serviceTier: project.serviceTier ?? this.defaultServiceTier ?? DEFAULT_CODEX_SERVICE_TIER,
      permissionMode: project.permissionMode ?? this.defaultPermissionMode,
    };
  }

  private threadSettingsForChat(
    project: VoiceProject,
    chat?: VoiceChat | null,
  ): {
    model: string | null;
    reasoningEffort: ReasoningEffort | null;
    serviceTier: CodexServiceTier | null;
    permissionMode: CodexPermissionMode;
  } {
    return {
      model: chat?.model ?? project.model ?? this.defaultModel ?? DEFAULT_CODEX_MODEL,
      reasoningEffort:
        chat?.reasoningEffort ??
        project.reasoningEffort ??
        this.defaultReasoningEffort ??
        DEFAULT_CODEX_REASONING_EFFORT,
      serviceTier: chat ? chat.serviceTier : project.serviceTier ?? this.defaultServiceTier ?? DEFAULT_CODEX_SERVICE_TIER,
      permissionMode: chat?.permissionMode ?? project.permissionMode ?? this.defaultPermissionMode,
    };
  }

  private async handleNativeSlashCommand(text: string): Promise<CodexActionResult> {
    const { command, args, rest } = parseSlashInput(text);
    const lowerCommand = command.toLowerCase();

    if (!lowerCommand || lowerCommand === "help") {
      return this.commandResult(nativeSlashHelpText());
    }

    if (lowerCommand === "status" || lowerCommand === "settings") {
      return this.commandResult(await this.nativeStatusText(), await this.getActiveProject());
    }

    if (lowerCommand === "model" || lowerCommand === "models") {
      return this.handleModelSlash(args);
    }

    if (lowerCommand === "fast") {
      return this.handleFastSlash(args);
    }

    if (lowerCommand === "permissions" || lowerCommand === "approvals") {
      return this.handlePermissionsSlash(args);
    }

    if (lowerCommand === "effort" || lowerCommand === "reasoning") {
      return this.commandResult(
        "Reasoning effort is part of Codex's native /model command. Use /model <effort> or /model <model> <effort>.",
      );
    }

    if (lowerCommand === "review") {
      return this.handleReviewSlash(args);
    }

    if (lowerCommand === "compact") {
      return this.handleCompactSlash();
    }

    if (lowerCommand === "mcp") {
      return this.handleMcpSlash(args);
    }

    if (lowerCommand === "apps") {
      return this.handleAppsSlash();
    }

    if (lowerCommand === "plugins") {
      return this.handlePluginsSlash();
    }

    if (lowerCommand === "new") {
      const project = await this.requireProject();
      const updated = await this.startChatThread(project, rest || "New Codex thread");
      const chat = activeChatForProject(updated);
      return this.commandResult(`Created new Codex thread: ${chat?.displayName ?? "New Codex thread"}`, updated);
    }

    if (lowerCommand === "resume") {
      const targetId = args[0] ?? (await this.store.getMostRecentProject())?.id;
      if (!targetId) throw new Error("No linked Codex workspaces exist yet.");
      const project = await this.resumeProject(targetId);
      return this.commandResult(`Resumed Codex workspace: ${project.displayName}`, project);
    }

    const unsupported = nativeUnsupportedSlashCommand(lowerCommand);
    if (unsupported) {
      return this.commandResult(unsupported);
    }

    return this.commandResult(`Unknown Codex slash command: /${command}. Try /help.`);
  }

  private async handleModelSlash(args: string[]): Promise<CodexActionResult> {
    await this.refreshModels();
    const activeProject = await this.getActiveProject();

    if (args.length === 0) {
      return this.commandResult(
        [this.currentSettingsText(activeProject), "", "Available models", formatModelList(this.models)].join("\n"),
        activeProject,
      );
    }

    const parsed = parseModelSlashArgs(args, activeProject ? "chat" : "nextTurn");
    if (parsed.model !== undefined && parsed.model !== null) this.assertKnownModel(parsed.model);
    if (parsed.reasoningEffort !== undefined && parsed.reasoningEffort !== null) {
      this.assertReasoningEffort(parsed.reasoningEffort);
    }

    const settings = await this.setCodexSettings(
      {
        ...(parsed.model !== undefined ? { model: parsed.model } : {}),
        ...(parsed.reasoningEffort !== undefined ? { reasoningEffort: parsed.reasoningEffort } : {}),
      },
      parsed.scope,
    );
    return this.commandResult(`Updated /model for ${parsed.scope}.\n${settingsText(settings)}`, await this.getActiveProject());
  }

  private async handleFastSlash(args: string[]): Promise<CodexActionResult> {
    await this.refreshModels();
    const activeProject = await this.getActiveProject();
    const settings = this.codexSettings(activeProject);
    const scope = activeProject ? "chat" : "nextTurn";
    const effectiveModel =
      settings.nextTurnModel ?? settings.chatModel ?? settings.defaultModel ?? DEFAULT_CODEX_MODEL;
    const currentTier =
      settings.nextTurnServiceTier ?? settings.chatServiceTier ?? settings.defaultServiceTier ?? DEFAULT_CODEX_SERVICE_TIER;
    const command = (args[0] ?? "status").toLowerCase();

    if (command === "status") {
      return this.commandResult(
        `Fast mode is ${isFastServiceTier(currentTier) ? "on" : "off"} for ${effectiveModel}.`,
        activeProject,
      );
    }

    if (command !== "on" && command !== "off" && command !== "standard") {
      throw new Error("Use /fast on, /fast off, or /fast status.");
    }

    if (command === "on" && !this.modelSupportsServiceTier(effectiveModel, FAST_CODEX_SERVICE_TIER)) {
      throw new Error(`${effectiveModel} does not report Fast mode support from app-server.`);
    }

    const updated = await this.setCodexSettings(
      { serviceTier: command === "on" ? FAST_CODEX_SERVICE_TIER : null },
      scope,
    );
    return this.commandResult(`Updated /fast for ${scope}.\n${settingsText(updated)}`, await this.getActiveProject());
  }

  private async handlePermissionsSlash(args: string[]): Promise<CodexActionResult> {
    const activeProject = await this.getActiveProject();
    if (args.length === 0) {
      return this.commandResult(
        [
          this.currentSettingsText(activeProject),
          "",
          "Permission modes",
          ...CODEX_PERMISSION_PROFILES.map(
            (profile) =>
              `${profile.mode} - ${profile.displayName}: approval ${profile.approvalPolicy}, sandbox ${profile.sandbox}`,
          ),
        ].join("\n"),
        activeProject,
      );
    }

    const mode = permissionModeFromText(args.join(" "));
    const settings = await this.setCodexSettings({ permissionMode: mode }, activeProject ? "chat" : "nextTurn");
    return this.commandResult(
      `Updated /permissions to ${permissionProfile(mode).displayName}.\n${settingsText(settings)}`,
      await this.getActiveProject(),
    );
  }

  private async handleReviewSlash(args: string[]): Promise<CodexActionResult> {
    const { project, chat } = await this.requireChatContext();
    if (!chat.codexThreadId) throw new Error("Active chat is missing a Codex thread id.");
    const { target, delivery } = parseReviewSlashArgs(args);
    const turnSettings = this.resolveTurnSettings(project, chat);
    const result = (await this.codex.request("review/start", {
      threadId: chat.codexThreadId,
      target,
      ...(delivery ? { delivery } : {}),
    })) as { turn?: { id?: string }; reviewThreadId?: string };

    const turnId = result.turn?.id ?? null;
    if (turnId) {
      this.activeTurnByThread.set(chat.codexThreadId, turnId);
      this.threadByTurn.set(turnId, chat.codexThreadId);
      this.activeTurnModelByThread.set(chat.codexThreadId, turnSettings.model);
      this.activeTurnReasoningEffortByThread.set(chat.codexThreadId, turnSettings.reasoningEffort);
      this.activeTurnServiceTierByThread.set(chat.codexThreadId, turnSettings.serviceTier);
      this.activeTurnPermissionModeByThread.set(chat.codexThreadId, turnSettings.permissionMode);
    }
    const updated = await this.store.updateChat(project.id, chat.id, {
      lastStatus: "Codex review started.",
    });
    this.status = "Codex review started.";
    return this.commandResult(
      `Started /review (${describeReviewTarget(target)}) in ${chat.displayName}. Review thread: ${result.reviewThreadId ?? chat.codexThreadId}.`,
      updated,
    );
  }

  private async handleCompactSlash(): Promise<CodexActionResult> {
    const { project, chat } = await this.requireChatContext();
    if (!chat.codexThreadId) throw new Error("Active chat is missing a Codex thread id.");
    await this.codex.request("thread/compact/start", { threadId: chat.codexThreadId });
    const updated = await this.store.updateChat(project.id, chat.id, {
      lastStatus: "Context compaction requested.",
    });
    return this.commandResult(`Requested native /compact for "${chat.displayName}".`, updated);
  }

  private async handleMcpSlash(args: string[]): Promise<CodexActionResult> {
    const verbose = args.some((arg) => arg.toLowerCase() === "verbose" || arg.toLowerCase() === "full");
    const result = (await this.codex.request("mcpServerStatus/list", {
      limit: 100,
      detail: verbose ? "full" : "toolsAndAuthOnly",
    })) as { data?: Array<{ name: string; tools?: Record<string, unknown>; authStatus?: string }> };
    return this.commandResult(formatMcpServers(result.data ?? [], verbose), await this.getActiveProject());
  }

  private async handleAppsSlash(): Promise<CodexActionResult> {
    const project = await this.getActiveProject();
    const chat = project ? activeChatForProject(project) : null;
    const result = (await this.codex.request("app/list", {
      limit: 100,
      threadId: chat?.codexThreadId ?? null,
      forceRefetch: false,
    })) as { data?: Array<{ id: string; name: string; isEnabled: boolean; isAccessible: boolean; pluginDisplayNames?: string[] }> };
    return this.commandResult(formatApps(result.data ?? []), project);
  }

  private async handlePluginsSlash(): Promise<CodexActionResult> {
    const project = await this.getActiveProject();
    const result = (await this.codex.request("plugin/list", {
      cwds: project?.folderPath ? [project.folderPath] : null,
    })) as {
      marketplaces?: Array<{
        name: string;
        plugins?: Array<{ id: string; name: string; installed: boolean; enabled: boolean }>;
      }>;
      marketplaceLoadErrors?: unknown[];
    };
    return this.commandResult(formatPlugins(result.marketplaces ?? [], result.marketplaceLoadErrors ?? []), project);
  }

  private async nativeStatusText(): Promise<string> {
    const project = await this.getActiveProject();
    const chat = project ? activeChatForProject(project) : null;
    const threadId = chat?.codexThreadId ?? null;
    const settings = this.codexSettings(project);
    const resolved = project
      ? this.resolveTurnSettings(project, chat)
        : {
            model: settings.nextTurnModel ?? settings.defaultModel,
            reasoningEffort: settings.nextTurnReasoningEffort ?? settings.defaultReasoningEffort,
            serviceTier: settings.nextTurnServiceTier ?? settings.defaultServiceTier,
            permissionMode: settings.nextTurnPermissionMode ?? settings.defaultPermissionMode,
          };
    const tokenUsage = threadId ? this.tokenUsageByThread.get(threadId) ?? null : null;
    const [configSummary, rateLimitSummary] = await Promise.all([
      this.readConfigSummary(project),
      this.readRateLimitSummary(),
    ]);

    return [
      "Codex /status",
      `Chat: ${chat?.displayName ?? "none"}`,
      `Thread: ${threadId ?? "none"}`,
      `Folder: ${project?.folderPath ?? "none"}`,
      `Runtime: ${this.threadStatusByThread.get(threadId ?? "") ?? this.status}`,
      `Active turn: ${threadId ? this.activeTurnByThread.get(threadId) ?? "none" : "none"}`,
      `Effective next turn: model ${resolved.model ?? "default"}, reasoning ${
        resolved.reasoningEffort ?? "default"
      }, speed ${formatServiceTier(resolved.serviceTier)}, permissions ${permissionProfile(resolved.permissionMode).displayName}`,
      `Chat override: model ${settings.chatModel ?? "default"}, reasoning ${
        settings.chatReasoningEffort ?? "default"
      }, speed ${formatServiceTier(settings.chatServiceTier)}, permissions ${permissionProfile(settings.chatPermissionMode).displayName}`,
      `Active turn model: ${settings.activeTurnModel ?? "none"}, reasoning ${
        settings.activeTurnReasoningEffort ?? "none"
      }, speed ${formatServiceTier(settings.activeTurnServiceTier)}, permissions ${
        settings.activeTurnPermissionMode ? permissionProfile(settings.activeTurnPermissionMode).displayName : "none"
      }`,
      `Voice app defaults: ${permissionProfile(settings.defaultPermissionMode).displayName}.`,
      `Context: ${formatTokenUsage(tokenUsage)}`,
      `Rate limits: ${rateLimitSummary}`,
      configSummary,
    ].join("\n");
  }

  private async readConfigSummary(project: VoiceProject | null): Promise<string> {
    try {
      const result = (await this.codex.request("config/read", {
        includeLayers: false,
        cwd: project?.folderPath ?? null,
      })) as { config?: Record<string, unknown> };
      const config = result.config ?? {};
      return `Config defaults: model ${formatConfigValue(config.model)}, reasoning ${formatConfigValue(
        config.model_reasoning_effort,
      )}, speed ${formatServiceTier(
        typeof config.service_tier === "string" ? config.service_tier : null,
      )}, approval ${formatConfigValue(config.approval_policy)}, sandbox ${formatConfigValue(config.sandbox_mode)}.`;
    } catch (error) {
      return `Config defaults: unavailable (${error instanceof Error ? error.message : String(error)}).`;
    }
  }

  private async readRateLimitSummary(): Promise<string> {
    try {
      const result = (await this.codex.request("account/rateLimits/read", undefined)) as {
        rateLimits?: unknown;
        rateLimitsByLimitId?: Record<string, unknown> | null;
      };
      const bucket = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
      return formatRateLimit(bucket);
    } catch (error) {
      return `unavailable (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  private commandResult(message: string, project: VoiceProject | null = null): CodexActionResult {
    this.status = message.split("\n")[0] || "Native slash command handled.";
    this.emitEvent("app", "slashCommand", message);
    this.emitState();
    return { kind: "command", message, turnId: null, project: project, chat: project ? activeChatForProject(project) : null };
  }

  private currentSettingsText(activeProject: VoiceProject | null): string {
    return settingsText(this.codexSettings(activeProject));
  }

  private assertKnownModel(model: string): void {
    if (model === DEFAULT_CODEX_MODEL) return;
    if (this.models.length === 0) return;
    const found = this.models.some((candidate) => candidate.model === model || candidate.id === model);
    if (!found) {
      throw new Error(`Unknown model "${model}". Use /model to list available models.`);
    }
  }

  private assertReasoningEffort(effort: string): asserts effort is ReasoningEffort {
    const allowed: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
    if (!allowed.includes(effort as ReasoningEffort)) {
      throw new Error(`Unknown reasoning effort "${effort}". Use one of: ${allowed.join(", ")}.`);
    }
  }

  private assertServiceTier(serviceTier: string, model: string | null | undefined): asserts serviceTier is CodexServiceTier {
    if (serviceTier === FAST_CODEX_SERVICE_TIER || serviceTier === "fast") {
      const targetModel = model ?? this.nextTurnModel ?? this.defaultModel ?? DEFAULT_CODEX_MODEL;
      if (!this.modelSupportsServiceTier(targetModel, FAST_CODEX_SERVICE_TIER)) {
        throw new Error(`${targetModel} does not report Fast mode support from app-server.`);
      }
      return;
    }
    const allowed = Array.from(new Set(this.models.flatMap((modelSummary) => modelSummary.serviceTiers.map((tier) => tier.id))));
    if (allowed.length > 0 && !allowed.includes(serviceTier)) {
      throw new Error(`Unknown service tier "${serviceTier}". Use one of: ${allowed.join(", ")}.`);
    }
  }

  private assertPermissionMode(mode: string): asserts mode is CodexPermissionMode {
    const allowed = CODEX_PERMISSION_PROFILES.map((profile) => profile.mode);
    if (!allowed.includes(mode as CodexPermissionMode)) {
      throw new Error(`Unknown permission mode "${mode}". Use one of: ${allowed.join(", ")}.`);
    }
  }

  private modelSupportsServiceTier(model: string | null, serviceTier: CodexServiceTier): boolean {
    const modelSummary = this.models.find((candidate) => candidate.model === model || candidate.id === model);
    if (!modelSummary) return true;
    return (
      modelSummary.serviceTiers.some((tier) => tier.id === serviceTier || tier.name.toLowerCase() === "fast") ||
      modelSummary.additionalSpeedTiers.includes("fast")
    );
  }

  private describeModelEffort(
    model: string | null,
    effort: ReasoningEffort | null,
    serviceTier: CodexServiceTier | null = null,
  ): string {
    return `model ${model ?? this.defaultModel ?? "default"}, reasoning ${
      effort ?? this.defaultReasoningEffort ?? "default"
    }, speed ${isFastServiceTier(serviceTier) ? "Fast" : "Standard"}`;
  }

  private describePermissions(mode: CodexPermissionMode): string {
    const profile = permissionProfile(mode);
    return `permissions ${profile.displayName}`;
  }

  private updateChatForThread(threadId: string, patch: Partial<VoiceChat>): void {
    void this.findChatByThread(threadId)
      .then((context) => {
        if (!context) return null;
        return this.store.updateChat(context.project.id, context.chat.id, patch);
      })
      .then(() => this.emitState())
      .catch((error) => {
        this.emitEvent(
          "app",
          "chatUpdateFailed",
          error instanceof Error ? error.message : "Unable to update chat status.",
        );
      });
  }

  private async findChatByThread(threadId: string): Promise<ChatContext | null> {
    const projects = await this.store.listProjects();
    for (const project of projects) {
      const chat = project.chats.find((candidate) => candidate.codexThreadId === threadId && !candidate.archivedAt);
      if (chat) return { project, chat };
    }
    return null;
  }

  private emitState(): void {
    void this.state().then((state) => this.emit("state", state));
  }

  private emitEvent(source: AppEvent["source"], kind: string, message: string, raw?: unknown): void {
    this.emit("event", {
      at: new Date().toISOString(),
      source,
      kind,
      message,
      raw,
    } satisfies AppEvent);
  }
}
