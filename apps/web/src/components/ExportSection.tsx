import { Data, Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Download } from 'lucide-react';
import { fetchExport } from '@/lib/api';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { Button } from '@/components/ui/button';

const FALLBACK_FILENAME = 'zilar-export.json';

// Fixed sentences for a stale session, the hourly cap and the 200 000-message cap.
type ExportReason = 'reauth' | 'rate' | 'too_large' | 'failed';

const EXPORT_MESSAGES: Record<ExportReason, string> = {
  reauth:
    'For your safety, sign in again to export. Exports need a sign-in from the last 30 minutes.',
  rate: 'You can export once an hour. Try again later.',
  too_large: 'Your history is too large to export here. Contact the operator.',
  failed: 'Could not export. Try again.',
};

class ExportFailure extends Data.TaggedError('ExportFailure')<{
  readonly reason: ExportReason;
}> {}

function reasonForStatus(status: number): ExportReason {
  switch (status) {
    case 403:
      return 'reauth';
    case 429:
      return 'rate';
    case 413:
      return 'too_large';
    default:
      return 'failed';
  }
}

// The filename is stripped of any path, so the saved file never leaves the download folder.
function filenameFrom(header: string | null): string {
  const match = header === null ? null : /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  const name = match?.[1]?.trim().split(/[\\/]/).pop();
  return name === undefined || name === '' ? FALLBACK_FILENAME : name;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const exportEffect = (): Effect.Effect<void, ExportFailure> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetchExport(),
      catch: () => new ExportFailure({ reason: 'failed' }),
    });
    if (!response.ok) {
      return yield* Effect.fail(new ExportFailure({ reason: reasonForStatus(response.status) }));
    }
    const blob = yield* Effect.tryPromise({
      try: () => response.blob(),
      catch: () => new ExportFailure({ reason: 'failed' }),
    });
    yield* Effect.sync(() => {
      saveBlob(blob, filenameFrom(response.headers.get('Content-Disposition')));
    });
  });

export function ExportSection() {
  const [state, runExport] = useAction<void, void, ExportFailure>(exportEffect);
  const busy = isWaiting(state);
  const failure = busy ? undefined : failureOf(state);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[16px] font-semibold">Export your data</h2>
      <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
        <p className="text-[14px] text-muted-foreground">
          Download your profile, contacts and messages as a JSON file.
        </p>
        <div className="mt-2">
          <Button type="button" onClick={() => runExport()} disabled={busy}>
            <Download />
            {busy ? 'Preparing…' : 'Export my messages'}
          </Button>
        </div>
        {AsyncResult.isSuccess(state) && (
          <p role="status" className="mt-1 text-[14px] text-muted-foreground">
            Export downloaded.
          </p>
        )}
        {failure !== undefined && (
          <p role="alert" className="mt-1 text-[14px] text-danger">
            {EXPORT_MESSAGES[failure.reason]}
          </p>
        )}
      </div>
    </div>
  );
}
