import { Effect } from 'effect';
import { useState } from 'react';
import { deleteTool } from '@/lib/tools';
import { Button, FieldError } from '@/components/ais/AiPageShell';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { fromApi, type ApiFailure } from '@zilar/client-core';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { failureText } from './toolDetailOps';

export function DeleteToolButton({
  toolId,
  toolName,
  canManage,
  onDeleted,
}: {
  toolId: string;
  toolName: string;
  canManage: boolean;
  onDeleted: (toolId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, remove] = useAction<void, void, ApiFailure>(() =>
    fromApi(() => deleteTool(toolId)).pipe(
      Effect.tap(() => Effect.sync(() => onDeleted(toolId))),
      Effect.ensuring(Effect.sync(() => setConfirming(false))),
    ),
  );
  if (!canManage) {
    return null;
  }
  const busy = isWaiting(state);
  const failure = busy ? undefined : failureOf(state);
  return (
    <div className="flex flex-col gap-2 px-2">
      <div>
        <Button
          type="button"
          variant="destructive"
          size="lg"
          className="rounded-full px-4"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Delete tool
        </Button>
      </div>
      {failure !== undefined && (
        <FieldError>{failureText(failure, 'Could not delete the tool.')}</FieldError>
      )}
      {confirming && (
        <ConfirmDialog
          title={`Delete ${toolName}?`}
          body="This deletes the tool and its routines. This cannot be undone."
          confirmLabel={busy ? 'Deleting…' : 'Delete'}
          onConfirm={() => remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
