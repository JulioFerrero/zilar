import { describe, expect, it, vi } from 'vitest';

import { VoiceTranscribeConfirm } from './voice-transcribe-confirm';

vi.mock('react-native', () => ({
  Modal: 'Modal',
  Pressable: 'Pressable',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

vi.mock('../ui/text', () => ({
  Text: 'Text',
}));

interface TestElement {
  type: unknown;
  props: {
    children?: unknown;
    accessibilityLabel?: string;
    disabled?: boolean;
    onPress?: () => void;
    visible?: boolean;
  };
}

function collect(node: unknown, out: TestElement[] = []): TestElement[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collect(child, out);
    }
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.props === undefined) {
    return out;
  }
  if (typeof element.type === 'function') {
    const Component = element.type as (props: unknown) => unknown;
    return collect(Component(element.props), out);
  }
  out.push(element as TestElement);
  collect(element.props.children, out);
  return out;
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (typeof node === 'object' && 'props' in (node as TestElement)) {
    const element = node as TestElement;
    if (typeof element.type === 'function') {
      const Component = element.type as (props: unknown) => unknown;
      return textOf(Component(element.props));
    }
    return textOf(element.props.children);
  }
  return '';
}

function render(props: {
  open: boolean;
  busy: boolean;
  onDownload?: () => void;
  onClose?: () => void;
}): TestElement[] {
  const tree = VoiceTranscribeConfirm({
    open: props.open,
    busy: props.busy,
    onDownload: props.onDownload ?? (() => {}),
    onClose: props.onClose ?? (() => {}),
  });
  return collect(tree);
}

describe('voice transcribe confirm (T-0179)', () => {
  it('renders nothing when closed', () => {
    expect(render({ open: false, busy: false })).toEqual([]);
  });

  it('shows the 17 MB copy with Download and Cancel', () => {
    const elements = render({ open: true, busy: false });
    const labels = elements.map((element) => element.props.accessibilityLabel ?? '');
    expect(labels).toContain('Download the transcription model');
    expect(labels).toContain('Download transcription model');
    expect(labels).toContain('Cancel transcription download');
    expect(textOf(elements.map((element) => element))).toContain('17 MB, once');
    expect(textOf(elements.map((element) => element))).toContain('Everything stays on your phone');
  });

  it('pressing Download calls onDownload', () => {
    const onDownload = vi.fn();
    const elements = render({ open: true, busy: false, onDownload });
    const download = elements.find(
      (element) => element.props.accessibilityLabel === 'Download transcription model',
    );
    expect(download?.props.disabled).toBe(false);
    download?.props.onPress?.();
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('busy disables both actions and shows Downloading', () => {
    const elements = render({ open: true, busy: true });
    const download = elements.find(
      (element) => element.props.accessibilityLabel === 'Download transcription model',
    );
    const cancel = elements.find(
      (element) => element.props.accessibilityLabel === 'Cancel transcription download',
    );
    expect(download?.props.disabled).toBe(true);
    expect(cancel?.props.disabled).toBe(true);
    expect(textOf(elements.map((element) => element))).toContain('Downloading');
  });
});
