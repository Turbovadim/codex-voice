import type {
  ApprovalDecision,
  PendingCodexRequest,
  PendingRequestDetail,
  PendingRequestQuestion,
  PendingRequestQuestionOption,
  ToolQuestionAnswer,
} from "../../shared/types";
import type { CodexJsonMessage } from "../codexBridge";
import { stringField } from "./threadText";

export { stringField } from "./threadText";

export function describeServerRequest(message: CodexJsonMessage): PendingCodexRequest {
  const params = (message.params ?? {}) as Record<string, unknown>;
  const method = message.method ?? "serverRequest";
  const requestId = message.id ?? "";

  if (method === "item/commandExecution/requestApproval") {
    const command = stringField(params.command);
    const details = detailList([
      detail("Command", command),
      detail("Directory", stringField(params.cwd)),
      detail("Reason", stringField(params.reason)),
      detail("Approval callback", stringField(params.approvalId)),
      detail("Network context", describeNetworkApprovalContext(params.networkApprovalContext)),
      detail("Parsed actions", describeCommandActions(params.commandActions)),
      detail("Proposed command rule", describeExecpolicyAmendment(params.proposedExecpolicyAmendment)),
      detail("Proposed network rule", describeNetworkPolicyAmendments(params.proposedNetworkPolicyAmendments)),
    ]);
    return {
      kind: "approval",
      requestId,
      method,
      threadId: stringField(params.threadId),
      turnId: stringField(params.turnId),
      itemId: stringField(params.itemId),
      title: "Command approval needed",
      subtitle: command ? "Shell command" : "Command execution",
      body: requestBody(stringField(params.reason), command ? `Command: ${command}` : null, "Codex wants to run a command."),
      details,
      options: ["accept", "acceptForSession", "decline", "cancel"],
      raw: message,
    };
  }

  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    const fileChanges =
      method === "applyPatchApproval" ? describeFileChanges(params.fileChanges) : undefined;
    const details = detailList([
      detail("Reason", stringField(params.reason)),
      detail("Requested write root", stringField(params.grantRoot)),
      detail("Files", fileChanges),
      detail("Call", stringField(params.callId)),
    ]);
    return {
      kind: "approval",
      requestId,
      method,
      threadId: stringField(params.threadId) || stringField(params.conversationId),
      turnId: stringField(params.turnId),
      itemId: stringField(params.itemId),
      title: "File change approval needed",
      subtitle: stringField(params.grantRoot) ? "Extra write access" : "File edit",
      body: requestBody(
        stringField(params.reason),
        fileChanges ? `Files: ${fileChanges}` : null,
        "Codex wants to apply file changes.",
      ),
      details,
      options: ["accept", "acceptForSession", "decline", "cancel"],
      raw: message,
    };
  }

  if (method === "item/tool/requestUserInput") {
    const questions = normalizeQuestions(params.questions);
    const questionBody = questions
      .map((question) => describeQuestionForBody(question))
      .filter(Boolean)
      .join("\n\n");
    return {
      kind: "question",
      requestId,
      method,
      threadId: stringField(params.threadId),
      turnId: stringField(params.turnId),
      itemId: stringField(params.itemId),
      title: questions.length === 1 ? questions[0].header || "Codex has a question" : "Codex has questions",
      subtitle: "Waiting on user input",
      body: questionBody || "Codex is waiting for user input.",
      details: detailList([detail("Questions", String(questions.length || 1))]),
      questions,
      raw: message,
    };
  }

  if (method === "mcpServer/elicitation/request") {
    const mode = stringField(params.mode);
    const details = detailList([
      detail("Server", stringField(params.serverName)),
      detail("Mode", mode),
      detail("URL", stringField(params.url)),
      detail("Elicitation", stringField(params.elicitationId)),
      detail("Schema", mode === "form" ? describeJsonValue(params.requestedSchema) : undefined),
    ]);
    return {
      kind: "elicitation",
      requestId,
      method,
      threadId: stringField(params.threadId),
      turnId: stringField(params.turnId),
      title: "MCP input needed",
      subtitle: stringField(params.serverName) ?? undefined,
      body: requestBody(stringField(params.message), stringField(params.url), "An MCP server is asking for input."),
      details,
      options: ["accept", "decline", "cancel"],
      raw: message,
    };
  }

  if (method === "item/permissions/requestApproval") {
    const details = detailList([
      detail("Directory", stringField(params.cwd)),
      detail("Reason", stringField(params.reason)),
      detail("Permissions", describePermissionProfile(params.permissions)),
    ]);
    return {
      kind: "approval",
      requestId,
      method,
      threadId: stringField(params.threadId),
      turnId: stringField(params.turnId),
      itemId: stringField(params.itemId),
      title: "Permission approval needed",
      subtitle: "Additional permissions",
      body: stringField(params.reason) || "Codex is requesting additional permissions.",
      details,
      options: ["accept", "acceptForSession", "decline", "cancel"],
      raw: message,
    };
  }

  if (method === "item/tool/call") {
    const details = detailList([
      detail("Namespace", stringField(params.namespace)),
      detail("Tool", stringField(params.tool)),
      detail("Arguments", describeJsonValue(params.arguments)),
    ]);
    return {
      kind: "tool",
      requestId,
      method,
      threadId: stringField(params.threadId),
      turnId: stringField(params.turnId),
      itemId: stringField(params.callId),
      title: "Tool call approval needed",
      subtitle: stringField(params.tool),
      body: stringField(params.tool)
        ? `Codex wants to use ${[stringField(params.namespace), stringField(params.tool)].filter(Boolean).join(".")}.`
        : "Codex wants to use a dynamic app-server tool.",
      details,
      options: ["accept", "decline", "cancel"],
      raw: message,
    };
  }

  if (method === "account/chatgptAuthTokens/refresh") {
    return {
      kind: "auth",
      requestId,
      method,
      title: "ChatGPT auth refresh needed",
      subtitle: "Account token refresh",
      body:
        "Codex app-server asked this client to refresh ChatGPT auth tokens. Codex Voice cannot refresh ChatGPT desktop auth tokens directly.",
      details: detailList([
        detail("Reason", stringField(params.reason)),
        detail("Previous account", stringField(params.previousAccountId)),
      ]),
      options: ["accept", "decline", "cancel"],
      raw: message,
    };
  }

  if (method === "execCommandApproval") {
    const command = Array.isArray(params.command) ? params.command.join(" ") : "";
    const details = detailList([
      detail("Command", command),
      detail("Directory", stringField(params.cwd)),
      detail("Reason", stringField(params.reason)),
      detail("Approval callback", stringField(params.approvalId)),
      detail("Call", stringField(params.callId)),
      detail("Parsed command", describeJsonValue(params.parsedCmd)),
    ]);
    return {
      kind: "approval",
      requestId,
      method,
      threadId: stringField(params.conversationId),
      title: "Command approval needed",
      subtitle: "Legacy command approval",
      body: requestBody(stringField(params.reason), command ? `Command: ${command}` : null, "Codex wants to run a command."),
      details,
      options: ["accept", "acceptForSession", "decline", "cancel"],
      raw: message,
    };
  }

  return {
    kind: "unknown",
    requestId,
    method,
    title: "Codex needs a response",
    subtitle: "Unsupported app-server request",
    body: method,
    details: detailList([detail("Params", describeJsonValue(params))]),
    options: ["cancel"],
    raw: message,
  };
}

