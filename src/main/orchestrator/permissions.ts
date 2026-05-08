import type {
  CodexApprovalPolicy,
  CodexPermissionMode,
  CodexSandboxMode,
} from "../../shared/types";
import { CODEX_PERMISSION_PROFILES } from "../../shared/types";

export function permissionProfile(mode: CodexPermissionMode) {
  return (
    CODEX_PERMISSION_PROFILES.find((profile) => profile.mode === mode) ??
    CODEX_PERMISSION_PROFILES[0]
  );
}

export function permissionParams(mode: CodexPermissionMode): {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
} {
  const profile = permissionProfile(mode);
  return {
    approvalPolicy: profile.approvalPolicy,
    sandbox: profile.sandbox,
  };
}

export function permissionModeFromText(text: string): CodexPermissionMode {
  const normalized = text.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["default", "default-permissions", "normal"].includes(normalized)) return "default";
  if (["auto", "auto-review", "autoreview"].includes(normalized)) return "auto-review";
  if (["full", "full-access", "danger", "danger-full-access"].includes(normalized)) return "full-access";
  throw new Error("Unknown permission mode. Use default, auto-review, or full-access.");
}
