import React, { useEffect, useRef, useState } from "react";
import type { AppEvent, AppState, CodexTurnOutput, PendingCodexRequest } from "../../shared/types";
import { emptyState } from "./appState";
import { DebugDashboard } from "./components/DebugDashboard";
import { VoiceHome } from "./components/VoiceHome";
import { RealtimeVoiceClient } from "./realtimeClient";
import type { AppWindowKind } from "./rendererTypes";

function appWindowKind(): AppWindowKind {
  const kind = new URLSearchParams(window.location.search).get("window");
  return kind === "debug" ? "debug" : "voice";
}

export function App(): React.ReactElement {
  const [windowKind] = useState<AppWindowKind>(() => appWindowKind());
  const [state, setState] = useState<AppState>(emptyState);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [message, setMessage] = useState("");
  const [steer, setSteer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState("Realtime disconnected.");
  const [voiceConnected, setVoiceConnected] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [voicePaused, setVoicePaused] = useState(false);
  const voiceRef = useRef<RealtimeVoiceClient | null>(null);

  useEffect(() => {
    if (!error) return undefined;
    const timeoutId = window.setTimeout(() => setError(null), 15000);
    return () => window.clearTimeout(timeoutId);
  }, [error]);

  useEffect(() => {
    document.title = windowKind === "debug" ? "Codex Voice Debug" : "Codex Voice";
    void refreshState();
    void refreshEvents();
    const offState = window.codexVoice.onAppState(setState);
    const offEvent = window.codexVoice.onAppEvent((event) => {
      setEvents((current) => [event, ...current].slice(0, 250));
      if (event.source === "codex" && event.kind === "serverRequest") {
        voiceRef.current?.speakPendingRequest(event.raw as PendingCodexRequest);
      } else if (event.source === "codex" && event.kind === "turn/finalOutput") {
        voiceRef.current?.injectCodexTurnOutput(event.raw as CodexTurnOutput);
      } else if (event.source === "codex" && event.kind === "error") {
        voiceRef.current?.speakStatus(event.message);
      }
    });
    return () => {
      offState();
      offEvent();
      voiceRef.current?.disconnect();
    };
  }, []);

  async function refreshState(): Promise<void> {
    setState(await window.codexVoice.getState());
  }

  async function refreshEvents(): Promise<void> {
    setEvents(await window.codexVoice.getEvents());
  }

  async function clearEvents(): Promise<void> {
    await window.codexVoice.clearEvents();
    setEvents([]);
  }

  async function logEvent(event: AppEvent): Promise<void> {
    await window.codexVoice.logEvent(event);
  }

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await action();
      await refreshState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function toggleVoice(): Promise<void> {
    if (voiceRef.current?.connected || voiceConnected) {
      voiceRef.current?.disconnect();
      voiceRef.current = null;
      setVoiceConnected(false);
      setVoiceConnecting(false);
      setVoicePaused(false);
      setVoiceStatus("Realtime disconnected.");
      return;
    }
    if (voiceConnecting) return;
    await runAction(async () => {
      setVoiceConnecting(true);
      const client = new RealtimeVoiceClient({
        onConnectionChange: (connected, label) => {
          setVoiceConnected(connected);
          setVoiceConnecting(!connected && label !== "Realtime data channel closed.");
          if (connected || label === "Realtime data channel closed." || label === "Realtime disconnected.") {
            setVoicePaused(false);
          }
          setVoiceStatus(label);
        },
        onLog: (event) => {
          void window.codexVoice.logEvent(event);
        },
      });
      voiceRef.current = client;
      try {
        await client.connect();
      } catch (caught) {
        if (voiceRef.current === client) voiceRef.current = null;
        setVoicePaused(false);
        throw caught;
      } finally {
        setVoiceConnecting(false);
      }
    });
  }

  async function handleOrbAction(): Promise<void> {
    const client = voiceRef.current;
    if (client?.connected) {
      const nextPaused = !client.paused;
      client.setPaused(nextPaused);
      setVoicePaused(nextPaused);
      setVoiceStatus(nextPaused ? "Realtime voice paused." : "Realtime voice resumed.");
      return;
    }
    if (voiceConnected) {
      setVoiceConnected(false);
      setVoicePaused(false);
      return;
    }
    await toggleVoice();
  }

  async function openDebugWindow(): Promise<void> {
    await runAction(() => window.codexVoice.openDebugWindow());
  }

  if (windowKind === "debug") {
    return (
      <DebugDashboard
        state={state}
        events={events}
        error={error}
        message={message}
        steer={steer}
        setMessage={setMessage}
        setSteer={setSteer}
        onDismissError={() => setError(null)}
        onAction={runAction}
        onClearEvents={clearEvents}
        onRefresh={refreshState}
        onLogEvent={logEvent}
      />
    );
  }

  return (
    <VoiceHome
      state={state}
      error={error}
      voiceConnected={voiceConnected}
      voiceConnecting={voiceConnecting}
      voicePaused={voicePaused}
      onAction={runAction}
      onDismissError={() => setError(null)}
      onOrbAction={handleOrbAction}
      onRefresh={refreshState}
      onShowDebug={openDebugWindow}
      onToggleVoice={toggleVoice}
    />
  );
}
