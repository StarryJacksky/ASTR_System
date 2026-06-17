"use client";

/** 麦克风录音 → 16-bit mono WAV（base64）。声纹注册与网页语音输入共用。
 *  采样率默认 16k（SenseVoice / 声纹模型的目标频率）。 */

export interface MicRecorder {
  stop: () => Promise<string>; // 停止并返回 base64 WAV
}

/** 开始录音，返回可 stop() 的句柄（按下开始、再按停止用）。 */
export async function startRecorder(sampleRate = 16000): Promise<MicRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext({ sampleRate });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc);
  proc.connect(ctx.destination);

  return {
    async stop() {
      proc.disconnect();
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      const sr = ctx.sampleRate;
      await ctx.close();
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const pcm = new Float32Array(total);
      let off = 0;
      for (const c of chunks) {
        pcm.set(c, off);
        off += c.length;
      }
      return wavBase64(pcm, sr);
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