export function detail(label: string, value: string | undefined | null): PendingRequestDetail | null {
  if (!value?.trim()) return null;
  return { label, value: value.trim() };
}

export function detailList(items: Array<PendingRequestDetail | null>): PendingRequestDetail[] {
  return items.filter((item): item is PendingRequestDetail => item !== null);
}

export function requestBody(...parts: Array<string | null | undefined>): string {
  const fallback = parts.at(-1);
  const body = parts
    .slice(0, -1)
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n");
  return body || fallback || "Codex is waiting for a user response.";
}

export function normalizeQuestions(value: unknown): PendingRequestQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((question, index): PendingRequestQuestion | null => {
      if (!question || typeof question !== "object") return null;
      const record = question as Record<string, unknown>;
      const options = Array.isArray(record.options)
        ? record.options
            .map((option): PendingRequestQuestionOption | null => {
              if (!option || typeof option !== "object") return null;
              const optionRecord = option as Record<string, unknown>;
              const label = stringField(optionRecord.label);
              if (!label) return null;
              return {
                label,
                description: stringField(optionRecord.description) ?? "",
              };
            })
            .filter((option): option is PendingRequestQuestionOption => option !== null)
        : null;
      return {
        id: stringField(record.id) ?? `question-${index + 1}`,
        header: stringField(record.header) ?? `Question ${index + 1}`,
        question: stringField(record.question) ?? "Codex is asking for input.",
        isOther: Boolean(record.isOther),
        isSecret: Boolean(record.isSecret),
        options,
      };
    })
    .filter((question): question is PendingRequestQuestion => question !== null);
}

