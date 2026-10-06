import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control';

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'groups', label: 'Groups' },
  { value: 'channels', label: 'Channels' },
];

describe('SegmentedControl radio mode', () => {
  it('exposes radiogroup and radio roles with aria-checked', () => {
    render(
      <SegmentedControl
        mode="radio"
        ariaLabel="Kind filter"
        options={OPTIONS}
        value="groups"
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Kind filter' })).toBeTruthy();
    const groups = screen.getByRole('radio', { name: 'Groups' });
    const all = screen.getByRole('radio', { name: 'All' });
    expect(groups.getAttribute('aria-checked')).toBe('true');
    expect(all.getAttribute('aria-checked')).toBe('false');
  });

  it('ArrowRight selects the next option', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        mode="radio"
        ariaLabel="Kind filter"
        options={OPTIONS}
        value="all"
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole('radio', { name: 'All' }), {
      key: 'ArrowRight',
    });
    expect(onChange).toHaveBeenCalledWith('groups');
  });

  it('clicking the active option does not call onChange, clicking another does', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        mode="radio"
        ariaLabel="Kind filter"
        options={OPTIONS}
        value="all"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Groups' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('groups');
  });

  it('Home on the first option does not call onChange', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        mode="radio"
        ariaLabel="Kind filter"
        options={OPTIONS}
        value="all"
        onChange={onChange}
      />,
    );

    fireEvent.keyDown(screen.getByRole('radio', { name: 'All' }), {
      key: 'Home',
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('tabs mode still exposes tab roles', () => {
    render(
      <SegmentedControl
        ariaLabel="Kind filter"
        options={OPTIONS}
        value="all"
        onChange={() => {}}
      />,
    );

    const all = screen.getByRole('tab', { name: 'All' });
    expect(all.getAttribute('aria-selected')).toBe('true');
  });
});
