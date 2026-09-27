import type { ApprovalRequest } from '@galena/protocol';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  return (
    <div className="min-w-[260px] rounded-xl border border-divider bg-background/50 p-2.5">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="text-[14px] font-semibold break-words">{request.action}</span>
      </div>
      <p className="mt-1 text-[13px] leading-5">{request.summary}</p>
      {request.details !== undefined && (
        <p className="mt-1 text-[12px] leading-4 text-muted-foreground">{request.details}</p>
      )}
      {request.worst_case_cost !== undefined && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Worst case: {formatMoney(request.worst_case_cost)}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="rounded-full px-3"
          onClick={() => console.log('approve', request.id)}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="rounded-full px-3"
          onClick={() => console.log('deny', request.id)}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}
