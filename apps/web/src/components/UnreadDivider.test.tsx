import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('unread divider', () => {
  it("shows the divider and scrolls it into view when Ana's chat opens", () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

    renderApp('/c/c-ana');

    const list = screen.getByTestId('message-list');
    expect(within(list).getByText('Unread messages')).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });
});
