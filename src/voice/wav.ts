/**
 * A WAV file from 16-bit samples — what `useListening` sends to M11's
 * recogniser (day 4). Pure, so `npm test` checks the header byte by byte.
 *
 * WAV rather than the browser's own MediaRecorder output: a WebM recording
 * cut at an arbitrary moment loses its header and the recogniser cannot read
 * it, while samples from the listener's own audio thread can be cut anywhere
 * — including a little BEFORE the detector decided someone was speaking,
 * which is where every answer's first word is.
 */

/** 16 kHz is what Whisper listens at; anything more is bytes for nothing. */
export const ASR_RATE = 16_000;

export function encodeWav(samples: Int16Array, rate: number = ASR_RATE): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples.length * 2));
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a frame
  view.setUint16(34, 16, true); // bits a sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i]!, true);
  return bytes;
}

/** Samples gathered frame by frame, joined. */
export function joinSamples(chunks: readonly Int16Array[]): Int16Array {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
