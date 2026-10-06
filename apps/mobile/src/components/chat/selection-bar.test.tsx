import { describe, expect, it, vi } from 'vitest';

import { SelectionBar } from './selection-bar';

// The bar installs a BackHandler effect; this Node render never runs effects.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useEffect: () => {} };
});

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/text', () => ({
  Text: 'Text',
}));

vi.mock('@/components/ui/button', async () => {
  const { createElement } = await import('react');
  return {
    Button: ({ children, ...props }: { children?: unknown }) =>
      createElement('Pressable', props as never, children as never),
  };
});

vi.mock('lucide-react-native', () => ({
  Forward: 'Forward',
}));

interface TestElement {
  type: unknown;
  props: {
    children?: unknown;
    disabled?: boolean;
    onPress?: () => void;
    accessibilityLiveRegion?: string;
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

function nodeText(node: unknown): string {
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(nodeText).join('');
  }
  if (node !== null && typeof node === 'object') {
    const element = node as { props?: { children?: unknown } };
    if (element.props !== undefined) {
      return nodeText(element.props.children);
    }
  }
  return '';
}

function pressableByText(elements: TestElement[], text: string): TestElement | undefined {
  return elements.find((element) => element.type === 'Pressable' && nodeText(element) === text);
}

describe('SelectionBar', () => {
  it('shows the count in a polite live region', () => {
    const elements = collect(SelectionBar({ count: 3, onForward: () => {}, onCancel: () => {} }));
    const count = elements.find(
      (element) => element.type === 'Text' && nodeText(element) === '3 selected',
    );
    expect(count).toBeDefined();
    expect(count?.props.accessibilityLiveRegion).toBe('polite');
  });

  it('disables Forward while nothing is selected', () => {
    const elements = collect(SelectionBar({ count: 0, onForward: () => {}, onCancel: () => {} }));
    expect(pressableByText(elements, 'Forward')?.props.disabled).toBe(true);
  });

  it('enables Forward once a message is selected', () => {
    const elements = collect(SelectionBar({ count: 1, onForward: () => {}, onCancel: () => {} }));
    expect(pressableByText(elements, 'Forward')?.props.disabled).toBe(false);
  });

  it('calls onCancel from Cancel', () => {
    const onCancel = vi.fn();
    const elements = collect(SelectionBar({ count: 2, onForward: () => {}, onCancel }));
    pressableByText(elements, 'Cancel')?.props.onPress?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onForward from Forward', () => {
    const onForward = vi.fn();
    const elements = collect(SelectionBar({ count: 2, onForward, onCancel: () => {} }));
    pressableByText(elements, 'Forward')?.props.onPress?.();
    expect(onForward).toHaveBeenCalledTimes(1);
  });
});
