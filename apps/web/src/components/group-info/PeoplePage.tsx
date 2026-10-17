import { useState } from 'react';
import type { GroupAi, GroupDetail, GroupRole, PublicAi } from '@/lib/api';
import { GroupMembersSection } from '../GroupMembersSection';
import { AiMemoryDialog } from '../ais/AiMemoryDialog';
import { FieldError } from '../ais/AiPageShell';
import { GroupAiSection } from '../panels/GroupAiSection';
import { GroupRolesSection } from '../panels/GroupRolesSection';
import type { RolesView } from '../panels/groupPanelOps';

/** A section label with its count on the right, as the topic panel draws it. */
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-0.5 text-[12px] font-semibold text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono font-normal">{count}</span>
    </div>
  );
}

/**
 * The combined People and AIs page (T-1857): the AIs first, as the topic sheet
 * draws them, then the members with Add and Invite with a link, then the roles
 * for managers. The panel owns the open page and the add-AI picker snapshot.
 */
export function PeoplePage({
  chatId,
  info,
  me,
  isManager,
  rolesByUser,
  rolesState,
  onReloadRoles,
  onOpenLinks,
  openPickerOnMount,
  eligibleAis,
  pickerChoices,
  onOpenPicker,
  onClosePicker,
}: {
  chatId: string;
  info: GroupDetail;
  me: string | undefined;
  isManager: boolean;
  rolesByUser: Map<string, GroupRole[]>;
  rolesState: RolesView;
  onReloadRoles: () => void;
  /** Opens the invite links page from the members' Invite row. */
  onOpenLinks: () => void;
  /** The root's Add key lands here with the member picker already open. */
  openPickerOnMount: boolean;
  eligibleAis: PublicAi[];
  pickerChoices: PublicAi[] | undefined;
  onOpenPicker: () => void;
  onClosePicker: () => void;
}) {
  const [memoryAi, setMemoryAi] = useState<{ id: string; name: string } | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState('');

  const ownerName = (ai: GroupAi): string =>
    info.members.find((member) => member.userId === ai.ownerId)?.name ?? 'someone';
  const canRemove = (ai: GroupAi): boolean => ai.ownerId === me || isManager;

  return (
    <>
      <section className="flex flex-col gap-2">
        <SectionHeading label="AIs" count={info.ais.length} />
        {/* GroupAiSection draws its own plain label; this page draws the counted one. */}
        <div className="[&>section>h2]:hidden">
          <GroupAiSection
            ais={info.ais}
            chatId={chatId}
            ownerNameOf={ownerName}
            canRemove={canRemove}
            isManager={isManager}
            eligibleAis={eligibleAis}
            pickerChoices={pickerChoices}
            onOpenPicker={onOpenPicker}
            onClosePicker={onClosePicker}
            onOpenMemory={(ai) => setMemoryAi(ai)}
            onError={setErrorMessage}
          />
        </div>
      </section>

      {memoryAi !== undefined && (
        <AiMemoryDialog
          chat={chatId}
          aiId={memoryAi.id}
          aiName={memoryAi.name}
          onClose={() => setMemoryAi(undefined)}
        />
      )}

      {errorMessage !== '' && <FieldError>{errorMessage}</FieldError>}

      <section className="flex flex-col gap-2">
        <SectionHeading label="People" count={info.members.length} />
        <GroupMembersSection
          chatId={chatId}
          info={info}
          me={me}
          rolesByUser={rolesByUser}
          onOpenLinks={onOpenLinks}
          openPickerOnMount={openPickerOnMount}
        />
      </section>

      {/* T-0116: custom group roles — managers only. Everyone sees the chips
            next to the member names above. */}
      {isManager && (
        <GroupRolesSection
          groupId={info.id}
          members={info.members.map((member) => ({
            userId: member.userId,
            name: member.name,
            ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
          }))}
          rolesState={rolesState}
          onReload={onReloadRoles}
        />
      )}
    </>
  );
}
