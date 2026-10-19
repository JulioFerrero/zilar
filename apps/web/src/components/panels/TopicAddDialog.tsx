import { avatarIdentity } from '@zilar/chat-core';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Check, Copy, Link2, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { copyText } from '@/lib/clipboard';
import type { ApiFailure } from '@zilar/client-core';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useQuery } from '@/lib/effect/use-query';

export interface AddPerson {
  id: string;
  name: string;
  avatarUrl?: string;
  handle?: string | null;
  inGroup: boolean;
}

export interface AddAi {
  id: string;
  name: string;
  avatarUrl?: string;
  inGroup: boolean;
}

type Tab = 'people' | 'ais';
type Outcome = 'added' | 'failed';
type PersonOutcome = { outcome: Outcome | undefined; person: AddPerson };
type AiOutcome = { outcome: Outcome | undefined; ai: AddAi };

function mergeRows<T>(live: T[], settled: T[], idOf: (row: T) => string): T[] {
  const seen = new Set(live.map(idOf));
  return [...live, ...settled.filter((row) => !seen.has(idOf(row)))];
}

function AddKey({
  outcome,
  busy,
  onClick,
}: {
  outcome: Outcome | undefined;
  busy: boolean;
  onClick: () => void;
}) {
  if (outcome === 'added') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
        <Check className="size-3.5" aria-hidden="true" /> Added
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-2">
      {outcome === 'failed' && (
        <span className="text-[12px] text-muted-foreground">Couldn&apos;t add</span>
      )}
      <Button type="button" size="sm" className="shrink-0" disabled={busy} onClick={onClick}>
        {busy ? 'Adding…' : 'Add'}
      </Button>
    </span>
  );
}

function AddRow({
  id,
  name,
  avatarUrl,
  ai,
  tag,
  outcome,
  add,
  onResult,
}: {
  id: string;
  name: string;
  avatarUrl?: string;
  ai?: boolean;
  tag?: string;
  outcome: Outcome | undefined;
  add: (id: string) => Effect.Effect<void, ApiFailure>;
  onResult: (outcome: Outcome | undefined) => void;
}) {
  const [state, run] = useAction<string, void, ApiFailure>((rowId) =>
    add(rowId).pipe(
      Effect.tap(() => Effect.sync(() => onResult('added'))),
      Effect.tapError(() => Effect.sync(() => onResult('failed'))),
    ),
  );
  const identity = avatarIdentity({
    name,
    id,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  });
  const retry = (): void => {
    onResult(undefined);
    run(id);
  };
  return (
    <div className="flex min-h-[52px] items-center gap-2.5 border-b border-divider px-3 last:border-b-0">
      <Avatar
        seed={identity.seed}
        name={identity.name}
        size={30}
        {...(ai === true ? { ai: true } : {})}
        {...(identity.avatarUrl === undefined ? {} : { avatarUrl: identity.avatarUrl })}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px]">{name}</p>
        {tag !== undefined && (
          <p className="truncate font-mono text-[11px] text-muted-foreground">{tag}</p>
        )}
      </div>
      <AddKey outcome={outcome} busy={isWaiting(state)} onClick={retry} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="px-0.5 font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
        {title}
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        {children}
      </div>
    </div>
  );
}

function InviteRow({ createInvite }: { createInvite: () => Effect.Effect<string, ApiFailure> }) {
  const [invite] = useQuery(() => createInvite(), [createInvite]);
  const url = AsyncResult.isSuccess(invite) ? invite.value : undefined;
  const failed = failureOf(invite) !== undefined;

  const [copyState, copyUrl] = useAction<string, void, unknown>((value) =>
    Effect.tryPromise({ try: () => copyText(value), catch: (cause) => cause }),
  );
  const copied = AsyncResult.isSuccess(copyState);
  const copy = (): void => {
    if (url !== undefined) {
      copyUrl(url);
    }
  };

  return (
    <div className="flex min-h-[52px] items-center gap-2.5 rounded-xl border border-border bg-surface-raised px-3">
      <span className="key-icon inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px]">
        <Link2 className="size-[15px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-[14px]">Invite with a link</span>
      {failed ? (
        <span className="shrink-0 text-[12px] text-danger">Couldn&apos;t create a link</span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Copy invite link"
          className="shrink-0"
          disabled={url === undefined}
          onClick={copy}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      )}
    </div>
  );
}

