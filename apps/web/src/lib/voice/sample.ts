/**
 * A short synthesized tone as a WAV data URI. Mock chats use it so their voice
 * bubbles are genuinely playable without shipping an audio asset.
 */
export function sampleVoiceDataUrl(durationMs = 900): string {
  const sampleRate = 8000;
  // A placeholder tone does not need to match the label; two seconds is plenty.
  const cappedMs = Math.min(Math.max(1, durationMs), 2000);
  const samples = Math.max(1, Math.round((sampleRate * cappedMs) / 1000));
  const data = new Uint8Array(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 200, (samples - index) / 200);
    const value = Math.round(Math.sin((index / sampleRate) * 2 * Math.PI * 440) * 9000 * fade);
    data[index * 2] = value & 0xff;
    data[index * 2 + 1] = (value >> 8) & 0xff;
  }
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  writeAscii(header, 0, 'RIFF');
  view.setUint32(4, 36 + data.length, true);
  writeAscii(header, 8, 'WAVE');
  writeAscii(header, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(header, 36, 'data');
  view.setUint32(40, data.length, true);

  const bytes = new Uint8Array(header.length + data.length);
  bytes.set(header, 0);
  bytes.set(data, header.length);
  return `data:audio/wav;base64,${base64(bytes)}`;
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    target[offset + index] = text.charCodeAt(index);
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
