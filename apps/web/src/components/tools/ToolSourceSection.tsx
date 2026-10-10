import type { ToolVersion } from '@/lib/tools';
import type { ApiFailure } from '@/lib/effect/errors';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { CodeBlock } from './CodeBlock';
import { failureText, hostsLine } from './toolDetailOps';

/** Read-only source of the shown version, plus the version history with revert. */
export function ToolSourceSection({
  toolName,
  currentVersion,
  versions,
  shownVersion,
  shownSource,
  shownHosts,
  sourceError,
  revertFailure,
  canManage,
  busy,
  onShowVersion,
  onRequestRevert,
}: {
  toolName: string;
  currentVersion: number;
  versions: ToolVersion[];
  shownVersion: number;
  shownSource: string;
  shownHosts: readonly string[];
  sourceError: ApiFailure | undefined;
  revertFailure: ApiFailure | undefined;
  canManage: boolean;
  busy: boolean;
  onShowVersion: (version: number) => void;
  onRequestRevert: (version: number) => void;
}) {
  return (
    <>
      <section aria-label="Source" className="flex flex-col gap-2">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">
          Source (v{shownVersion}, read-only)
        </h4>
        {sourceError !== undefined && (
          <FieldError>{failureText(sourceError, 'Could not load that version.')}</FieldError>
        )}
        <CodeBlock code={shownSource} label={`Source of ${toolName} v${shownVersion}`} />
        {shownVersion !== currentVersion && (
          <p className="px-2 text-[13px] text-muted-foreground">
            Showing v{shownVersion} ({hostsLine(shownHosts)}); revert to make it current.
          </p>
        )}
      </section>

      <section aria-label="Version history" className="flex flex-col gap-1">
        <h4 className="px-2 text-[13px] font-semibold text-muted-foreground">Version history</h4>
        {versions.length === 0 && (
          <p className="px-2 text-[13px] text-muted-foreground">No versions yet.</p>
        )}
        {versions.map((version) => (
          <div
            key={version.id}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
          >
            <button
              type="button"
              onClick={() => onShowVersion(version.version)}
              aria-label={`Show source of v${version.version}`}
              className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <p className="truncate text-[14px]">
                v{version.version} · {version.message}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {hostsLine(version.hosts)} · by {version.createdBy} ·{' '}
                {new Date(version.createdAt).toLocaleString()}
              </p>
            </button>
            {canManage && version.version !== currentVersion && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Revert to v${version.version}`}
                className="shrink-0"
                disabled={busy}
                onClick={() => onRequestRevert(version.version)}
              >
                Revert to this version
              </Button>
            )}
          </div>
        ))}
        {revertFailure !== undefined && (
          <FieldError>{failureText(revertFailure, 'Could not revert the tool.')}</FieldError>
        )}
      </section>
    </>
  );
}
