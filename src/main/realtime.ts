import type { RealtimeClientSecret } from "../shared/types";
import { getOpenAiApiKey, getOpenAiApiKeyStatus } from "./apiKeyStore";

const REALTIME_ENDPOINT = "https://api.openai.com/v1/realtime/client_secrets";
const REALTIME_REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
type RealtimeReasoningEffort = (typeof REALTIME_REASONING_EFFORTS)[number];

export function realtimeConfig(): {
  available: boolean;
  model: string;
  voice: string;
  reasoningEffort: RealtimeReasoningEffort;
  reason: string | null;
  apiKeySource: "environment" | "saved" | null;
  apiKeyEncrypted: boolean;
} {
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2";
  const voice = process.env.OPENAI_REALTIME_VOICE || "marin";
  const reasoningEffort = realtimeReasoningEffort(process.env.OPENAI_REALTIME_REASONING_EFFORT);
  const status = getOpenAiApiKeyStatus();
  const available = status.configured;
  return {
    available,
    model,
    voice,
    reasoningEffort,
    reason: available
      ? null
      : "Add an OpenAI API key from the menu to enable Realtime voice.",
    apiKeySource: status.source,
    apiKeyEncrypted: status.encrypted,
  };
}

export async function createRealtimeClientSecret(): Promise<RealtimeClientSecret> {
  const apiKey = getOpenAiApiKey();
  const config = realtimeConfig();
  if (!apiKey) {
    throw new Error(config.reason ?? "Missing OPENAI_API_KEY.");
  }

  const response = await fetch(REALTIME_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: config.model,
        reasoning: {
          effort: config.reasoningEffort,
        },
        output_modalities: ["audio"],
        instructions: realtimeInstructions(),
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
            },
          },
          output: {
            voice: config.voice,
          },
        },
        tools: realtimeTools(),
        tool_choice: "auto",
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Realtime session creation failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    value?: string;
    client_secret?: { value?: string; expires_at?: number };
    expires_at?: number;
  };

  const value = data.value ?? data.client_secret?.value;
  if (!value) {
    throw new Error("Realtime client secret response did not include a value.");
  }

  return {
    value,
    expiresAt: data.expires_at ?? data.client_secret?.expires_at,
    model: config.model,
    voice: config.voice,
    reasoningEffort: config.reasoningEffort,
  };
}

