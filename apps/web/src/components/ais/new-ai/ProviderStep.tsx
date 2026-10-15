import { Combobox } from '@/components/ui/combobox';
import type { KeyCheck } from './useKeyCheck';

/** Step 1: the provider, with an OpenAI-compatible endpoint at the bottom. */
export function ProviderStep({ keys }: { keys: KeyCheck }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Provider</span>
        <Combobox
          label="Provider"
          options={keys.choices
            .filter((choice) => choice.id !== 'openai-compatible')
            .map((choice) => ({
              value: choice.id,
              label: choice.label,
              ...(choice.hasKey ? { dot: 'online' as const } : {}),
            }))}
          value={keys.providerId}
          onValueChange={keys.chooseProvider}
          placeholder="Search providers"
          triggerPlaceholder="Choose a provider"
          footerItem={{
            label: 'OpenAI-compatible',
            value: 'openai-compatible',
            onSelect: () => keys.chooseProvider('openai-compatible'),
          }}
        />
      </div>

      {keys.isCompatible && (
        <>
          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Base URL</span>
            <span className="well-surface flex h-10 items-center gap-2.5 rounded-[10px] px-3">
              <input
                aria-label="Base URL"
                type="url"
                autoComplete="off"
                value={keys.baseUrl}
                maxLength={300}
                placeholder="https://api.example.com/v1"
                onChange={(event) => keys.setBaseUrl(event.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:text-subtle-foreground"
              />
              {keys.baseUrlReachable && (
                <span
                  role="img"
                  aria-label="Reachable"
                  className="size-2 shrink-0 rounded-full bg-online"
                />
              )}
            </span>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Name</span>
            <span className="well-surface flex h-10 items-center rounded-[10px] px-3">
              <input
                aria-label="Name"
                type="text"
                autoComplete="off"
                value={keys.compatibleName}
                maxLength={256}
                placeholder="Together"
                onChange={(event) => keys.setCompatibleName(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
              />
            </span>
          </label>
        </>
      )}
    </div>
  );
}
