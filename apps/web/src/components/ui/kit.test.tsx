import { fireEvent, render, screen, within } from '@testing-library/react';
import { Shield } from 'lucide-react';
import { useState, useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from './badge';
import { Button } from './button';
import { Card, SectionLabel } from './card';
import { Dialog } from './dialog';
import { Sheet } from './sheet';
import { ListRow } from './list-row';
import { SegmentedControl } from './segmented-control';
import { StateMessage } from './state-message';
import { Switch } from './switch';
import { TextArea, TextInput } from './text-input';

describe('Badge', () => {
  it('renders nothing at zero', () => {
    const { container } = render(<Badge count={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('caps above max', () => {
    render(<Badge count={120} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('respects a custom max', () => {
    render(<Badge count={120} max={9} />);
    expect(screen.getByText('9+')).toBeTruthy();
  });

  it('renders the exact count below max', () => {
    render(<Badge count={37} />);
    expect(screen.getByText('37')).toBeTruthy();
  });

  it('applies the label as aria-label', () => {
    render(<Badge count={2} label="2 unread" />);
    expect(screen.getByLabelText('2 unread').textContent).toBe('2');
  });

  it('merges a caller className', () => {
    render(<Badge count={2} className="ml-auto shrink-0" />);
    const badge = screen.getByText('2');
    expect(badge.className).toContain('ml-auto');
    expect(badge.className).toContain('shrink-0');
    expect(badge.className).toContain('rounded-full');
  });
});

describe('Switch', () => {
  it('toggles on click and reports aria-checked', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={onCheckedChange} label="Sounds" />,
    );
    const control = screen.getByRole('switch', { name: 'Sounds' });
    expect(control.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    rerender(<Switch checked onCheckedChange={onCheckedChange} label="Sounds" />);
    expect(screen.getByRole('switch', { name: 'Sounds' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('does not toggle when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Sounds" disabled />);
    const control = screen.getByRole('switch', { name: 'Sounds' });
    expect(control.hasAttribute('disabled')).toBe(true);
    fireEvent.click(control);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('hides the visible label but keeps the accessible name', () => {
    render(<Switch checked={false} onCheckedChange={() => {}} label="Sounds" hideLabel />);
    expect(screen.getByRole('switch', { name: 'Sounds' })).toBeTruthy();
    expect(screen.queryByText('Sounds')).toBeNull();
  });
});

describe('TextInput and TextArea', () => {
  it('links the label with htmlFor and id', () => {
    render(<TextInput label="Group name" />);
    const input = screen.getByLabelText('Group name');
    expect(input.getAttribute('id')).toBeTruthy();
  });

  it('marks invalid fields and shows the hint in danger', () => {
    render(<TextInput label="Group name" invalid hint="A name is required." />);
    expect(screen.getByLabelText('Group name').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('A name is required.').className).toContain('text-danger');
  });

  it('shows a counter for the text area', () => {
    render(<TextArea label="Bio" counter={{ max: 200 }} defaultValue="Hello" />);
    expect(screen.getByText('5/200')).toBeTruthy();
  });

  it('updates the counter when typing into an uncontrolled input', () => {
    render(<TextInput label="Group name" counter={{ max: 64 }} defaultValue="Weekend" />);
    expect(screen.getByText('7/64')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: 'Weekend trip' },
    });
    expect(screen.getByText('12/64')).toBeTruthy();
  });

  it('shows the counter in danger when over the max without capping input', () => {
    render(<TextInput label="Group name" counter={{ max: 5 }} defaultValue="Weekend trip" />);
    const counter = screen.getByText('12/5');
    expect(counter.className).toContain('text-danger');
    expect(screen.getByLabelText('Group name').hasAttribute('maxlength')).toBe(false);
  });

  it('merges a caller className with the base field styles', () => {
    render(<TextInput label="Group name" className="max-w-xs" />);
    const input = screen.getByLabelText('Group name');
    expect(input.className).toContain('max-w-xs');
    expect(input.className).toContain('well-surface');
    render(<TextArea label="Bio" className="max-w-xs" />);
    const area = screen.getByLabelText('Bio');
    expect(area.className).toContain('max-w-xs');
    expect(area.className).toContain('well-surface');
  });

  it('renders a bare field with no wrapper when there is no label, hint or counter', () => {
    const { container } = render(<TextInput aria-label="Search" />);
    const input = screen.getByLabelText('Search');
    expect(input.parentElement).toBe(container);
    expect(container.querySelector('div.flex-col')).toBeNull();
  });

  it('keeps the wrapper and the label for a labelled field', () => {
    render(<TextInput label="Group name" />);
    const input = screen.getByLabelText('Group name');
    expect(screen.getByText('Group name').tagName).toBe('LABEL');
    expect(input.parentElement?.className).toContain('flex-col');
  });
});

describe('Dialog', () => {
  it('labels the dialog with its title and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog
        open
        onClose={onClose}
        title="Edit group"
        description="Change the look."
        actions={<Button>Save</Button>}
      >
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit group' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Change the look.')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes only the topmost dialog on Escape when two are open', () => {
    const backgroundClose = vi.fn();
    const topClose = vi.fn();
    render(
      <>
        <Dialog open onClose={backgroundClose} title="Background dialog" />
        <Dialog open onClose={topClose} title="Top dialog" />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(topClose).toHaveBeenCalledTimes(1);
    expect(backgroundClose).not.toHaveBeenCalled();
  });

  it('stops Escape before window listeners while a dialog is open', () => {
    const onClose = vi.fn();
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      const { unmount } = render(<Dialog open onClose={onClose} title="Edit group" />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(windowSpy).not.toHaveBeenCalled();

      unmount();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(windowSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
  });

  it('keeps an undismissable dialog open and still stops Escape before window listeners', () => {
    const onClose = vi.fn();
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      render(<Dialog open onClose={onClose} title="Importing" dismissable={false} />);
      const dialog = screen.getByRole('dialog', { name: 'Importing' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(dialog).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      expect(windowSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
  });

  it('uses ariaLabel as the accessible name when it differs from the title', () => {
    render(<Dialog open onClose={() => {}} title="Add members" ariaLabel="New group" />);
    expect(screen.getByRole('dialog', { name: 'New group' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Add members' })).toBeNull();
  });

  it('stays open on Escape and a backdrop click when not dismissable', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Importing" dismissable={false} />);
    const dialog = screen.getByRole('dialog', { name: 'Importing' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('caps the panel height and scrolls the body between fixed title and actions', () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="Long dialog"
        description="Scroll me."
        actions={<Button>Save</Button>}
      >
        <p>Body</p>
      </Dialog>,
    );
    const panel = screen.getByRole('dialog', { name: 'Long dialog' });
    expect(panel.className).toContain('max-h-[85vh]');
    expect(panel.className).toContain('flex-col');
    const body = panel.querySelector('.overflow-y-auto');
    expect(body?.className).toContain('flex-1');
    expect(body?.textContent).toContain('Body');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<Dialog open={false} onClose={() => {}} title="Hidden" />);
    expect(container.innerHTML).toBe('');
  });

  it('applies the panel width for each size', () => {
    const { unmount } = render(<Dialog open onClose={() => {}} title="Small" size="sm" />);
    expect(screen.getByRole('dialog', { name: 'Small' }).className).toContain('max-w-sm');
    unmount();
    render(<Dialog open onClose={() => {}} title="Large" size="lg" />);
    expect(screen.getByRole('dialog', { name: 'Large' }).className).toContain('max-w-lg');
  });

  it('focuses the first focusable element on open and wraps Tab at both ends', () => {
    render(
      <Dialog
        open
        onClose={() => {}}
        title="Edit group"
        actions={
          <>
            <Button>Cancel</Button>
            <Button>Save</Button>
          </>
        }
      >
        <p>Body</p>
      </Dialog>,
    );
    const first = screen.getByRole('button', { name: 'Cancel' });
    const last = screen.getByRole('button', { name: 'Save' });
    expect(document.activeElement).toBe(first);
    const dialog = screen.getByRole('dialog', { name: 'Edit group' });
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('focuses initialFocusRef instead of the first focusable child', () => {
    function Harness() {
      const cancelRef = useRef<HTMLButtonElement>(null);
      return (
        <Dialog
          open
          onClose={() => {}}
          title="Delete message?"
          size="sm"
          initialFocusRef={cancelRef}
          actions={
            <>
              <button type="button" ref={cancelRef}>
                Cancel
              </button>
              <button type="button">Delete</button>
            </>
          }
        />
      );
    }
    render(<Harness />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('returns focus to the opener on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} title="Edit group">
            <p>Body</p>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Edit group' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Edit group' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Edit group' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('Sheet', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} ariaLabel="Pinned messages">
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Pinned messages' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes only the topmost overlay when a dialog sits on a sheet', () => {
    const sheetClose = vi.fn();
    const dialogClose = vi.fn();
    render(
      <>
        <Sheet open onClose={sheetClose} ariaLabel="Pinned messages">
          <p>Sheet body</p>
        </Sheet>
        <Dialog open onClose={dialogClose} title="Confirm" />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialogClose).toHaveBeenCalledTimes(1);
    expect(sheetClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click and keeps focus inside on Tab', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} ariaLabel="Pinned messages">
        <button type="button">First</button>
        <button type="button">Last</button>
      </Sheet>,
    );
    const panel = screen.getByRole('dialog', { name: 'Pinned messages' });
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(document.activeElement).toBe(first);
    last.focus();
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.click(panel.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open on Escape and a backdrop click when not dismissable', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} ariaLabel="Uploading" dismissable={false}>
        <p>Body</p>
      </Sheet>,
    );
    const panel = screen.getByRole('dialog', { name: 'Uploading' });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(panel.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns focus to the opener on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open sheet
          </button>
          <Sheet open={open} onClose={() => setOpen(false)} ariaLabel="Pinned messages">
            <p>Body</p>
          </Sheet>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Pinned messages' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Pinned messages' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <Sheet open={false} onClose={() => {}} ariaLabel="Hidden">
        <p>Body</p>
      </Sheet>,
    );
    expect(container.innerHTML).toBe('');
  });
});

const FOLDER_OPTIONS = [
  { value: 'all', label: 'All chats', count: 3 },
  { value: 'people', label: 'People' },
  { value: 'ais', label: 'AIs', count: 1 },
];

describe('SegmentedControl', () => {
  it('marks the active tab with aria-selected', () => {
    render(
      <SegmentedControl
        options={FOLDER_OPTIONS}
        value="people"
        onChange={() => {}}
        ariaLabel="Folders"
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Folders' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /All chats/ }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.getByRole('tab', { name: /People/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('selects a tab on click', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={FOLDER_OPTIONS}
        value="all"
        onChange={onChange}
        ariaLabel="Folders"
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /AIs/ }));
    expect(onChange).toHaveBeenCalledWith('ais');
  });

  it('moves and selects with the arrow keys, Home and End', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={FOLDER_OPTIONS}
        value="people"
        onChange={onChange}
        ariaLabel="Folders"
      />,
    );
    const people = screen.getByRole('tab', { name: /People/ });
    fireEvent.keyDown(people, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('ais');
    fireEvent.keyDown(people, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('all');
    fireEvent.keyDown(people, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('all');
    fireEvent.keyDown(people, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('ais');
  });

  it('shows counts in a Badge, muted when the tab is not active', () => {
    render(
      <SegmentedControl
        options={FOLDER_OPTIONS}
        value="all"
        onChange={() => {}}
        ariaLabel="Folders"
      />,
    );
    const active = screen.getByRole('tab', { name: /All chats/ });
    expect(within(active).getByText('3').className).toContain('key-primary');
    const inactive = screen.getByRole('tab', { name: /AIs/ });
    expect(within(inactive).getByText('1').className).toContain('bg-badge-muted');
  });
});

describe('ListRow', () => {
  it('renders title, subtitle and chevron in a plain div without an action', () => {
    const { container } = render(<ListRow title="About" subtitle="Version 0.1.0" chevron />);
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('Version 0.1.0')).toBeTruthy();
    const row = container.firstElementChild as HTMLElement;
    expect(row.tagName).toBe('DIV');
    expect(row.querySelector('svg')).toBeTruthy();
  });

  it('renders a button and reports clicks', () => {
    const onClick = vi.fn();
    render(<ListRow title="Notifications" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a router link when href is given', () => {
    render(
      <MemoryRouter>
        <ListRow title="Privacy" href="/settings/privacy" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Privacy/ }).getAttribute('href')).toBe(
      '/settings/privacy',
    );
  });

  it('turns the title red when danger', () => {
    render(<ListRow title="Log out" onClick={() => {}} danger />);
    expect(screen.getByText('Log out').className).toContain('text-danger');
  });

  it('puts the icon in a 32 px key tile', () => {
    const { container } = render(<ListRow title="Privacy" icon={<Shield aria-hidden="true" />} />);
    expect(container.querySelector('.key-icon')?.className).toContain('size-8');
  });
});

describe('Card and SectionLabel', () => {
  it('separates direct rows with hairline dividers', () => {
    const { container } = render(
      <Card>
        <ListRow title="One" />
        <ListRow title="Two" />
      </Card>,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('divide-y');
    expect(card.className).toContain('divide-border');
    expect(card.className).toContain('rounded-xl');
    expect(card.className).toContain('border-border');
    expect(card.className).toContain('bg-surface');
  });

  it('merges a caller className', () => {
    const { container } = render(<Card className="max-w-sm">x</Card>);
    expect((container.firstElementChild as HTMLElement).className).toContain('max-w-sm');
  });

  it('renders an uppercase muted section label', () => {
    render(<SectionLabel>Account</SectionLabel>);
    const label = screen.getByText('Account');
    expect(label.className).toContain('uppercase');
    expect(label.className).toContain('tracking-[0.06em]');
    expect(label.className).toContain('text-muted-foreground');
  });
});

describe('StateMessage', () => {
  it('shows a title, hint and action for empty', () => {
    const onClick = vi.fn();
    render(
      <StateMessage
        kind="empty"
        title="No chats yet"
        hint="Start one."
        action={{ label: 'New chat', onClick }}
      />,
    );
    expect(screen.getByText('No chats yet')).toBeTruthy();
    expect(screen.getByText('Start one.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('announces loading with role status', () => {
    render(<StateMessage kind="loading" title="Loading chats" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('announces errors with role alert', () => {
    render(<StateMessage kind="error" title="Something went wrong." />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
