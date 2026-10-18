import { useState } from 'react';
import type { GroupAi, GroupDetail, GroupRole, PublicAi } from '@/lib/api';
import { GroupMembersSection } from '../GroupMembersSection';
import { AiMemoryDialog } from '../ais/AiMemoryDialog';
import { FieldError } from '../ais/AiPageShell';
import { GroupAiSection } from '../panels/GroupAiSection';
import { GroupRolesSection } from '../panels/GroupRolesSection';
import type { RolesView } from '../panels/groupPanelOps';
import { SectionLabel } from '../ui/card';

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-0.5">
      <SectionLabel>{label}</SectionLabel>
      <span className="font-mono text-[12px] font-normal text-muted-foreground">{count}</span>
    </div>
  );
}

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
  onOpenLinks: () => void;
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

      {isManager && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Roles</SectionLabel>
          <div className="[&>section>h2]:hidden">
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
          </div>
        </section>
      )}
    </>
  );
}
