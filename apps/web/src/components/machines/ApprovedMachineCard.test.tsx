import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Machine } from '@/lib/api';
import { ApprovedMachineCard } from './ApprovedMachineCard';

const machine: Machine = {
  id: 'm-approved',
  name: 'julio-mbp',
  status: 'approved',
  os: 'macOS',
  osVersion: '27.0',
  arch: 'arm64',
  cpu: 'Apple M3 Pro',
  cores: 11,
  ramGb: 18,
  diskFreeGb: 200,
  drivers: ['docker'],
  fingerprint: 'b2c3d4e5f607182a',
  createdAt: '2026-09-25T10:00:00.000Z',
  approvedAt: '2026-09-25T10:01:00.000Z',
  lastSeenAt: null,
  online: true,
};

function renderCard(overrides: Partial<Parameters<typeof ApprovedMachineCard>[0]> = {}) {
  const props = {
    machine,
    renaming: false,
    revoking: false,
    confirmingRevoke: false,
    actionError: '',
    aiNames: ['Ada'],
    onRename: vi.fn(),
    onAskRevoke: vi.fn(),
    onCancelRevoke: vi.fn(),
    onConfirmRevoke: vi.fn(),
    ...overrides,
  };
  render(<ApprovedMachineCard {...props} />);
  return props;
}

describe('ApprovedMachineCard', () => {
  it('shows the name, online status, hardware, drivers, AIs and fingerprint', () => {
    renderCard();

    expect(screen.getByText('julio-mbp')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    expect(
      screen.getByText('macOS · 27.0 · arm64 · Apple M3 Pro · 11 cores · 18 GB RAM'),
    ).toBeTruthy();
    expect(screen.getByText('docker')).toBeTruthy();
    expect(screen.getByText('AIs: Ada')).toBeTruthy();
    expect(screen.getByText('b2c3d4e5f607182a')).toBeTruthy();
  });

  it('hides the AIs line when the AI list could not be loaded', () => {
    renderCard({ aiNames: null });

    expect(screen.queryByText(/^AIs:/)).toBeNull();
    expect(screen.queryByText('No AIs yet')).toBeNull();
  });

  it('renames on Enter with the trimmed name and closes the field', () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Rename julio-mbp' }));
    const input = screen.getByLabelText('Rename julio-mbp') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  julio-lab  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onRename).toHaveBeenCalledWith('julio-lab');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('cancels the rename on Escape without calling onRename', () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Rename julio-mbp' }));
    const input = screen.getByLabelText('Rename julio-mbp') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'oops' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('asks before revoking: the first Revoke button only calls onAskRevoke', () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke julio-mbp' }));

    expect(props.onAskRevoke).toHaveBeenCalledTimes(1);
    expect(props.onConfirmRevoke).not.toHaveBeenCalled();
  });

  it('shows the confirm panel with Revoke and Cancel while confirming', () => {
    const props = renderCard({ confirmingRevoke: true });

    expect(screen.getByText(/Revoke julio-mbp\? It will disconnect/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(props.onConfirmRevoke).toHaveBeenCalledTimes(1);
    expect(props.onCancelRevoke).toHaveBeenCalledTimes(1);
  });
});
