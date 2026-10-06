import { fireEvent, render, screen } from '@testing-library/react';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Menu, MenuItem } from './menu';

function Harness({
  onClose,
  withDisabled = false,
}: {
  onClose?: () => void;
  withDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = onClose ?? (() => setOpen(false));
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open menu
      </button>
      <Menu
        open={open}
        onClose={close}
        label="Sample actions"
        closeLabel="Close sample menu"
        className="top-full left-0 mt-1"
      >
        <MenuItem onSelect={() => setOpen(false)}>First</MenuItem>
        {withDisabled && (
          <MenuItem onSelect={() => {}} disabled>
            Skipped
          </MenuItem>
        )}
        <MenuItem onSelect={() => setOpen(false)}>Second</MenuItem>
        <MenuItem icon={LogOut} destructive onSelect={() => setOpen(false)}>
          Third
        </MenuItem>
      </Menu>
    </div>
  );
}

function openMenu(withDisabled = false): void {
  render(<Harness withDisabled={withDisabled} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
}

describe('Menu', () => {
  it('focuses the first item on open', () => {
    openMenu();
    expect(screen.getByRole('menu', { name: 'Sample actions' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'First' }));
  });

  it('moves focus with ArrowDown and ArrowUp, wrapping around', () => {
    openMenu();
    const first = screen.getByRole('menuitem', { name: 'First' });
    const second = screen.getByRole('menuitem', { name: 'Second' });
    const third = screen.getByRole('menuitem', { name: 'Third' });

    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(third);
  });

  it('jumps to the first and last items with Home and End', () => {
    openMenu();
    const first = screen.getByRole('menuitem', { name: 'First' });
    const third = screen.getByRole('menuitem', { name: 'Third' });

    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'Home' });
    expect(document.activeElement).toBe(first);
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Sample actions' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu', { name: 'Sample actions' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a backdrop click', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close sample menu' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('skips disabled items when moving focus', () => {
    openMenu(true);
    const first = screen.getByRole('menuitem', { name: 'First' });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Second' }));
  });

  it('marks a destructive item and renders its icon', () => {
    openMenu();
    const third = screen.getByRole('menuitem', { name: 'Third' });
    expect(third.className).toContain('text-danger');
    expect(third.querySelector('svg')).toBeTruthy();
  });

  it('merges a custom backdrop class with the default ones', () => {
    render(
      <div>
        <Menu
          open
          onClose={() => {}}
          label="Sample actions"
          closeLabel="Close sample menu"
          backdropClassName="z-20"
        >
          <MenuItem onSelect={() => {}}>First</MenuItem>
        </Menu>
      </div>,
    );
    const backdrop = screen.getByRole('button', { name: 'Close sample menu' });
    expect(backdrop.className).toContain('fixed');
    expect(backdrop.className).toContain('z-20');
  });
});
