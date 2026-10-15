import type { GroupAi, PublicAi } from '@/lib/api';
import { AiBadge } from '../AiBadge';
import { FieldError } from '../ais/AiPageShell';
import { EntityAvatar } from '../EntityAvatar';
import { GroupAiRow } from '../panels/ChannelAdminsSection';
import { Button } from '../ui/button';

/**
 * The channel's AIs page (T-1519): today's AIs section, moved behind a subpage.
 * The data and actions stay in `ChannelPanel`, which passes the picker state and
 * callbacks in; this only draws them.
 */
export function ChannelAisPage({
  chatId,
  ais,
  ownerNameOf,
  canRemove,
  isManager,
  eligibleAis,
  pickerOpen,
  addingId,
  onPick,
  onOpenPicker,
  onClosePicker,
  confirmingId,
  onConfirm,
  errorMessage,
  onError,
}: {
  chatId: string;
  ais: GroupAi[];
  ownerNameOf: (ai: GroupAi) => string;
  canRemove: (ai: GroupAi) => boolean;
  isManager: boolean;
  eligibleAis: PublicAi[];
  pickerOpen: boolean;
  addingId: string | undefined;
  onPick: (aiId: string) => void;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  confirmingId: string | undefined;
  onConfirm: (aiId: string | undefined) => void;
  errorMessage: string;
  onError: (message: string) => void;
}) {
  return (
    <section aria-label="AIs" className="flex flex-col gap-1">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">AIs</h2>
      {ais.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">No AIs post in this channel yet.</p>
      )}
      {ais.map((ai) => (
        <GroupAiRow
          key={ai.aiId}
          chatId={chatId}
          ai={ai}
          addedBy={ownerNameOf(ai)}
          canRemove={canRemove(ai)}
          confirming={confirmingId === ai.aiId}
          onConfirm={onConfirm}
          onError={onError}
        />
      ))}

      {isManager && eligibleAis.length > 0 && (
        <div className="mt-1 flex flex-col gap-2 px-2">
          <p className="text-[12px] text-muted-foreground">
            An AI posts here only when its owner is a channel admin.
          </p>
          {pickerOpen ? (
            <div className="flex flex-col gap-1">
              {eligibleAis.map((ai) => (
                <Button
                  key={ai.id}
                  type="button"
                  variant="outline"
                  disabled={addingId !== undefined}
                  onClick={() => onPick(ai.id)}
                  className="h-auto justify-start gap-2 rounded-xl px-2 py-1.5 text-left text-[14px] font-normal"
                >
                  <EntityAvatar
                    person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
                    size={28}
                    ai
                  />
                  <span className="min-w-0 flex-1 truncate">{ai.name}</span>
                  <AiBadge />
                  {addingId === ai.id && (
                    <span className="text-[12px] text-muted-foreground">Adding…</span>
                  )}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                disabled={addingId !== undefined}
                onClick={onClosePicker}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="lg"
              className="self-start rounded-full px-4"
              onClick={onOpenPicker}
            >
              Add my AI
            </Button>
          )}
        </div>
      )}

      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}
    </section>
  );
}
