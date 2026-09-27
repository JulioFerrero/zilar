import { avatarGradient, initials } from '@galena/chat-core';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AvatarProps {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  avatarUrl?: string | undefined;
  className?: string;
}

export function Avatar({ id, name, size = 54, online = false, avatarUrl, className }: AvatarProps) {
  const gradient = avatarGradient(id);
  const label = initials(name);

  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {avatarUrl === undefined ? (
        <span
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white select-none"
          style={{
            backgroundImage: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`,
            fontSize: Math.round(size * 0.4),
          }}
        >
          {label.length > 0 ? (
            label
          ) : (
            <User
              aria-hidden="true"
              style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }}
            />
          )}
        </span>
      ) : (
        <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
      )}
      {online && (
        <span
          aria-label="Online"
          className="absolute right-0 bottom-0 rounded-full border-2 border-background bg-[#4dcd5e]"
          style={{ width: 12, height: 12 }}
        />
      )}
    </span>
  );
}
