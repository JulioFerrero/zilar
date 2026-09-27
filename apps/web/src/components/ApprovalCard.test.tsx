import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApprovalRequestSchema } from '@galena/protocol';
import { ApprovalCard } from './ApprovalCard';

const request = ApprovalRequestSchema.parse({
  id: 'apr-42',
  room: 'dev-team@rooms.galena.test',
  ai: 'dev-1@ai.galena.test',
  action: 'merge_pull_request',
  summary: 'Merge PR #42 — fix the checkout button on mobile Safari',
  details: 'Squash-merges the branch into main.',
  args_hash: 'a'.repeat(64),
  worst_case_cost: { currency: 'EUR', amount: 0.4 },
  requested_by: 'dev-1@ai.galena.test',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});

describe('ApprovalCard', () => {
  it('renders Approve and Deny buttons', () => {
    render(<ApprovalCard request={request} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(screen.getByText('Worst case: €0.40')).toBeTruthy();
  });

  it('logs the decision to the console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    render(<ApprovalCard request={request} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(spy).toHaveBeenCalledWith('approve', 'apr-42');

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(spy).toHaveBeenCalledWith('deny', 'apr-42');

    spy.mockRestore();
  });
});
