import { useState } from 'react';
import { ArrowUpRight, Eye, EyeOff, Lock } from 'lucide-react';
import type { KeyCheck } from './useKeyCheck';

export function KeyStep({ keys }: { keys: KeyCheck }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <span className="flex-1 text-[13px] font-medium">API key</span>
        {keys.keyPage !== null && (
          <a
            href={keys.keyPage}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Get one
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        )}
      </div>

      <div className="well-surface flex h-10 items-center gap-2.5 rounded-[10px] pr-1 pl-3">
        <Lock className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
        <input
          aria-label="API key"
          type={revealed ? 'text' : 'password'}
          autoComplete="off"
          value={keys.key}
          maxLength={16384}
          placeholder={keys.keyPlaceholder}
          onChange={(event) => keys.setKey(event.target.value)}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] tracking-wider text-foreground outline-none placeholder:tracking-normal placeholder:text-subtle-foreground"
        />
        {keys.keyVerified && (
          <span
            role="img"
            aria-label="Key works"
            className="size-2 shrink-0 rounded-full bg-online ring-2 ring-surface"
          />
        )}
        <button
          type="button"
          aria-label={revealed ? 'Hide key' : 'Show key'}
          title={revealed ? 'Hide key' : 'Show key'}
          onClick={() => setRevealed((value) => !value)}
          className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-subtle-foreground hover:text-foreground"
        >
          {revealed ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {keys.keyError !== '' && (
        <p role="alert" className="text-[13px] text-danger">
          {keys.keyError}
        </p>
      )}
    </div>
  );
}
