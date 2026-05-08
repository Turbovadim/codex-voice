import React from "react";

export function FolderIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.75 6.75a2 2 0 0 1 2-2h4.15l2.05 2.25h6.3a2 2 0 0 1 2 2v8.25a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V6.75Z" />
    </svg>
  );
}

export function PlusIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function DownIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="voice-chevron">
      <path d="m6.5 9 5.5 5.5L17.5 9" />
    </svg>
  );
}

export function CheckIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5.5 12.5 4.25 4.25L18.5 7.25" />
    </svg>
  );
}

export function LightningIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="lightning-icon">
      <path d="M13.5 2.75 5.75 13.2h5.45l-.7 8.05 7.75-10.45H12.8l.7-8.05Z" />
    </svg>
  );
}

export function ShieldIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 18.5 6v5.4c0 4.25-2.6 7.15-6.5 9.1-3.9-1.95-6.5-4.85-6.5-9.1V6L12 3.5Z" />
      <path d="M12 8.2v4.25" />
      <path d="M12 15.8h.01" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string } = {}): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={["voice-chevron", className].filter(Boolean).join(" ")}
    >
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </svg>
  );
}

export function SwitchIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7h10l-3-3M17 17H7l3 3M17 7l-4 4M7 17l4-4" />
    </svg>
  );
}

export function WaveformIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 28 24" aria-hidden="true" className="waveform-icon">
      <path d="M4 10v4M8 6v12M12 3.75v16.5M16 7v10M20 10v4M24 8.5v7" />
    </svg>
  );
}

export function EllipsisIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="ellipsis-icon">
      <circle cx="6.5" cy="12" r="1.45" />
      <circle cx="12" cy="12" r="1.45" />
      <circle cx="17.5" cy="12" r="1.45" />
    </svg>
  );
}

export function CloseIcon(): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}
