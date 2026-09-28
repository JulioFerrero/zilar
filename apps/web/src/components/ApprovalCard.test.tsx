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
  it('renders the Approve and Deny buttons as disabled coming-soon affordances', () => {
    render(<ApprovalCard request={request} />);
    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    const deny = screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement;

    expect(approve.disabled).toBe(true);
    expect(deny.disabled).toBe(true);
    expect(approve.getAttribute('title')).toBe('Approvals are coming soon');
    expect(deny.getAttribute('title')).toBe('Approvals are coming soon');
    expect(screen.getByText('Worst case: €0.40')).toBeTruthy();
  });

  it('keeps the console stub on the decision buttons', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    render(<ApprovalCard request={request} />);

    // `disabled` blocks a real click, but the stub must not fire either: the
    // buttons are a coming-soon affordance, not a decision.
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