export function describeQuestionForBody(question: PendingRequestQuestion): string {
  const options = question.options?.length
    ? `Options: ${question.options.map((option) => option.label).join(", ")}`
    : null;
  return [question.header, question.question, options].filter(Boolean).join("\n");
}

export function describeCommandActions(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .map((action) => {
      if (!action || typeof action !== "object") return null;
      const record = action as Record<string, unknown>;
      const type = stringField(record.type) ?? "unknown";
      if (type === "read") {
        return `Read ${stringField(record.name) ?? "file"} at ${stringField(record.path) ?? "unknown path"}`;
      }
      if (type === "listFiles") {
        return `List files${stringField(record.path) ? ` in ${stringField(record.path)}` : ""}`;
      }
      if (type === "search") {
        return `Search${stringField(record.query) ? ` for ${stringField(record.query)}` : ""}${
          stringField(record.path) ? ` in ${stringField(record.path)}` : ""
        }`;
      }
      return stringField(record.command) ?? type;
    })
    .filter(Boolean)
    .join("; ");
}

export function describeNetworkApprovalContext(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const host = stringField(record.host);
  const protocol = stringField(record.protocol);
  if (!host && !protocol) return undefined;
  return [protocol, host].filter(Boolean).join(" ");
}

export function describeExecpolicyAmendment(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((entry) => String(entry)).join(" ");
}

export function describeNetworkPolicyAmendments(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .map((amendment) => {
      if (!amendment || typeof amendment !== "object") return null;
      const record = amendment as Record<string, unknown>;
      const action = stringField(record.action) ?? "allow";
      const host = stringField(record.host) ?? "unknown host";
      return `${action} ${host}`;
    })
    .filter(Boolean)
    .join("; ");
}

export function describePermissionProfile(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  const network = record.network as Record<string, unknown> | null | undefined;
  if (network && typeof network === "object") {
    parts.push(`network ${network.enabled === false ? "disabled" : "enabled"}`);
  }
  const fileSystem = record.fileSystem as Record<string, unknown> | null | undefined;
  if (fileSystem && typeof fileSystem === "object") {
    const read = Array.isArray(fileSystem.read) ? fileSystem.read.map(String).join(", ") : "";
    const write = Array.isArray(fileSystem.write) ? fileSystem.write.map(String).join(", ") : "";
    const entries = Array.isArray(fileSystem.entries) ? `${fileSystem.entries.length} entries` : "";
    if (read) parts.push(`read: ${read}`);
    if (write) parts.push(`write: ${write}`);
    if (entries) parts.push(entries);
  }
  return parts.join("; ") || describeJsonValue(value);
}

export function describeFileChanges(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const names = Object.keys(value as Record<string, unknown>);
  if (names.length === 0) return undefined;
  return names.length <= 5 ? names.join(", ") : `${names.slice(0, 5).join(", ")} and ${names.length - 5} more`;
}

export function describeJsonValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export type ServerRequestResponse =
  | { kind: "result"; result: unknown }
  | { kind: "error"; message: string };

export function isAcceptDecision(decision: ApprovalDecision): boolean {
  return decision === "accept" || decision === "acceptForSession";
}

