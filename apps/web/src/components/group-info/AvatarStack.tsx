import { Avatar } from '../Avatar';

export interface AvatarStackEntry {
  id: string;
  name: string;
  avatarUrl?: string;
}

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
