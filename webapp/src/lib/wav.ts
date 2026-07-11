"use client";

/** 麦克风录音 → 16-bit mono WAV（base64）。声纹注册与网页语音输入共用。
 *  采样率默认 16k（SenseVoice / 声纹模型的目标频率）。 */

export interface MicRecorder {
  stop: () => Promise<string>; // 停止并返回 base64 WAV
  cancel: () => Promise<void>; // 释放麦克风，不保留音频
}

export type MicRecorderFactory = (sampleRate?: number) => Promise<MicRecorder>;

/** 开始录音，返回可 stop() 的句柄（按下开始、再按停止用）。 */
export async function startRecorder(sampleRate = 16000): Promise<MicRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  let ctx: AudioContext | null = null;
  let src: MediaStreamAudioSourceNode | null = null;
  let proc: ScriptProcessorNode | null = null;
  let silentGain: GainNode | null = null;
  const chunks: Float32Array[] = [];
  let cleanupPromise: Promise<void> | null = null;
  let stopPromise: Promise<string> | null = null;
  let cancelPromise: Promise<void> | null = null;
  let cancelled = false;

  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      let firstError: unknown;
      let hasError = false;
      const rememberError = (error: unknown) => {
        if (hasError) return;
        firstError = error;
        hasError = true;
      };
      const release = (operation: () => void) => {
        try {
          operation();
        } catch (error) {
          rememberError(error);
        }
      };

      if (proc) {
        const ownedProcessor = proc;
        release(() => {
          ownedProcessor.onaudioprocess = null;
        });
        release(() => ownedProcessor.disconnect());
      }
      if (src) release(() => src?.disconnect());
      if (silentGain) release(() => silentGain?.disconnect());
      let tracks: readonly MediaStreamTrack[] = [];
      try {
        tracks = [...stream.getTracks()];
      } catch (error) {
        rememberError(error);
        try {
          tracks = [...stream.getAudioTracks()];
        } catch (fallbackError) {
          rememberError(fallbackError);
        }
      }
      for (const track of tracks) release(() => track.stop());
      if (ctx) {
        try {
          await ctx.close();
        } catch (error) {
          rememberError(error);
        }
      }
      if (hasError) throw firstError;
    })();
    return cleanupPromise;
  };

  try {
    ctx = new AudioContext({ sampleRate });
    src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    proc.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    src.connect(proc);
    proc.connect(silentGain);
    silentGain.connect(ctx.destination);
  } catch (error) {
    try {
      await cleanup();
    } catch {
      // Preserve the initialization failure while still exhausting cleanup.
    }
    throw error;
  }

  const recordedSampleRate = ctx.sampleRate;

  return {
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        await cleanup();
        if (cancelled) throw new DOMException("Recording cancelled", "AbortError");
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const pcm = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          pcm.set(chunk, offset);
          offset += chunk.length;
        }
        return wavBase64(pcm, recordedSampleRate);
      })();
      return stopPromise;
    },
    cancel() {
      cancelled = true;
      cancelPromise ??= cleanup();
      return cancelPromise;
    },
  };
}

/** 录固定时长（声纹注册用）。 */
export async function recordWavBase64(seconds: number, sampleRate = 16000): Promise<string> {
  const rec = await startRecorder(sampleRate);
  await new Promise((r) => setTimeout(r, Math.round(seconds * 1000)));
  return rec.stop();
}

function wavBase64(pcm: Float32Array, sampleRate: number): string {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const wr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  wr(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  wr(8, "WAVE");
  wr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  wr(36, "data");
  dv.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    dv.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    o += 2;
  }
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
