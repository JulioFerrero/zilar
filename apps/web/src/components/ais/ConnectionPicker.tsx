import { isLlmProvider, providerLabel } from '@zilar/chat-core';
import type { Connection } from '@/lib/api';
import { SelectOption } from './AiPageShell';

export { providerLabel };

/**
 * The wizard's provider picker over the caller's active connections. A
 * connection whose provider is not an LLM one (GitHub) is dropped: it cannot
 * run an AI.
 */
export function ConnectionPicker({
  connections,
  value,
  onChange,
}: {
  connections: Connection[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Provider connection" className="flex flex-col gap-2">
      {connections
        .filter((connection) => isLlmProvider(connection.provider))
        .map((connection) => {
          const selected = connection.id === value;
          return (
            <SelectOption
              key={connection.id}
              selected={selected}
              onClick={() => onChange(connection.id)}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[14px] font-semibold text-accent">
                {providerLabel(connection.provider).charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">
                  {providerLabel(connection.provider)}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {connection.label ?? 'No label'}
                </span>
              </span>
            </SelectOption>
          );
        })}
    </div>
  );
}
