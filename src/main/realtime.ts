import type { RealtimeClientSecret } from "../shared/types";
import { getOpenAiApiKey, getOpenAiApiKeyStatus } from "./apiKeyStore";

const REALTIME_ENDPOINT = "https://api.openai.com/v1/realtime/client_secrets";

export function realtimeConfig(): {
  available: boolean;
  model: string;
  voice: string;
  reason: string | null;
  apiKeySource: "environment" | "saved" | null;
  apiKeyEncrypted: boolean;
} {
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-1.5";
  const voice = process.env.OPENAI_REALTIME_VOICE || "marin";
  const status = getOpenAiApiKeyStatus();
  const available = status.configured;
  return {
    available,
    model,
    voice,
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
  };
}

function realtimeInstructions(): string {
  return [
    "# Role",
    "You are the voice communication layer for a local Codex desktop app.",
    "",
    "# Boundary",
    "- You do NOT do computer tasks yourself.",
    "- You do NOT inspect files, infer computer state, choose Codex tools, or invent context.",
    "- Codex is the actual computer-use agent. Your job is to pass the user's request to Codex.",
    "- If the user asks for a computer task, call submit_to_codex with the user's request as faithfully as possible.",
    "- Only add context that came from the current live voice conversation.",
    "- Do not make the task more ambitious than what the user asked.",
    "",
    "# Conversation",
    "- Speak warmly and briefly.",
    "- Ask a short clarification only when the user's request is too ambiguous to hand to Codex safely.",
    "- Let the user interrupt you naturally.",
    "- When Codex needs approval, ask the user plainly before approving or declining. Mention the concrete command, file change, app/tool, or question when it is available.",
    "- If the user says yes, allow it, go ahead, or similar while Codex is waiting for approval, call answer_codex_approval with decision accept.",
    "- If the user says allow for this session, always allow during this session, or similar, call answer_codex_approval with decision acceptForSession.",
    "- If the user says no, do not allow, or decline, call answer_codex_approval with decision decline.",
    "- If the user says cancel, stop, or abort in response to an approval, call answer_codex_approval with decision cancel.",
    "- If Codex asks a question and the user answers by voice, call answer_codex_question.",
    "- When asked for status, use get_codex_status instead of guessing.",
    "- When asked which Codex model or reasoning effort is in use, use get_codex_status.",
    "- When asked to change Codex model or reasoning effort, use set_codex_model or set_codex_reasoning_effort.",
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
        },
      },
    },
    {
      type: "function",
      name: "get_codex_status",
      description:
        "Get the current Codex session, turn status, model, reasoning effort settings, and pending approvals/questions.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      type: "function",
      name: "answer_codex_approval",
      description:
        "Answer a pending Codex approval or permission request after the user grants, denies, or cancels it by voice. If requestId is omitted, the app will use the only pending approval when there is exactly one.",
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
      description: "Set the Codex model for the current session or next turn only.",
      parameters: {
        type: "object",
        properties: {
          model: { type: "string" },
          scope: {
            type: "string",
            enum: ["session", "nextTurn"],
            description: "Use session unless the user says this is only for the next request/turn.",
          },
        },
        required: ["model", "scope"],
      },
    },
    {
      type: "function",
      name: "set_codex_reasoning_effort",
      description: "Set the Codex reasoning effort for the current session or next turn only.",
      parameters: {
        type: "object",
        properties: {
          reasoningEffort: {
            type: "string",
            enum: ["none", "minimal", "low", "medium", "high", "xhigh"],
          },
          scope: {
            type: "string",
            enum: ["session", "nextTurn"],
            description: "Use session unless the user says this is only for the next request/turn.",
          },
        },
        required: ["reasoningEffort", "scope"],
      },
    },
    {
      type: "function",
      name: "create_new_codex_session",
      description: "Create a new Codex voice session with a fresh Documents workspace folder.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "list_recent_codex_sessions",
      description: "List recent Codex voice sessions that can be summarized or continued.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    {
      type: "function",
      name: "continue_codex_session",
      description: "Resume an existing Codex voice session by id, or the most recent session if no id is supplied.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "summarize_recent_session",
      description: "Ask Codex to summarize a recent session, then return that summary for voice narration.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
        },
      },
    },
  ];
}
