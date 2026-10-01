import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SETTINGS_COLUMN, SettingsShell } from './SettingsShell';

function renderShell() {
  // Mirrors how the settings pages use the shell: the page wraps its body in
  // the shared column, the shell renders the header around it.
  return render(
    <MemoryRouter>
      <SettingsShell title="Example" subtitle="An example settings page." onBack={() => undefined}>
        <div className={SETTINGS_COLUMN}>
          <p>Body</p>
        </div>
      </SettingsShell>
    </MemoryRouter>,
  );
}

describe('SettingsShell', () => {
  it('renders the shared column with the title and description', () => {
    const { container } = renderShell();

    expect(screen.getByRole('heading', { name: 'Example' })).toBeTruthy();
    expect(screen.getByText('An example settings page.')).toBeTruthy();
    const column = container.querySelector('.mx-auto.max-w-2xl');
    expect(column).not.toBeNull();
    expect(column?.className).toContain('w-full');
  });

  it('exposes the shared column constant used by every settings page', () => {
    expect(SETTINGS_COLUMN).toContain('mx-auto');
    expect(SETTINGS_COLUMN).toContain('max-w-2xl');
    expect(SETTINGS_COLUMN).toContain('w-full');
  });
});
