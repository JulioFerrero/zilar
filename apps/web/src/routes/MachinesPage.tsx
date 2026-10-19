import { hardwareLine, PendingMachineCard } from '../components/machines/PendingMachineCard';
import { FieldError } from '@/components/ais/AiPageShell';
import { EntityAvatar } from '@/components/EntityAvatar';
import { AddMachineDialog, failureText } from '@/components/machines/AddMachineDialog';
import { ApprovedMachineCard } from '@/components/machines/ApprovedMachineCard';
import { SETTINGS_COLUMN, SettingsShell } from '@/components/SettingsShell';
import { SKELETON_DELAY_MS } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { StateMessage } from '@/components/ui/state-message';
import {
  listAis,
  listMachines,
  deleteMachine,
  approveMachine,
  denyMachine,
  type Machine,
  type PublicAi,
  renameMachine,
  revokeMachine,
} from '@/lib/api';
import {
  failureOf,
  isWaiting,
  shownFailure,
  useAction,
  type ActionControls,
  type ActionState,
  type UseActionOptions,
} from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { cn } from '@/lib/utils';
import { fromApi, useDelayed, type ApiFailure } from '@zilar/client-core';
import { Effect } from 'effect';
import type { HttpClient } from 'effect/http';
import { AsyncResult } from 'effect/reactivity';
import { Ban, ChevronRight, Server, Plus, X, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

interface PendingRowProps {
  machine: Machine;
  confirmingDeny: boolean;
  onConfirm: (id: string | null) => void;
  onUpdate: (id: string, next: Machine) => void;
  onRemove: (id: string) => void;
}

function PendingRow({ machine, confirmingDeny, onConfirm, onUpdate, onRemove }: PendingRowProps) {
  const [approveState, approve, , approveError] = useMachineAction(
    (id: string) =>
      fromApi(() => approveMachine(id)).pipe(
        Effect.tap((updated) => Effect.sync(() => onUpdate(id, updated))),
      ),
    'Could not approve the machine.',
  );
  const [denyState, deny, denyControls, denyError] = useMachineAction(
    (id: string) =>
      fromApi(() => denyMachine(id)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            onRemove(id);
            onConfirm(null);
          }),
        ),
      ),
    'Could not deny the machine.',
  );

  const actionError = denyError ?? approveError ?? '';

  return (
    <PendingMachineCard
      machine={machine}
      approving={isWaiting(approveState)}
      denying={isWaiting(denyState)}
      confirmingDeny={confirmingDeny}
      actionError={actionError}
      onApprove={() => approve(machine.id)}
      onAskDeny={() => {
        clearFailure(denyState, denyControls);
        onConfirm(machine.id);
      }}
      onCancelDeny={() => {
        clearFailure(denyState, denyControls);
        onConfirm(null);
      }}
      onConfirmDeny={() => deny(machine.id)}
    />
  );
}

interface RevokedRowProps {
  machine: Machine;
  confirmingDelete: boolean;
  onConfirm: (id: string | null) => void;
  onRemove: (id: string) => void;
}

interface RevokedMachineCardProps {
  machine: Machine;
  deleting: boolean;
  confirmingDelete: boolean;
  actionError: string;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function RevokedMachineCard({
  machine,
  deleting,
  confirmingDelete,
  actionError,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: RevokedMachineCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-divider bg-surface/60 p-4 opacity-80">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-medium">{machine.name}</p>
        <p className="text-[13px] wrap-anywhere text-muted-foreground">{hardwareLine(machine)}</p>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Revoked {formatRevokedAt(machine.approvedAt ?? machine.createdAt)}
      </p>

      {confirmingDelete ? (
        <div className="flex flex-col gap-2 rounded-lg border border-danger/40 p-3">
          <p className="text-[13px] text-danger">Delete {machine.name}? This is permanent.</p>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onConfirmDelete}
              disabled={deleting}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancelDelete}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            aria-label={`Delete ${machine.name}`}
            onClick={onAskDelete}
            className="text-danger hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
          {actionError !== '' && <FieldError>{actionError}</FieldError>}
        </div>
      )}
    </div>
  );
}

function formatRevokedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    date,
  );
}

function RevokedRow({ machine, confirmingDelete, onConfirm, onRemove }: RevokedRowProps) {
  const [deleteState, deleteMachineRow, deleteControls, deleteError] = useMachineAction(
    (id: string) =>
      fromApi(() => deleteMachine(id)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            onRemove(id);
            onConfirm(null);
          }),
        ),
      ),
    'Could not delete the machine.',
  );

  const actionError = deleteError ?? '';

  return (
    <RevokedMachineCard
      machine={machine}
      deleting={isWaiting(deleteState)}
      confirmingDelete={confirmingDelete}
      actionError={actionError}
      onAskDelete={() => {
        clearFailure(deleteState, deleteControls);
        onConfirm(machine.id);
      }}
      onCancelDelete={() => {
        clearFailure(deleteState, deleteControls);
        onConfirm(null);
      }}
      onConfirmDelete={() => deleteMachineRow(machine.id)}
    />
  );
}

function MachineListSkeleton({ rows = 3 }: { rows?: number }) {
  const visible = useDelayed(true, SKELETON_DELAY_MS) === true;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (!visible) {
    return null;
  }
  return (
    <div role="status" aria-label="Loading machines" className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={cn(
            'flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4',
            !reduceMotion && 'animate-pulse',
            reduceMotion && 'skeleton-reduced',
          )}
        >
          <div className="flex items-start justify-between">
            <div className="h-5 w-32 rounded-full bg-surface-raised" />
            <div className="h-5 w-16 rounded-full bg-surface-raised" />
          </div>
          <div className="h-3.5 w-3/4 rounded-full bg-surface-raised" />
          <div className="h-3.5 w-2/3 rounded-full bg-surface-raised" />
          <div className="h-8 w-full rounded-md bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}

interface AddMachineButtonProps {
  onClick: () => void;
}

function AddMachineButton({ onClick }: AddMachineButtonProps) {
  return (
    <Button type="button" size="lg" onClick={onClick}>
      <Plus aria-hidden="true" />
      Add machine
    </Button>
  );
}

type PageStatus = 'loading' | 'ready' | 'error';

interface MachineListRowProps {
  machine: Machine;
  ai: PublicAi | undefined;
  aiNames: string[] | null;
  confirmingRevoke: boolean;
  onConfirm: (id: string | null) => void;
  onUpdate: (id: string, next: Machine) => void;
  onAisChanged: () => void;
}

interface ApprovedRowProps {
  machine: Machine;
  confirmingRevoke: boolean;
  aiNames: string[] | null;
  onConfirm: (id: string | null) => void;
  onUpdate: (id: string, next: Machine) => void;
  onAisChanged: () => void;
}

function ApprovedRow({
  machine,
  confirmingRevoke,
  aiNames,
  onConfirm,
  onUpdate,
  onAisChanged,
}: ApprovedRowProps) {
  const [renameState, rename, , renameError] = useMachineAction(
    (name: string) =>
      Effect.sync(() => onUpdate(machine.id, { ...machine, name })).pipe(
        Effect.andThen(fromApi(() => renameMachine(machine.id, name))),
        Effect.tap((updated) => Effect.sync(() => onUpdate(machine.id, updated))),
        Effect.tapError(() => Effect.sync(() => onUpdate(machine.id, machine))),
      ),
    'Could not rename the machine.',
  );
  const [revokeState, revoke, revokeControls, revokeError] = useMachineAction(
    (id: string) =>
      fromApi(() => revokeMachine(id)).pipe(
        Effect.tap((updated) =>
          Effect.sync(() => {
            onAisChanged();
            onConfirm(null);
            onUpdate(id, updated);
          }),
        ),
      ),
    'Could not revoke the machine.',
  );

  const actionError = renameError ?? revokeError ?? '';

  return (
    <ApprovedMachineCard
      machine={machine}
      renaming={isWaiting(renameState)}
      revoking={isWaiting(revokeState)}
      confirmingRevoke={confirmingRevoke}
      actionError={actionError}
      aiNames={aiNames}
      onRename={(name) => rename(name)}
      onAskRevoke={() => {
        clearFailure(revokeState, revokeControls);
        onConfirm(machine.id);
      }}
      onCancelRevoke={() => {
        clearFailure(revokeState, revokeControls);
        onConfirm(null);
      }}
      onConfirmRevoke={() => revoke(machine.id)}
    />
  );
}

function MachineListRow({
  machine,
  ai,
  aiNames,
  confirmingRevoke,
  onConfirm,
  onUpdate,
  onAisChanged,
}: MachineListRowProps) {
  const [open, setOpen] = useState(false);
  const online = machine.online === true;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-full items-center gap-3 border-b border-divider px-4 text-left transition-colors last:border-b-0 hover:bg-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <span
          role="img"
          aria-label={online ? 'Online' : 'Offline'}
          className={cn(
            'size-2 shrink-0 rounded-full',
            online ? 'bg-online' : 'bg-muted-foreground',
          )}
        />
        <span className="flex-1 truncate text-[15px] font-medium">{machine.name}</span>
        {ai !== undefined && (
          <EntityAvatar
            person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
            size={24}
            ai
          />
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} ariaLabel={machine.name}>
        <header className="flex shrink-0 items-center justify-end border-b border-divider p-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Close"
            title="Close"
            onClick={() => setOpen(false)}
            className="rounded-full text-muted-foreground"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-4">
          <ApprovedRow
            machine={machine}
            confirmingRevoke={confirmingRevoke}
            aiNames={aiNames}
            onConfirm={onConfirm}
            onUpdate={onUpdate}
            onAisChanged={onAisChanged}
          />
        </div>
      </Sheet>
    </>
  );
}

export function MachinesPage() {
  const navigate = useNavigate();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmingState>(EMPTY_CONFIRMING);
  const [showRevoked, setShowRevoked] = useState(false);
  // The owner's AIs label each approved machine row with its home AI. null means the load
  // failed: the row hides its avatar and the card its AIs line, and the page keeps working.
  const [ais, setAis] = useState<PublicAi[] | null>(null);

  const [loadState, reload] = useQuery(
    () =>
      fromApi(() => listMachines()).pipe(
        Effect.tap((list) => Effect.sync(() => setMachines(list))),
      ),
    [],
  );

  // The AI load is independent of the machines load: a failure drops those bits and never
  // blocks the page; a failed refresh keeps the list it had.
  const loadAis = fromApi(() => listAis()).pipe(
    Effect.tap((list) => Effect.sync(() => setAis(list))),
    Effect.catchTag('ApiFailure', () => Effect.void),
  );
  useQuery(() => loadAis, []);
  const [, refreshAis] = useAction<void, void, never>(() => loadAis, { mode: 'replace' });

  const replaceMachine = (id: string, next: Machine): void => {
    setMachines((previous) => previous.map((m) => (m.id === id ? next : m)));
  };

  const removeMachine = (id: string): void => {
    setMachines((previous) => previous.filter((m) => m.id !== id));
  };

  const setConfirm = (kind: ConfirmKind, id: string | null): void => {
    setConfirming((c) => ({ ...c, [kind]: id }));
  };

  const pendingMachines = machines.filter((m) => m.status === 'pending');
  const approvedMachines = machines.filter((m) => m.status === 'approved');
  const revokedMachines = machines.filter((m) => m.status === 'revoked');

  // Keep the local AI list in step when the server returns a fresh AI (e.g. on revoke), so
  // the row drops the picture at once; null skips the lookup entirely.
  const aisByMachineId = useMemo(() => {
    const map = new Map<string, PublicAi[]>();
    if (ais === null) {
      return map;
    }
    for (const ai of ais) {
      if (ai.machineId !== null && ai.machineId !== undefined) {
        const list = map.get(ai.machineId) ?? [];
        list.push(ai);
        map.set(ai.machineId, list);
      }
    }
    return map;
  }, [ais]);

  const loading = isWaiting(loadState) || AsyncResult.isInitial(loadState);
  const status: PageStatus = loading
    ? 'loading'
    : AsyncResult.isFailure(loadState)
      ? 'error'
      : 'ready';
  const loadError =
    status === 'error' ? failureText(failureOf(loadState), 'Could not load your machines.') : '';

  return (
    <SettingsShell
      title="Machines"
      action={<AddMachineButton onClick={() => setAdding(true)} />}
      onBack={() => navigate('/settings')}
    >
      <div className={SETTINGS_COLUMN}>
        {status === 'loading' && <MachineListSkeleton />}

        {status === 'error' && (
          <StateMessage
            kind="error"
            title={loadError}
            action={{ label: 'Retry', onClick: reload }}
          />
        )}

        {status === 'ready' &&
          (machines.length === 0 ? (
            <StateMessage
              kind="empty"
              icon={Server}
              title="No machines yet."
              hint="Add one to let your AIs work on your own computers."
              action={{ label: 'Add machine', onClick: () => setAdding(true) }}
            />
          ) : (
            <>
              {pendingMachines.length > 0 && (
                <ul aria-label="Waiting for approval" className="flex flex-col gap-2">
                  {pendingMachines.map((machine) => (
                    <li key={machine.id}>
                      <PendingRow
                        machine={machine}
                        confirmingDeny={confirming.deny === machine.id}
                        onConfirm={(id) => setConfirm('deny', id)}
                        onUpdate={replaceMachine}
                        onRemove={removeMachine}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {(approvedMachines.length > 0 || revokedMachines.length > 0) && (
                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                  {approvedMachines.map((machine) => {
                    const machineAis = aisByMachineId.get(machine.id) ?? [];
                    return (
                      <MachineListRow
                        key={machine.id}
                        machine={machine}
                        ai={machineAis[0]}
                        aiNames={ais === null ? null : machineAis.map((entry) => entry.name)}
                        confirmingRevoke={confirming.revoke === machine.id}
                        onConfirm={(id) => setConfirm('revoke', id)}
                        onUpdate={replaceMachine}
                        onAisChanged={() => refreshAis()}
                      />
                    );
                  })}

                  {revokedMachines.length > 0 && (
                    <button
                      type="button"
                      aria-expanded={showRevoked}
                      onClick={() => setShowRevoked((value) => !value)}
                      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-muted-foreground transition-colors hover:bg-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 focus-visible:outline-none"
                    >
                      <Ban className="size-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1 text-[15px]">Revoked</span>
                      <span className="font-mono text-[12px]">{revokedMachines.length}</span>
                      <ChevronRight
                        className={cn(
                          'size-4 shrink-0 transition-transform',
                          showRevoked && 'rotate-90',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              )}

              {showRevoked && revokedMachines.length > 0 && (
                <ul aria-label="Revoked machines" className="flex flex-col gap-2">
                  {revokedMachines.map((machine) => (
                    <li key={machine.id}>
                      <RevokedRow
                        machine={machine}
                        confirmingDelete={confirming.delete === machine.id}
                        onConfirm={(id) => setConfirm('delete', id)}
                        onRemove={removeMachine}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ))}
      </div>

      {adding && <AddMachineDialog onClose={() => setAdding(false)} />}
    </SettingsShell>
  );
}

interface ConfirmingState {
  deny: string | null;
  revoke: string | null;
  delete: string | null;
}

type ConfirmKind = keyof ConfirmingState;

const EMPTY_CONFIRMING: ConfirmingState = { deny: null, revoke: null, delete: null };

function clearFailure<A>(state: ActionState<A, ApiFailure>, controls: ActionControls): void {
  if (!isWaiting(state)) {
    controls.reset();
  }
}

function useMachineAction<I, A>(
  fn: (input: I) => Effect.Effect<A, ApiFailure, HttpClient.HttpClient>,
  fallback: string,
  options?: UseActionOptions,
): readonly [
  state: ActionState<A, ApiFailure>,
  run: (input: I) => void,
  controls: ActionControls,
  error: string | null,
] {
  const [state, run, controls] = useAction(fn, options);
  const failure = shownFailure(state);
  return [state, run, controls, failure === undefined ? null : failureText(failure, fallback)];
}
