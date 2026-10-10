import { Effect } from 'effect';
import type { ReactNode } from 'react';
import type { ListenerEagerness, SetGroupListenerInput } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from '../ais/AiPageShell';
import { SegmentedControl } from '../ui/segmented-control';
import { Switch } from '../ui/switch';
import { messageOf, settingText, storeStep } from './groupPanelOps';
import type { PanelFailure } from './groupPanelOps';

/**
 * A manager setting row: a title, a switch, optional rows below it, a
 * description, and an inline error. The topic and AI-listener settings were
 * the same `Switch`+`FieldError` pattern before the split.
 */
export function GroupSettingSwitch({
  ariaLabel,
  title,
  checked,
  onCheckedChange,
  disabled,
  error,
  children,
  description,
}: {
  ariaLabel: string;
  title: string;
  checked: boolean;
  onCheckedChange: () => void;
  disabled: boolean;
  error: string;
  children?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <section aria-label={ariaLabel} className="flex flex-col gap-2 px-2">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-list-hover">
        <span className="text-[14px]">{title}</span>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          label={title}
          hideLabel
          disabled={disabled}
        />
      </label>
      {children}
      {description}
      {error !== '' && <FieldError>{error}</FieldError>}
    </section>
  );
}

/** T-0111: "Members can create topics", with its save action and inline error. */
export function GroupTopicSetting({
  chatId,
  canCreateTopics,
}: {
  chatId: string;
  canCreateTopics: boolean | undefined;
}) {
  const storeApi = useChatStoreApi();
  const [state, setTopicsAllowed] = useAction<boolean, void, PanelFailure>((allowed) =>
    storeStep(
      () => storeApi.getState().setMembersCanCreateTopics(chatId, allowed),
      settingText,
    ).pipe(Effect.asVoid),
  );
  return (
    <GroupSettingSwitch
      ariaLabel="Topic settings"
      title="Members can create topics"
      checked={canCreateTopics === true}
      onCheckedChange={() => setTopicsAllowed(canCreateTopics !== true)}
      disabled={isWaiting(state)}
      error={messageOf(state) ?? ''}
    />
  );
}

/**
 * T-0478: the AI listener switch and eagerness. Both go through
 * `setGroupListener`; the store refreshes the detail on success and an inline
 * error shows on failure, exactly like the topic switch.
 */
export function GroupListenerSetting({
  chatId,
  enabled,
  available,
  eagerness,
}: {
  chatId: string;
  enabled: boolean;
  available: boolean;
  eagerness: ListenerEagerness;
}) {
  const storeApi = useChatStoreApi();
  const [state, saveListener] = useAction<SetGroupListenerInput, void, PanelFailure>((input) =>
    storeStep(() => storeApi.getState().setGroupListener(chatId, input), settingText).pipe(
      Effect.asVoid,
    ),
  );
  const busy = isWaiting(state);
  const flip = (): void => {
    if (available) {
      saveListener({ listenerEnabled: !enabled });
    }
  };
  const chooseEagerness = (value: ListenerEagerness): void => {
    if (available) {
      saveListener({ listenerEagerness: value });
    }
  };
  return (
    <GroupSettingSwitch
      ariaLabel="AI listener"
      title="Let AIs answer without @mention"
      checked={enabled}
      onCheckedChange={flip}
      disabled={!available || busy}
      error={messageOf(state) ?? ''}
      description={
        <p className="px-2 text-[13px] text-muted-foreground">
          {available
            ? 'Normal suits most groups. Quiet wakes AIs only for clear asks.'
            : 'Turned off on this server'}
        </p>
      }
    >
      {enabled && (
        <fieldset disabled={!available || busy} className="m-0 min-w-0 border-0 p-0">
          <SegmentedControl
            options={[
              { value: 'quiet', label: 'Quiet' },
              { value: 'normal', label: 'Normal' },
              { value: 'eager', label: 'Eager' },
            ]}
            value={eagerness}
            onChange={(value) => chooseEagerness(value as ListenerEagerness)}
            ariaLabel="Eagerness"
            mode="radio"
          />
        </fieldset>
      )}
    </GroupSettingSwitch>
  );
}
