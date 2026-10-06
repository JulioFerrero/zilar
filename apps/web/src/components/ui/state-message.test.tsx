import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StateMessage } from './state-message';

describe('StateMessage inline size', () => {
  it('announces inline loading with role status and keeps no py-10', () => {
    const { container } = render(<StateMessage kind="loading" size="inline" title="Loading…" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Loading…')).toBeTruthy();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain('py-10');
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('items-center');
  });
});
