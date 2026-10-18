import { Effect } from 'effect';
import { Link, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { GroupDetail, GroupRole } from '@/lib/api';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatSelector, useChatStoreApi } from '@/store/ChatStoreProvider';
import { FieldError } from './ais/AiPageShell';
import { EntityAvatar } from './EntityAvatar';
import { HandleSuffix } from './HandleSuffix';
import { MemberRow } from './group-info/MemberRow';
import { PanelFailure, apiStep, messageOf } from './panels/groupPanelOps';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog } from './ui/dialog';
import { ListRow } from './ui/list-row';
import { SearchField } from './ui/search-field';

export function GroupMembersSection({
  chatId,
  info,
  me,
  rolesByUser,
  onOpenLinks,
  openPickerOnMount = false,
}: {
  chatId: string;
  info: GroupDetail;
  me: string | undefined;
  rolesByUser: Map<string, GroupRole[]>;
  onOpenLinks: () => void;
  openPickerOnMount?: boolean;
}) {
  const storeApi = useChatStoreApi();
  const contacts = useChatSelector((s) => s.contacts);
  const meRole = info.members.find((member) => member.userId === me)?.role;
  const isManager = meRole === 'owner' || meRole === 'admin';
  const isOwner = meRole === 'owner';

  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(openPickerOnMount);
  const [selected, setSelected] = useState<string[]>([]);

  const [changeState, runChange] = useAction<Effect.Effect<void, PanelFailure>, void, PanelFailure>(
    (change) => change,
  );
  const busy = isWaiting(changeState);
  const errorMessage = messageOf(changeState) ?? '';

  const memberIds = new Set(info.members.map((member) => member.userId));
  const addable = contacts.filter((contact) => !memberIds.has(contact.userId));

  const run = (call: () => Promise<void>, fallback: string, after?: () => void): void =>
    runChange(apiStep(call, fallback).pipe(Effect.tap(() => Effect.sync(() => after?.()))));

  const toggle = (userId: string): void => {
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  };

  const closePicker = (): void => {
    setPickerOpen(false);
    setSelected([]);
  };

  const addMembers = (): void => {
    run(
      () => storeApi.getState().addGroupMembers(chatId, selected),
      'Could not add the members.',
      closePicker,
    );
  };

  const needle = query.trim().toLowerCase();
  const visibleMembers =
    needle === ''
      ? info.members
      : info.members.filter(
          (member) =>
            member.name.toLowerCase().includes(needle) ||
            (member.handle ?? '').toLowerCase().includes(needle),
        );

  return (
    <section aria-label="Members" className="flex flex-col gap-2">
      <SearchField
        aria-label="Search members"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {isManager && (
        <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
          <ListRow
            icon={<UserPlus className="size-4" aria-hidden="true" />}
            title="Add members"
            onClick={() => setPickerOpen(true)}
          />
          <ListRow
            icon={<Link className="size-4" aria-hidden="true" />}
            title="Invite with a link"
            onClick={onOpenLinks}
          />
        </div>
      )}

      <div className="divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface">
        {visibleMembers.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            roles={rolesByUser.get(member.userId) ?? member.roles ?? []}
            me={me}
            chatId={chatId}
            isManager={isManager}
            isOwner={isOwner}
            busy={busy}
            run={run}
          />
        ))}
      </div>

      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}

      <Dialog
        open={pickerOpen}
        onClose={closePicker}
        title="Add members"
        ariaLabel="Add members"
        size="sm"
        busy={busy}
        actions={
          <Button
            type="button"
            size="lg"
            disabled={selected.length === 0 || busy}
            onClick={addMembers}
          >
            Add
          </Button>
        }
      >
        <div className="mt-3">
          {addable.map((contact) => (
            <label
              key={contact.userId}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-list-hover"
            >
              <Checkbox
                checked={selected.includes(contact.userId)}
                onCheckedChange={() => toggle(contact.userId)}
              />
              <EntityAvatar person={contact} size={28} />
              <span className="truncate text-[15px]">
                {contact.name} <HandleSuffix handle={contact.handle} />
              </span>
            </label>
          ))}
        </div>
      </Dialog>
    </section>
  );
}
