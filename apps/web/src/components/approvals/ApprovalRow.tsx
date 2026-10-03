import { ShieldAlert } from 'lucide-react';
import type { PublicApproval } from '@/lib/api';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { worstCaseText } from './formatRelative';

interface ApprovalRowProps {
  approval: PublicApproval;
  expiresIn: string;
  busy: null | 'approve' | 'deny';
  actionError: string;
  onApprove: () => void;
  onDeny: () => void;
}

/**
 * A pending approval in the inbox: action name, summary, optional details and
 * worst case, the relative expiry, and Approve / Deny. No "always allow".
 */
export function ApprovalRow({
  approval,
  expiresIn,
  busy,
  actionError,
  onApprove,
  onDeny,
}: ApprovalRowProps) {
  const disableButtons = busy !== null;
  const cost = worstCaseText(approval.worstCase);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
          <ShieldAlert className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">
            {approval.action}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-badge-muted px-2 py-0.5 text-[11px] text-foreground">
          pending
        </span>
      </div>

      <p className="text-[14px] leading-5 break-words">{approval.summary}</p>

      {approval.details !== null && (
        <p className="text-[13px] leading-5 text-muted-foreground break-words">
          {approval.details}
        </p>
      )}

      {cost !== '' && <p className="text-[13px] text-muted-foreground">{cost}</p>}

      <p className="text-[13px] text-muted-foreground">expires {expiresIn}</p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="px-3"
          disabled={disableButtons}
          onClick={onApprove}
          aria-label={`Approve ${approval.action}`}
        >
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="px-3"
          disabled={disableButtons}
          onClick={onDeny}
          aria-label={`Deny ${approval.action}`}
        >
          {busy === 'deny' ? 'Denying…' : 'Deny'}
        </Button>
      </div>

      {actionError !== '' && <FieldError>{actionError}</FieldError>}
    </div>
  );
}
