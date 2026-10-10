import { Button, FieldError } from '@/components/ais/AiPageShell';
import { TextArea } from '@/components/ui/text-input';
import { truncateOutput } from '@/lib/routines';
import type { ToolRun, ToolRunResult } from '@/lib/tools';
import { TruncatedText } from './CodeBlock';
import { runStatusText } from './toolDetailOps';

/** Run now with an optional JSON input, the last result, and the recent runs. */
export function ToolRunSection({
  canManage,
  runInput,
  onRunInputChange,
  inputError,
  running,
  runError,
  runResult,
  runs,
  onStartRun,
}: {
  canManage: boolean;
  runInput: string;
  onRunInputChange: (value: string) => void;
  inputError: string | undefined;
  running: boolean;
  runError: string | undefined;
  runResult: ToolRunResult | null;
  runs: ToolRun[];
  onStartRun: () => void;
}) {
  return (
    <>
      {canManage && (
        <section aria-label="Run now" className="flex flex-col gap-2">
          <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Run now</h4>
          <label className="flex flex-col gap-1 px-2">
            <span className="text-[13px] text-muted-foreground">
              Optional JSON input (max 4 KB)
            </span>
            <TextArea
              aria-label="Run input (JSON)"
              rows={3}
              value={runInput}
              onChange={(event) => onRunInputChange(event.target.value)}
              placeholder='e.g. {"city": "Madrid"}'
              className="min-h-0 font-mono text-[13px]"
            />
          </label>
          {inputError !== undefined && <FieldError>{inputError}</FieldError>}
          <div className="px-2">
            <Button
              type="button"
              size="lg"
              className="rounded-full px-4"
              disabled={running}
              onClick={onStartRun}
            >
              {running ? 'Running…' : 'Run now'}
            </Button>
          </div>
          {runError !== undefined && <FieldError>{runError}</FieldError>}
          {runResult !== null && <RunResultBlock result={runResult} />}
        </section>
      )}

      <section aria-label="Recent runs" className="flex flex-col gap-1">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Recent runs</h4>
        {runs.length === 0 && (
          <p className="px-2 text-[13px] text-muted-foreground">No runs yet.</p>
        )}
        {runs.map((run) => (
          <div key={run.id} className="flex flex-col gap-1 rounded-xl px-2 py-1.5">
            <p className="text-[13px]">{runStatusText(run)}</p>
            {run.status === 'error' && (
              <p className="text-[13px] text-muted-foreground">
                Failed: {run.errorKind ?? 'failed'}
              </p>
            )}
            {run.status === 'ok' && run.outputText !== null && <RunOutput text={run.outputText} />}
          </div>
        ))}
      </section>
    </>
  );
}

function RunResultBlock({ result }: { result: ToolRunResult }) {
  if (!result.ok) {
    const text =
      result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`;
    return (
      <div className="flex flex-col gap-1 px-2">
        <p className="text-[13px] text-danger">Failed: {result.error.kind}</p>
        <RunOutput text={text} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 px-2">
      <p className="text-[13px] text-muted-foreground">
        Ok in {result.durationMs} ms · {result.fetchCount}{' '}
        {result.fetchCount === 1 ? 'fetch' : 'fetches'}
      </p>
      <RunOutput text={result.output.text} />
    </div>
  );
}

/** Output text truncated with a "Show all" toggle, shared by the last result and a run. */
function RunOutput({ text }: { text: string }) {
  const cut = truncateOutput(text);
  return <TruncatedText text={text} preview={cut.preview} truncated={cut.truncated} />;
}