export function responseForDecision(request: PendingCodexRequest, decision: ApprovalDecision): ServerRequestResponse {
  const method = request.method;
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    const legacy = {
      accept: "approved",
      acceptForSession: "approved_for_session",
      decline: "denied",
      cancel: "abort",
    } as const;
    return { kind: "result", result: { decision: legacy[decision] } };
  }
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    return { kind: "result", result: { decision } };
  }
  if (method === "mcpServer/elicitation/request") {
    const action = decision === "cancel" ? "cancel" : decision === "decline" ? "decline" : "accept";
    return { kind: "result", result: { action, content: null, _meta: null } };
  }
  if (method === "item/permissions/requestApproval") {
    if (decision === "decline" || decision === "cancel") {
      return { kind: "error", message: `Permission request ${decision === "cancel" ? "cancelled" : "declined"}.` };
    }
    return {
      kind: "result",
      result: {
        permissions: permissionGrantFromRequest(request),
        scope: decision === "acceptForSession" ? "session" : "turn",
      },
    };
  }
  if (method === "item/tool/call") {
    return {
      kind: "result",
      result: {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: "Codex Voice cannot service dynamic app-server tool calls yet.",
          },
        ],
      },
    };
  }
  if (method === "account/chatgptAuthTokens/refresh") {
    return {
      kind: "error",
      message:
        "Codex Voice cannot refresh ChatGPT auth tokens directly. Re-authenticate Codex from the desktop app or CLI, then retry.",
    };
  }
  return { kind: "error", message: `Unsupported Codex server request method: ${method}` };
}

export function dynamicToolResponseFromMcpResult(result: unknown): ServerRequestResponse {
  const response = result as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: boolean;
  };
  const contentItems = Array.isArray(response.content)
    ? response.content.map(dynamicContentItemFromMcpContent)
    : [];
  if (response.structuredContent !== undefined && response.structuredContent !== null) {
    contentItems.push({
      type: "inputText",
      text: describeJsonValue(response.structuredContent) ?? String(response.structuredContent),
    });
  }
  if (contentItems.length === 0) {
    contentItems.push({
      type: "inputText",
      text: response.isError ? "MCP tool returned an error with no content." : "MCP tool completed with no content.",
    });
  }
  return {
    kind: "result",
    result: {
      success: response.isError !== true,
      contentItems,
    },
  };
}

export function dynamicContentItemFromMcpContent(content: unknown): { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string } {
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      return { type: "inputText", text: record.text };
    }
    if (record.type === "image") {
      const imageUrl = stringField(record.imageUrl);
      if (imageUrl) return { type: "inputImage", imageUrl };
      const data = stringField(record.data);
      const mimeType = stringField(record.mimeType) ?? "image/png";
      if (data) return { type: "inputImage", imageUrl: `data:${mimeType};base64,${data}` };
    }
  }
  return {
    type: "inputText",
    text: describeJsonValue(content) ?? String(content),
  };
}

export function normalizeToolQuestionAnswers(
  request: PendingCodexRequest,
  answers: ToolQuestionAnswer[],
): ToolQuestionAnswer[] {
  const byQuestionId = new Map(
    answers.map((answer) => [
      answer.questionId,
      answer.answers.map((value) => value.trim()).filter(Boolean),
    ]),
  );
  const expectedQuestions = request.questions ?? [];
  if (expectedQuestions.length === 0) {
    const normalized = answers
      .map((answer) => ({
        questionId: answer.questionId,
        answers: answer.answers.map((value) => value.trim()).filter(Boolean),
      }))
      .filter((answer) => answer.answers.length > 0);
    if (normalized.length === 0) {
      throw new Error("Answer is required before resolving Codex's question.");
    }
    return normalized;
  }

  return expectedQuestions.map((question) => {
    const values = byQuestionId.get(question.id) ?? [];
    if (values.length === 0) {
      throw new Error(`Answer is required for "${question.header || question.question}".`);
    }
    return { questionId: question.id, answers: values };
  });
}

export function permissionGrantFromRequest(request: PendingCodexRequest): Record<string, unknown> {
  const raw = request.raw as { params?: { permissions?: { network?: unknown; fileSystem?: unknown } } };
  const permissions = raw.params?.permissions ?? {};
  return {
    ...(permissions.network ? { network: permissions.network } : {}),
    ...(permissions.fileSystem ? { fileSystem: permissions.fileSystem } : {}),
  };
}
