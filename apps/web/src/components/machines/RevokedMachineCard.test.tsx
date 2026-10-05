import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Machine } from '@/lib/api';
import { RevokedMachineCard } from './RevokedMachineCard';

const machine: Machine = {
  id: 'm-1',
  name: 'build-laptop',
  status: 'revoked',
  os: 'macOS',
  osVersion: '15',
  arch: 'arm64',
  cpu: 'Apple M3',
  cores: 8,
  ramGb: 16,
  diskFreeGb: 200,
  drivers: [],
  fingerprint: 'AA:BB:CC',
  createdAt: '2026-10-01T10:00:00.000Z',
  approvedAt: '2026-10-01T11:00:00.000Z',
  lastSeenAt: null,
};

describe('RevokedMachineCard', () => {
  it('shows the machine name once, with the hardware on its own line', () => {
    const { container } = render(
      <RevokedMachineCard
        machine={machine}
        deleting={false}
        confirmingDelete={false}
        actionError=""
        onAskDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/build-laptop/)).toHaveLength(1);
    expect(container.textContent).toContain('macOS');
  });
});
