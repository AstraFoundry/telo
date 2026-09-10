import { useEffect, useRef, useState } from "react";

/** A finished recording: the staged audio file plus its wall-clock duration. */
export interface VoiceNoteRecording {
  readonly file: File;
  readonly durationSeconds: number;
}

export interface VoiceRecorderHandlers {
  /** Fires once the user confirms and the recorder has flushed its chunks. */
  readonly onFinish: (recording: VoiceNoteRecording) => void;
  /**
   * Fires when recording cannot start or the capture fails. `detail` carries
   * the underlying error message, or null when the platform has no
   * microphone/MediaRecorder API at all.
   */
  readonly onError: (detail: string | null) => void;
}

export interface VoiceRecorder {
  /** True while a recording session is live. */
  readonly recording: boolean;
  /** Whole seconds since capture started, for the composer timer. */
  readonly elapsedSeconds: number;
  /** Requests the microphone and starts capture; no-op while already live. */
  start(): Promise<void>;
  /** Stops capture and hands the assembled recording to `onFinish`. */
  finish(): void;
  /** Stops capture and discards the chunks; `onFinish` never fires. */
  cancel(): void;
}

// Telegram voice notes are Opus in an OGG container (tdesktop's
// Media::Clip::PrepareVoiceMessage). Observed platform behavior:
// Chromium/Electron encodes audio/ogg;codecs=opus and audio/webm;codecs=opus
// but not audio/mp4; Safari's MediaRecorder only encodes audio/mp4, which
// TDLib also accepts ("MP3 or M4A as regular audio"). WebM is the last
// resort: TDLib's voice-note contract wants OGG, so a WebM container relies
// on server-side re-encoding, and tdesktop never produces it either.
const PREFERRED_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm;codecs=opus",
];

/** Picks the best container this platform's MediaRecorder can encode. */
export function pickVoiceNoteMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/** The staged file name is transport-only; the extension mirrors the container. */
function voiceNoteFileName(mimeType: string): string {
  if (mimeType.includes("ogg")) return "voice-message.ogg";
  if (mimeType.includes("mp4")) return "voice-message.m4a";
  if (mimeType.includes("webm")) return "voice-message.webm";
  return "voice-message.ogg";
}

interface RecordingSession {
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly chunks: Blob[];
  /** `performance.now()` at capture start; MediaRecorder reports no clock. */
  startedAt: number;
  discard: boolean;
}

function releaseStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * The composer's microphone flow (tdesktop: click the mic to start, click
 * send to deliver, Escape/cancel to discard). All recorder state lives in
 * refs — only the idle/recording flag and the elapsed clock are React state.
 */
export function useVoiceRecorder(
  handlers: VoiceRecorderHandlers,
): VoiceRecorder {
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const sessionRef = useRef<RecordingSession | null>(null);
  // A getUserMedia prompt can outlive the user's change of mind: a cancel
  // while the permission request is in flight is replayed once the stream
  // resolves, so the microphone is never left open.
  const startPendingRef = useRef(false);
  const cancelPendingStartRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const stopTimer = () => {
    if (timerRef.current === null) return;
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const settle = () => {
    stopTimer();
    setElapsedSeconds(null);
  };

  const cancel = () => {
    if (startPendingRef.current) cancelPendingStartRef.current = true;
    const session = sessionRef.current;
    if (!session) return;
    session.discard = true;
    sessionRef.current = null;
    settle();
    if (session.recorder.state !== "inactive") session.recorder.stop();
    else releaseStream(session.stream);
  };

  // An unmounted composer must never finish a recording: the session is
  // discarded and the microphone released without touching state.
  useEffect(
    () => () => {
      cancelPendingStartRef.current = true;
      const session = sessionRef.current;
      if (session) {
        session.discard = true;
        sessionRef.current = null;
        if (session.recorder.state !== "inactive") session.recorder.stop();
        else releaseStream(session.stream);
      }
      stopTimer();
    },
    [],
  );

  const start = async () => {
    if (sessionRef.current || startPendingRef.current) return;
    if (
      typeof MediaRecorder === "undefined" ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      handlersRef.current.onError(null);
      return;
    }
    startPendingRef.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      startPendingRef.current = false;
      handlersRef.current.onError(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    startPendingRef.current = false;
    if (cancelPendingStartRef.current) {
      cancelPendingStartRef.current = false;
      releaseStream(stream);
      return;
    }
    const mimeType = pickVoiceNoteMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (error) {
      releaseStream(stream);
      handlersRef.current.onError(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    const session: RecordingSession = {
      recorder,
      stream,
      chunks: [],
      startedAt: performance.now(),
      discard: false,
    };
    sessionRef.current = session;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) session.chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      sessionRef.current = null;
      settle();
      releaseStream(session.stream);
      const detail =
        "error" in event && event.error instanceof Error
          ? event.error.message
          : null;
      handlersRef.current.onError(detail);
    };
    recorder.onstop = () => {
      releaseStream(session.stream);
      // The stream carries no reliable duration metadata (WebM chunks in
      // particular report Infinity), so the wall clock stands in for the
      // opus-stream decode tdesktop does.
      const durationSeconds = (performance.now() - session.startedAt) / 1000;
      sessionRef.current = null;
      settle();
      if (session.discard) return;
      const type = recorder.mimeType || mimeType || "audio/ogg";
      handlersRef.current.onFinish({
        file: new File(session.chunks, voiceNoteFileName(type), { type }),
        durationSeconds,
      });
    };
    recorder.start();
    setElapsedSeconds(0);
    timerRef.current = window.setInterval(() => {
      setElapsedSeconds(
        Math.floor((performance.now() - session.startedAt) / 1000),
      );
    }, 250);
  };

  const finish = () => {
    const session = sessionRef.current;
    if (!session || session.recorder.state === "inactive") return;
    session.discard = false;
    session.recorder.stop();
  };

  return {
    recording: elapsedSeconds !== null,
    elapsedSeconds: elapsedSeconds ?? 0,
    start,
    finish,
    cancel,
  };
}