function realtimeInstructions(): string {
  return [
    "# Role",
    "You are the voice control layer for the current Codex workspace.",
    "",
    "# Boundary",
    "- You do NOT do computer tasks yourself.",
    "- You do NOT inspect files, infer computer state, choose Codex tools, or invent context.",
    "- Codex is the actual computer-use agent. Your job is to pass the user's request to Codex.",
    "- If the user asks for a computer task, call submit_to_codex with the user's request as faithfully as possible.",
    "- The current workspace is already selected by the host app. Do not create separate companion projects.",
    "- If the user asks to create a chat/thread and gives an explicit name, use that name.",
    "- If the user asks to create a chat/thread with useful context but without an explicit name, create a short, clear, relevant 2-6 word name from that context.",
    "- If the user asks to create a chat/thread without a name or useful context, or the name would be ambiguous, ask: What would you like to use this thread for?",
    "- Creating a chat with context only creates, names, and switches to the thread. Do not submit that context to Codex as work unless the user separately asks you to start the task.",
    "- If the user asks to show open chats, show chats, list chats, switch chats, or get updates on a chat, use the chat tools instead of submit_to_codex.",
    "- Only add context that came from the current live voice conversation.",
    "- Do not make the task more ambitious than what the user asked.",
    "",
    "# Reasoning",
    "- For greetings, direct status checks, approval answers, and short confirmations, respond quickly.",
    "- For multi-step user requests, chat routing, task handoff, or possible ambiguity, reason briefly before speaking or calling a tool.",
    "- Do not spend extra reasoning effort trying to reconstruct unclear audio.",
    "",
    "# Preambles",
    "- Use one short spoken preamble only when you are about to hand off noticeable work to Codex or wait for a tool result.",
    "- Skip preambles for yes/no approvals, user corrections, status answers, unclear audio, and lightweight thread/workspace tools.",
    "- Describe the action, not your internal reasoning. Avoid filler like 'let me think' or 'one moment while I process that'.",
    "",
    "# Unclear Audio",
    "- Only act on clear audio or text.",
    "- If the user's audio is ambiguous, noisy, cut off, or you are unsure of the exact words, ask one brief clarification question.",
    "- Do not guess missing words, approve requests, or call submit_to_codex when the audio is unclear.",
    "",
    "# Tool Behavior",
    "- Use only tools explicitly provided in the current tool list.",
    "- Do not invent, rename, simulate, or claim to use unavailable tools.",
    "- Only say Codex completed or changed something after the relevant tool result confirms it.",
    "- If a tool fails, explain the failure briefly in user-friendly language and offer the next useful step.",
    "",
    "# Conversation",
    "- Speak warmly and briefly.",
    "- Ask a short clarification only when the user's request is too ambiguous to hand to Codex safely.",
    "- Let the user interrupt you naturally.",
    "- When Codex needs approval, ask the user plainly before approving or declining. Mention the concrete command, file change, app/tool, or question when it is available.",
    "- If Codex asks to use an MCP server or app-server tool and the user says yes, allow it, or go ahead, call answer_codex_approval with decision accept.",
    "- If the user says yes, allow it, go ahead, or similar while Codex is waiting for approval, call answer_codex_approval with decision accept.",
    "- If the user says allow for this session, always allow during this session, or similar, call answer_codex_approval with decision acceptForSession.",
    "- If the user says no, do not allow, or decline, call answer_codex_approval with decision decline.",
    "- If the user says cancel, stop, or abort in response to an approval, call answer_codex_approval with decision cancel.",
    "- If Codex asks a question and the user answers by voice, call answer_codex_question.",
    "- When asked for status, use get_codex_status instead of guessing.",
    "- When asked for thread-specific status or updates, use get_codex_chat_status.",
    "- When asked which Codex model or reasoning effort is in use, use get_codex_status.",
    "- When asked to change Codex model, reasoning effort, or permissions, use set_codex_model, set_codex_reasoning_effort, or set_codex_permissions for the current chat unless the user says next turn only.",
  ].join("\n");
}

