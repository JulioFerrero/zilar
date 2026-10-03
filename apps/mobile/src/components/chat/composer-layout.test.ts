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
    // Attach, the text field and emoji share one row with the recorder:
    // left visible they push its Send button off the screen. Stickers and
    // GIFs live inside the emoji sheet (T-0175), not as row buttons.
    const composer = read('composer.tsx');
    expect(composer).toContain('const [voiceRecording, setVoiceRecording] = useState(false)');
    expect(composer).toContain('{!voiceRecording ? (');
    expect(composer).toContain('onRecordingChange={setVoiceRecording}');
    const recorder = read('voice-recorder.tsx');
    expect(recorder).toContain('onRecordingChange?.(recording)');
  });

  it('records while the mic is held and sends on release', () => {
    // Hold to record, release to send, slide left to cancel: the mic must
    // stay mounted under the finger (a remount drops the touch).
    const recorder = read('voice-recorder.tsx');
    expect(recorder).toContain('PanResponder.create');
    expect(recorder).toContain('onPanResponderRelease');
    expect(recorder).toContain('CANCEL_SLIDE_PX');
    expect(recorder).not.toContain('Send voice message');
  });

  it('stretches the voice waveform to the end of the bubble', () => {
    const voice = read('voice-message.tsx');
    expect(voice).not.toContain('WAVEFORM_WIDTH');
    expect(voice).toContain('flex-1 flex-row items-center justify-between');
  });

  it('keeps the emoji category strip at its natural height (no empty gap under the tabs)', () => {
    // Seen on the Android emulator (2026-10-03): a horizontal ScrollView
    // grows to fill the free height unless `flexGrow: 0` is set.
    const tab = read('emoji-tab.tsx');
    const strip = tab.slice(tab.indexOf('accessibilityLabel="Emoji categories"'));
    expect(strip.slice(0, 400)).toContain('style={{ flexGrow: 0 }}');
  });
});
