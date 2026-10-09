// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChatListSkeleton,
  MessageListSkeleton,
  SKELETON_DELAY_MS,
  useDelayedVisible,
} from './skeleton';

vi.mock('react-native', async () => {
  const { createElement: create } = await import('react');
  class AnimatedValue {
    setValue(): void {}
  }
  const animation = { start: () => {}, stop: () => {} };
  return {
    Animated: {
      Value: AnimatedValue,
      View: ({ children, className }: { children?: ReactNode; className?: string }) =>
        create('div', { className }, children),
      loop: () => animation,
      sequence: () => [],
      timing: () => animation,
    },
    View: ({
      children,
      className,
      accessibilityLabel,
    }: {
      children?: ReactNode;
      className?: string;
      accessibilityLabel?: string;
    }) => create('div', { className, 'aria-label': accessibilityLabel }, children),
  };
});

vi.mock('react-native-reanimated', () => ({
  useReducedMotion: () => false,
}));

const nodeRequire = createRequire(import.meta.url);
const { createRoot } = nodeRequire('react-dom/client') as {
  createRoot: (container: Element) => { render(node: ReactNode): void; unmount(): void };
};

let container: HTMLDivElement;
let unmount: (() => void) | undefined;

function mount(element: ReactElement): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  unmount = () => {
    act(() => root.unmount());
    container.remove();
  };
}

function wait(ms: number): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function Probe({ delayMs }: { delayMs?: number }) {
  const visible = useDelayedVisible(delayMs);
  return createElement('p', null, visible ? 'shown' : 'hidden');
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe('skeleton delay', () => {
  it('waits 250 ms before a placeholder shows', () => {
    expect(SKELETON_DELAY_MS).toBe(250);
  });

  it('hides the probe until the delay has passed, then shows it', async () => {
    mount(createElement(Probe, { delayMs: 40 }));
    expect(container.textContent).toBe('hidden');

    await wait(80);
    expect(container.textContent).toBe('shown');
  });

  it('unmounts before the delay without a late update', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mount(createElement(Probe, { delayMs: 30 }));
      unmount?.();
      unmount = undefined;
      await wait(60);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('ChatListSkeleton', () => {
  it('shows six chat rows only after the delay', async () => {
    mount(createElement(ChatListSkeleton));
    expect(container.querySelectorAll('[class*="h-[76px]"]')).toHaveLength(0);

    await wait(SKELETON_DELAY_MS + 50);
    expect(container.querySelectorAll('[class*="h-[76px]"]')).toHaveLength(6);
    expect(container.querySelector('[aria-label="Loading chats"]')).not.toBeNull();
  });

  it('keeps the row count when asked for fewer rows', async () => {
    mount(createElement(ChatListSkeleton, { rows: 2 }));
    await wait(SKELETON_DELAY_MS + 50);
    expect(container.querySelectorAll('[class*="h-[76px]"]')).toHaveLength(2);
  });
});

describe('MessageListSkeleton', () => {
  it('shows five bubbles after the delay, alternating sides', async () => {
    mount(createElement(MessageListSkeleton));
    expect(container.querySelectorAll('[class*="rounded-[14px]"]')).toHaveLength(0);

    await wait(SKELETON_DELAY_MS + 50);
    const bubbles = [...container.querySelectorAll('[class*="rounded-[14px]"]')];
    expect(bubbles).toHaveLength(5);
    expect(bubbles.filter((bubble) => bubble.className.includes('self-end'))).toHaveLength(2);
    expect(container.querySelector('[aria-label="Loading messages"]')).not.toBeNull();
  });
});
