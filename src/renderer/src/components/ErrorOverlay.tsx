import React from "react";
import { CloseIcon } from "../icons";

export function ErrorOverlay({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="error-overlay" role="alert" aria-live="assertive">
      <p>{message}</p>
      <button type="button" aria-label="Dismiss error" onClick={onDismiss}>
        <CloseIcon />
      </button>
    </div>
  );
}