function realtimeTools(): unknown[] {
  return [
    {
      type: "function",
      name: "submit_to_codex",
      description:
        "Pass the user's spoken request to Codex, the actual computer-use agent. Use for nearly all requests to do something on the computer.",
      parameters: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description: "The user's request, preserved as faithfully as possible.",
          },
          context: {
            type: "string",
            description: "Brief relevant context from the current voice conversation only.",
          },
          chatId: {
            type: "string",
            description: "Optional target chat id when the user explicitly names a chat and it has already been resolved.",
          },
          chatName: {
            type: "string",
            description: "Optional target chat name when the user explicitly names an existing chat.",
          },
        },
        required: ["request"],
      },
    },
    {
      type: "function",
      name: "steer_codex",
      description: "Append an update, correction, or extra instruction to the currently running Codex turn.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          chatId: { type: "string" },
          chatName: { type: "string" },
        },
        required: ["message"],
      },
    },
    {
      type: "function",
      name: "interrupt_codex",
      description: "Interrupt the active Codex turn when the user says to stop, cancel, or never mind.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          chatId: { type: "string" },
          chatName: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "get_codex_status",
      description:
        "Get the current Codex workspace, turn status, model, reasoning effort settings, and pending approvals/questions.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      type: "function",
      name: "answer_codex_approval",
      description:
        "Answer a pending Codex approval, permission, MCP elicitation, auth, or app-server tool request after the user grants, denies, or cancels it by voice. If requestId is omitted, the app will use the only pending approval-style request when there is exactly one.",
      parameters: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "The pending request id. Optional when exactly one approval is pending.",
          },
          decision: {
            type: "string",
            enum: ["accept", "acceptForSession", "decline", "cancel"],
            description:
              "Use accept for yes/allow; acceptForSession only when the user explicitly says for this session or always; decline for no; cancel for abort/stop.",
          },
          spokenConfirmation: {
            type: "string",
            description: "Short phrase the user said, useful for logs.",
          },
        },
        required: ["decision"],
      },
    },
    {
      type: "function",
      name: "answer_codex_question",
      description:
        "Answer a pending Codex question/requestUserInput prompt using the user's spoken answer. If requestId is omitted, the app will use the only pending question when there is exactly one.",
      parameters: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "The pending question request id. Optional when exactly one question is pending.",
          },
          questionId: {
            type: "string",
            description: "Specific question id. Optional when the prompt has one question.",
          },
          answer: {
            type: "string",
            description: "The user's spoken answer.",
          },
        },
        required: ["answer"],
      },
    },
    {
      type: "function",
      name: "set_codex_model",
      description: "Set the Codex model for the current chat or next turn only.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string" },
          scope: {
            type: "string",
            enum: ["chat", "nextTurn"],
            description: "Use chat unless the user says this is only for the next request/turn.",
          },
        },
        required: ["model", "scope"],
      },
    },
    {
      type: "function",
      name: "set_codex_reasoning_effort",
      description: "Set the Codex reasoning effort for the current chat or next turn only.",
      parameters: {
        type: "object",
        properties: {
          reasoningEffort: {
            type: "string",
            enum: ["none", "minimal", "low", "medium", "high", "xhigh"],
          },
          scope: {
            type: "string",
            enum: ["chat", "nextTurn"],
            description: "Use chat unless the user says this is only for the next request/turn.",
          },
        },
        required: ["reasoningEffort", "scope"],
      },
    },
    {
      type: "function",
      name: "set_codex_permissions",
      description:
        "Set the Codex permission mode for the current chat, or next turn only if the user explicitly asks. Default permissions asks when Codex decides approval is needed; auto-review runs automatically inside the workspace sandbox; full access runs without approval prompts or filesystem sandboxing.",
      parameters: {
        type: "object",
        properties: {
          permissionMode: {
            type: "string",
            enum: ["default", "auto-review", "full-access"],
          },
          scope: {
            type: "string",
            enum: ["chat", "nextTurn"],
            description: "Use chat unless the user says this is only for the next request/turn.",
          },
        },
        required: ["permissionMode", "scope"],
      },
    },
    {
      type: "function",
      name: "create_new_codex_chat",
      description:
        "Create a new Codex chat/thread inside the current workspace, make it active, and do not submit work to Codex. Requires a short clear name; ask the user what the thread is for if no useful name/context exists.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          context: {
            type: "string",
            description: "Context used only to choose the chat name, not submitted to Codex as a task.",
          },
        },
        required: ["name"],
      },
    },
    {
      type: "function",
      name: "list_codex_chats",
      description: "List Codex chats/threads in the current workspace.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      type: "function",
      name: "switch_codex_chat",
      description: "Switch the active Codex chat/thread in the current workspace by id or name.",
      parameters: {
        type: "object",
        properties: {
          chatId: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "get_codex_chat_status",
      description: "Get updates/status for one Codex thread or all threads in the current workspace.",
      parameters: {
        type: "object",
        properties: {
          chatId: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "show_open_codex_chats",
      description: "Open the current workspace's thread drawer.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      type: "function",
      name: "summarize_recent_project",
      description: "Ask Codex to summarize a workspace thread, then return that summary for voice narration.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          chatId: { type: "string" },
          chatName: { type: "string" },
        },
      },
    },
  ];
}

function realtimeReasoningEffort(value: string | undefined): RealtimeReasoningEffort {
  if (!value) return "low";
  if (REALTIME_REASONING_EFFORTS.includes(value as RealtimeReasoningEffort)) {
    return value as RealtimeReasoningEffort;
  }
  throw new Error(
    `Unknown OPENAI_REALTIME_REASONING_EFFORT "${value}". Use one of: ${REALTIME_REASONING_EFFORTS.join(", ")}.`,
  );
}
