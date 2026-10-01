import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  SETTINGS_COLUMN,
  SettingsCard,
  SettingsEmpty,
  SettingsSection,
  SettingsShell,
} from './SettingsShell';

function renderShell() {
  // Mirrors how the settings pages use the shell: the page wraps its body in
  // the shared column, the shell renders the header around it.
  return render(
    <MemoryRouter>
      <SettingsShell title="Example" subtitle="An example settings page." onBack={() => undefined}>
        <div className={SETTINGS_COLUMN}>
          <SettingsSection label="Things" title="Things">
            <SettingsCard
              title="First thing"
              detail="A muted second line."
              actions={<button type="button">Do it</button>}
            />
            <SettingsEmpty>No things yet. Add one to get started.</SettingsEmpty>
          </SettingsSection>
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

  it('renders sections, cards and empty states with readable text', () => {
    renderShell();

    const section = screen.getByRole('region', { name: 'Things' });
    expect(section).toBeTruthy();
    expect(screen.getByText('First thing')).toBeTruthy();
    expect(screen.getByText('A muted second line.')).toBeTruthy();
    expect(screen.getByText(/No things yet/)).toBeTruthy();
  });
});
