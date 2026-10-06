import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './checkbox';

function Row({
  initial = false,
  disabled = false,
  label,
  onCheckedChange,
}: {
  initial?: boolean;
  disabled?: boolean;
  label?: string;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(initial);
  return (
    <label>
      <Checkbox
        checked={checked}
        onCheckedChange={(next) => {
          setChecked(next);
          onCheckedChange?.(next);
        }}
        disabled={disabled}
        label={label}
      />
      Row text
    </label>
  );
}

describe('Checkbox', () => {
  it('calls onCheckedChange(true) when the row label is clicked', () => {
    const onCheckedChange = vi.fn();
    render(<Row onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByText('Row text'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('does not call onCheckedChange when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Row disabled onCheckedChange={onCheckedChange} />);
    fireEvent.click(screen.getByText('Row text'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('uses label as the accessible name', () => {
    render(<Row label="Email me updates" />);
    expect(screen.getByRole('checkbox', { name: 'Email me updates' })).toBeTruthy();
  });

  it('shows the Check icon only when checked', () => {
    const { unmount } = render(<Row />);
    expect(document.querySelector('svg')).toBeNull();
    unmount();
    render(<Row initial />);
    expect(document.querySelector('svg')).not.toBeNull();
  });
});
