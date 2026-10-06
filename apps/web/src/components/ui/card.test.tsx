import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionLabel } from './card';

describe('SectionLabel', () => {
  it('renders an h2 by default', () => {
    render(<SectionLabel>Incoming</SectionLabel>);
    expect(screen.getByRole('heading', { name: 'Incoming' }).tagName).toBe('H2');
  });

  it('renders the chosen heading level', () => {
    render(<SectionLabel as="h3">Devices</SectionLabel>);
    expect(screen.getByRole('heading', { level: 3, name: 'Devices' }).tagName).toBe('H3');
  });
});
