import { Check, X } from 'lucide-react';
import type { PublicApproval } from '@/lib/api';
import { FieldError } from '@/components/ais/AiPageShell';
import { Avatar } from '@/components/Avatar';
import { IconButton } from '@/components/ui/icon-button';

interface ApprovalRowProps {
  approval: PublicApproval;
  busy: null | 'approve' | 'deny';
  actionError: string;
  onApprove: () => void;
  onDeny: () => void;
}

export function ApprovalRow({ approval, busy, actionError, onApprove, onDeny }: ApprovalRowProps) {
  const disableButtons = busy !== null;
  const where =
    approval.groupName === null ? approval.aiName : `${approval.aiName} · ${approval.groupName}`;
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <Avatar seed={approval.aiName} name={approval.aiName} size={32} />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-medium">{approval.summary}</span>
          {where !== '' && (
            <span className="truncate text-[13px] text-muted-foreground">{where}</span>
          )}
        </div>
        <IconButton
          aria-label={`Deny: ${approval.summary}`}
          disabled={disableButtons}
          onClick={onDeny}
        >
          <X size={16} />
        </IconButton>
        <IconButton
          variant="primary"
          aria-label={`Approve: ${approval.summary}`}
          disabled={disableButtons}
          onClick={onApprove}
        >
          <Check size={16} />
        </IconButton>
      </div>
      {actionError !== '' && (
        <div className="px-4 pb-3.5">
          <FieldError>{actionError}</FieldError>
        </div>
      )}
    </div>
  );
}
