import { Check } from 'lucide-react';
import { CHAT_BACKGROUND_PRESET_IDS, type ChatBackgroundPresetId } from '@zilar/ui-tokens';
import { chatBackgroundStyle } from '@/lib/chatBackground';
import { cn } from '@/lib/utils';
import { presetLabel } from './backgroundOps';

export function PresetGrid({
  selected,
  onChoose,
}: {
  selected: string | null;
  onChoose: (id: ChatBackgroundPresetId) => void;
}) {
  return (
    <div className="mt-4 grid grid-cols-4 gap-3">
      {CHAT_BACKGROUND_PRESET_IDS.map((id) => {
        const isSelected = selected === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={presetLabel(id)}
            aria-pressed={isSelected}
            onClick={() => onChoose(id)}
            className={cn(
              'chat-background relative aspect-square rounded-[10px] border transition-shadow',
              isSelected ? 'border-accent ring-2 ring-accent/40' : 'border-border',
            )}
            style={chatBackgroundStyle({ kind: 'preset', id })}
          >
            {isSelected && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Check className="size-5 text-white" aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
