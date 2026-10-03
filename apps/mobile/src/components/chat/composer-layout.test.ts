import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Device layout rules found on a real Android phone (2026-10-03). The mobile
// app has no React Native testing library, so each rule is pinned in the
// source of the component that owns it.
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(here, path), 'utf8');

describe('composer and chat screen layout rules', () => {
  it('keeps the input above the keyboard on Android too', () => {
    // With edge-to-edge (Expo SDK 57) Android no longer resizes the window
    // for the keyboard: `behavior` must be `padding` on every platform, or
    // the input sits under the keyboard.
    const screen = read('../../app/chat/[id].tsx');
    expect(screen).not.toContain("Platform.OS === 'ios' ? 'padding' : undefined");
    expect(screen.match(/behavior="padding"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('hides the other controls while a voice note is being recorded', () => {
    // Attach, the text field, emoji, stickers and GIF share one row with the
    // recorder: left visible they push its Send button off the screen.
    const composer = read('composer.tsx');
    expect(composer).toContain('const [voiceRecording, setVoiceRecording] = useState(false)');
    expect(composer).toContain('{!voiceRecording ? (');
    expect(composer).toContain('onRecordingChange={setVoiceRecording}');
    const recorder = read('voice-recorder.tsx');
    expect(recorder).toContain('onRecordingChange?.(recording)');
  });

  it('shows a send arrow, not a microphone, on the recorder Send button', () => {
    const recorder = read('voice-recorder.tsx');
    const sendButton = recorder.slice(recorder.indexOf('label="Send voice message"'));
    expect(sendButton.slice(0, 300)).toContain('<ArrowUp');
  });
});
