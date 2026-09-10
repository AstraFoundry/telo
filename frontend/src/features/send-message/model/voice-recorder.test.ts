import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pickVoiceNoteMimeType,
  useVoiceRecorder,
  type VoiceNoteRecording,
} from "./voice-recorder";

class FakeMediaRecorder {
  static supported: ReadonlyArray<string> = [];
  static instances: FakeMediaRecorder[] = [];

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supported.includes(type);
  }

  readonly mimeType: string;
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: { error: Error }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "audio/ogg;codecs=opus";
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    // Real recorders flush a final chunk, then fire stop — both async.
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(["audio-bytes"], { type: this.mimeType }),
      });
      this.onstop?.();
    });
  }
}

function fakeStream() {
  const stop = vi.fn();
  return {
    stop,
    stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
  };
}

function setup(handlers?: {
  onFinish?: (recording: VoiceNoteRecording) => void;
  onError?: (detail: string | null) => void;
}) {
  const onFinish = vi.fn(handlers?.onFinish ?? (() => {}));
  const onError = vi.fn(handlers?.onError ?? (() => {}));
  const view = renderHook(() => useVoiceRecorder({ onFinish, onError }));
  return { ...view, onFinish, onError };
}

describe("useVoiceRecorder", () => {
  beforeEach(() => {
    FakeMediaRecorder.supported = [
      "audio/ogg;codecs=opus",
      "audio/webm;codecs=opus",
    ];
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records, ticks the elapsed clock, and finishes with the assembled file", async () => {
    const { stop, stream } = fakeStream();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { result, onFinish } = setup();

    await act(() => result.current.start());

    expect(result.current.recording).toBe(true);
    expect(result.current.elapsedSeconds).toBe(0);
    expect(FakeMediaRecorder.instances[0]?.mimeType).toBe(
      "audio/ogg;codecs=opus",
    );

    now += 2_400;
    act(() => {
      result.current.finish();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
    const recording = onFinish.mock.calls[0]?.[0];
    expect(recording?.file.name).toBe("voice-message.ogg");
    expect(recording?.file.type).toBe("audio/ogg;codecs=opus");
    expect(recording?.file.size).toBeGreaterThan(0);
    // Wall-clock duration, the tdesktop analog's decode stand-in.
    expect(recording?.durationSeconds).toBeCloseTo(2.4);
    expect(stop).toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it("falls back through the container preference list", async () => {
    FakeMediaRecorder.supported = ["audio/webm;codecs=opus"];
    const { stream } = fakeStream();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    const { result, onFinish } = setup();

    await act(() => result.current.start());
    act(() => result.current.finish());
    await act(async () => {
      await Promise.resolve();
    });

    expect(pickVoiceNoteMimeType()).toBe("audio/webm;codecs=opus");
    expect(onFinish.mock.calls[0]?.[0]?.file.name).toBe("voice-message.webm");
  });

  it("discards the take on cancel without calling onFinish", async () => {
    const { stop, stream } = fakeStream();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    const { result, onFinish } = setup();

    await act(() => result.current.start());
    expect(result.current.recording).toBe(true);

    act(() => result.current.cancel());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.recording).toBe(false);
    expect(onFinish).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("releases the microphone when a cancel lands during the permission prompt", async () => {
    const { stop, stream } = fakeStream();
    let grant: ((value: MediaStream) => void) | undefined;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              grant = resolve;
            }),
        ),
      },
    });
    const { result, onError } = setup();

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.start();
    });
    act(() => result.current.cancel());
    await act(async () => {
      grant?.(stream);
      await pending;
    });

    expect(result.current.recording).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("surfaces a missing MediaRecorder as a null-detail error", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { result, onFinish, onError } = setup();

    await act(() => result.current.start());

    expect(onError).toHaveBeenCalledWith(null);
    expect(onFinish).not.toHaveBeenCalled();
    expect(result.current.recording).toBe(false);
  });

  it("surfaces a denied microphone permission", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new Error("Permission denied");
        }),
      },
    });
    const { result, onError } = setup();

    await act(() => result.current.start());

    expect(onError).toHaveBeenCalledWith("Permission denied");
    expect(result.current.recording).toBe(false);
  });
});
