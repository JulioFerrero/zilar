import type { ImagesBlock as ImagesBlockData } from '@zilar/protocol';
import { ImageOff } from 'lucide-react';
import { useState } from 'react';

function tileRadius(index: number, count: number): string {
  if (count === 1) {
    return '12px';
  }
  const rows = Math.ceil(count / 2);
  const top = Math.floor(index / 2) === 0;
  const bottom = Math.floor(index / 2) === rows - 1;
  const left = index % 2 === 0;
  const corner = (outer: boolean) => (outer ? '12px' : '6px');
  return [
    corner(top && left),
    corner(top && !left),
    corner(bottom && !left),
    corner(bottom && left),
  ].join(' ');
}

/**
 * Uploaded media ids draw as one full-width tile or a 2×2 grid, with `extra`
 * summed on the last tile. The route sends the bytes same-origin, so the
 * session cookie authenticates every `<img>`.
 */
export function ImagesBlock({
  block,
  title,
}: {
  block: ImagesBlockData;
  title?: string | undefined;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const count = block.items.length;
  const label = title ?? 'Image';
  return (
    <div className={count === 1 ? '' : 'grid grid-cols-2 gap-1'}>
      {block.items.map((id, index) => {
        const extra = index === count - 1 ? block.extra : undefined;
        return (
          <a
            key={`${id}-${index}`}
            href={failed.has(id) ? undefined : `/api/card-media/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="relative block overflow-hidden bg-[#181818]"
            style={{
              height: count === 1 ? '180px' : '120px',
              borderRadius: tileRadius(index, count),
            }}
          >
            {failed.has(id) ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted-foreground">
                <ImageOff className="size-5" aria-hidden />
                <span className="text-[12px]">Photo unavailable</span>
              </span>
            ) : (
              <img
                src={`/api/card-media/${id}`}
                loading="lazy"
                className="size-full object-cover"
                alt=""
                onError={() =>
                  setFailed((current) => {
                    const next = new Set(current);
                    next.add(id);
                    return next;
                  })
                }
              />
            )}
            {extra !== undefined && extra > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-[20px] font-medium">
                +{extra}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
