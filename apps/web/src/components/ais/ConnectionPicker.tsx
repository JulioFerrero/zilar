import type { Connection } from '@/lib/api';
import { SelectOption } from './AiPageShell';

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  openrouter: 'OpenRouter',
  github: 'GitHub',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/** The wizard's provider picker over the caller's active connections. */
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
      {connections.map((connection) => {
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
