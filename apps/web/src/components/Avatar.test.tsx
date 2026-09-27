import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from './Avatar';

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
});
