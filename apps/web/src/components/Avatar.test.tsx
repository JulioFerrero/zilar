import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar, avatarShade } from './Avatar';

describe('Avatar', () => {
  it('shows the initials when the name has letters', () => {
    const { getByText } = render(<Avatar id="c-ana" name="Ana" />);
    expect(getByText('A')).toBeTruthy();
  });

  it('shows a neutral glyph when the name has no letters or digits', () => {
    const { container } = render(<Avatar id="c-party" name="🍻🍻" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('uses the online colour token for the online dot', () => {
    const { getByLabelText } = render(<Avatar id="c-ana" name="Ana" online />);
    expect(getByLabelText('Online').className).toContain('bg-online');
  });

  it('gives the same id the same shade', () => {
    const first = render(<Avatar id="c-ana" name="Ana" />);
    const second = render(<Avatar id="c-ana" name="Ana" />);
    const firstCircle = first.container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    const secondCircle = second.container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(firstCircle.style.backgroundColor).toBe(secondCircle.style.backgroundColor);
  });

  it('gives AIs the light avatar', () => {
    const { container } = render(<Avatar id="ai-nova" name="Nova" ai />);
    const circle = container.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(circle.style.backgroundColor).toBe('rgb(237, 237, 237)');
  });

  it('gives people a monochrome shade', () => {
    const shade = avatarShade('c-ana');
    expect(['#262626', '#1a1a1a']).toContain(shade.background);
    expect(shade.color).toBe('#ededed');
  });
});