export function TopicAddDialog({
  topicName,
  groupTitle,
  isManager,
  people,
  ais,
  addMember,
  addAi,
  createInvite,
  onClose,
  initialTab = 'people',
}: {
  topicName: string;
  groupTitle: string;
  isManager: boolean;
  people: AddPerson[];
  ais: AddAi[];
  addMember: (userId: string) => Effect.Effect<void, ApiFailure>;
  addAi: (aiId: string) => Effect.Effect<void, ApiFailure>;
  createInvite: () => Effect.Effect<string, ApiFailure>;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState('');
  const [personOutcomes, setPersonOutcomes] = useState<Record<string, PersonOutcome>>({});
  const [aiOutcomes, setAiOutcomes] = useState<Record<string, AiOutcome>>({});

  const query = search.trim().toLowerCase();
  const matches = (name: string, handle?: string | null): boolean =>
    query === '' ||
    name.toLowerCase().includes(query) ||
    (handle ?? '').toLowerCase().includes(query);

  const visiblePeople = mergeRows(
    people,
    Object.values(personOutcomes).map((entry) => entry.person),
    (person) => person.id,
  ).filter((person) => (isManager || person.inGroup) && matches(person.name, person.handle));
  const visibleAis = mergeRows(
    ais,
    Object.values(aiOutcomes).map((entry) => entry.ai),
    (ai) => ai.id,
  ).filter((ai) => (isManager || ai.inGroup) && matches(ai.name));
  const peopleInGroup = visiblePeople.filter((person) => person.inGroup);
  const peopleContacts = visiblePeople.filter((person) => !person.inGroup);
  const aisInGroup = visibleAis.filter((ai) => ai.inGroup);
  const aisOther = visibleAis.filter((ai) => !ai.inGroup);
  const emptyText =
    query === '' ? `Everyone here is already in ${topicName}.` : 'No one matches that search.';

  const recordPerson = (person: AddPerson, outcome: Outcome | undefined): void => {
    setPersonOutcomes((previous) => ({ ...previous, [person.id]: { outcome, person } }));
  };
  const recordAi = (ai: AddAi, outcome: Outcome | undefined): void => {
    setAiOutcomes((previous) => ({ ...previous, [ai.id]: { outcome, ai } }));
  };
  const personRows = (rows: AddPerson[], tag?: string) =>
    rows.map((person) => (
      <AddRow
        key={person.id}
        id={person.id}
        name={person.name}
        {...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl })}
        {...(tag === undefined ? {} : { tag })}
        outcome={personOutcomes[person.id]?.outcome}
        add={addMember}
        onResult={(outcome) => recordPerson(person, outcome)}
      />
    ));
  const aiRows = (rows: AddAi[], tag?: string) =>
    rows.map((ai) => (
      <AddRow
        key={ai.id}
        id={ai.id}
        name={ai.name}
        ai
        {...(ai.avatarUrl === undefined ? {} : { avatarUrl: ai.avatarUrl })}
        {...(tag === undefined ? {} : { tag })}
        outcome={aiOutcomes[ai.id]?.outcome}
        add={addAi}
        onResult={(outcome) => recordAi(ai, outcome)}
      />
    ));

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        {/* Force the scrim, which Base UI drops for a nested dialog. */}
        <DialogPrimitive.Backdrop forceRender className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Viewport className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4 pt-24">
          <DialogPrimitive.Popup className="flex w-full max-w-[440px] flex-col gap-3.5 rounded-2xl border border-border bg-panel p-[18px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.95)] outline-none">
            <div className="flex items-center gap-2.5">
              <DialogPrimitive.Title className="min-w-0 flex-1 text-[17px] font-semibold tracking-[-0.02em]">
                Add to {topicName}
              </DialogPrimitive.Title>
              <IconButton aria-label="Close" onClick={onClose}>
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </div>

            <SegmentedControl
              options={[
                { value: 'people', label: 'People' },
                { value: 'ais', label: 'AIs' },
              ]}
              value={tab}
              onChange={(value) => setTab(value === 'ais' ? 'ais' : 'people')}
              ariaLabel="Add"
            />

            <label className="well-surface flex h-10 items-center gap-2.5 rounded-xl px-3">
              <Search className="size-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={tab === 'people' ? 'Search people' : 'Search AIs'}
                placeholder="Name or @handle"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
              />
            </label>

            <div className="flex flex-col gap-3.5">
              {tab === 'people' ? (
                visiblePeople.length === 0 ? (
                  <p className="px-0.5 text-[13px] text-muted-foreground">{emptyText}</p>
                ) : (
                  <>
                    {peopleInGroup.length > 0 && (
                      <Section title={`IN ${groupTitle.toUpperCase()}`}>
                        {personRows(peopleInGroup)}
                      </Section>
                    )}
                    {isManager && peopleContacts.length > 0 && (
                      <Section title="YOUR CONTACTS">
                        {personRows(peopleContacts, `+ joins ${groupTitle}`)}
                      </Section>
                    )}
                  </>
                )
              ) : visibleAis.length === 0 ? (
                <p className="px-0.5 text-[13px] text-muted-foreground">{emptyText}</p>
              ) : (
                <>
                  {aisInGroup.length > 0 && (
                    <Section title={`IN ${groupTitle.toUpperCase()}`}>{aiRows(aisInGroup)}</Section>
                  )}
                  {isManager && aisOther.length > 0 && (
                    <Section title="YOUR OTHER AIS">
                      {aiRows(aisOther, `+ joins ${groupTitle}`)}
                    </Section>
                  )}
                </>
              )}
            </div>

            <InviteRow createInvite={createInvite} />
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
