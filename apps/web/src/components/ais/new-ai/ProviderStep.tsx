import { Combobox } from '@/components/ui/combobox';
import type { NewAiFlow } from './useNewAiFlow';

/** Step 1: the provider, with an OpenAI-compatible endpoint at the bottom. */
export function ProviderStep({ flow }: { flow: NewAiFlow }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Provider</span>
        <Combobox
          label="Provider"
          options={flow.providerChoices
            .filter((choice) => choice.id !== 'openai-compatible')
            .map((choice) => ({
              value: choice.id,
              label: choice.label,
              ...(choice.hasKey ? { dot: 'online' as const } : {}),
            }))}
          value={flow.providerId}
          onValueChange={flow.chooseProvider}
          placeholder="Search providers"
          triggerPlaceholder="Choose a provider"
          footerItem={{
            label: 'OpenAI-compatible',
            onSelect: () => flow.chooseProvider('openai-compatible'),
          }}
        />
      </div>

      {flow.isCompatible && (
        <>
          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">Base URL</span>
            <span className="well-surface flex h-10 items-center gap-2.5 rounded-[10px] px-3">
              <input
                aria-label="Base URL"
                type="url"
                autoComplete="off"
                value={flow.baseUrl}
                maxLength={300}
                placeholder="https://api.example.com/v1"
                onChange={(event) => flow.setBaseUrl(event.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:text-subtle-foreground"
              />
              {flow.baseUrlReachable && (
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
                value={flow.compatibleName}
                maxLength={256}
                placeholder="Together"
                onChange={(event) => flow.setCompatibleName(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
              />
            </span>
          </label>
        </>
      )}
    </div>
  );
}
