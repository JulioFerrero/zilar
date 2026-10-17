import { Avatar } from '../Avatar';

/** One avatar of a stack: a person or an AI. */
export interface AvatarStackEntry {
  id: string;
  name: string;
  avatarUrl?: string;
}

/**
 * The overlapping row of avatars the boards draw beside a topic and the
 * People and AIs row (T-1786, T-1857): a person or an AI per entry, drawn
 * left to right with a ring in the surface colour.
 */
export function AvatarStack({
  entries,
  size = 20,
}: {
  entries: AvatarStackEntry[];
  size?: number;
}) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      {entries.map((entry, index) => (
        <Avatar
          key={entry.id}
          seed={entry.name}
          name={entry.name}
          size={size}
          className={index === 0 ? 'border-2 border-surface' : '-ml-1.5 border-2 border-surface'}
          {...(entry.avatarUrl === undefined ? {} : { avatarUrl: entry.avatarUrl })}
        />
      ))}
    </span>
  );
}
