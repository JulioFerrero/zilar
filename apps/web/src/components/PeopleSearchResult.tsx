import { usePeopleSearch } from '@/lib/usePeopleSearch';
import { ContactProfileRow } from './ContactProfileRow';

/**
 * The People section above the chat-name and message results: typing
 * `@handle` in the search bar shows one row for that person (or one muted
 * line when the handle is unknown). Normal results continue below.
 */
export function PeopleSearchResult({ query }: { query: string }) {
  const { state, refreshProfile } = usePeopleSearch(query);

  if (state.status === 'idle') {
    return null;
  }
  if (state.status === 'loading') {
    return (
      <div aria-label="Searching people" className="flex flex-col gap-1 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
        <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">Searching…</p>
      </div>
    );
  }
  if (state.status === 'missing' || state.status === 'invalid') {
    return (
      <div className="flex flex-col gap-1 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
        <p className="px-[10px] pb-2 text-[13px] text-muted-foreground">
          No one with that username.
        </p>
      </div>
    );
  }
  if (state.status === 'rate_limited') {
    return (
      <div className="flex flex-col gap-1 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
        <p role="alert" className="px-[10px] pb-2 text-[13px] text-muted-foreground">
          Too many searches, try again in a few minutes.
        </p>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-1 px-2">
        <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
        <p role="alert" className="px-[10px] pb-2 text-[13px] text-muted-foreground">
          Could not search for that username.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 px-2">
      <p className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">People</p>
      <ContactProfileRow
        key={state.profile.userId}
        profile={state.profile}
        onRelationChange={refreshProfile}
      />
    </div>
  );
}
