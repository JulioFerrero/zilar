import {
  CHAT_BACKGROUND_PRESET_IDS,
  DEFAULT_CHAT_BACKGROUND_PRESET,
  chatBackgroundPresets,
  chatGrid,
  type ChatBackgroundPresetId,
} from '@zilar/ui-tokens';
import type { CSSProperties } from 'react';

// The slate preset returns no inline style, so --chat-background from index.css still applies.

/** The per-chat columns shared by ChatPref and the global default. */
export interface BackgroundFields {
  backgroundPreset?: string | null | undefined;
  backgroundImageId?: string | null | undefined;
  backgroundDim?: number | null | undefined;
}

export type EffectiveBackground =
  { kind: 'preset'; id: ChatBackgroundPresetId } | { kind: 'image'; imageId: string; dim: number };

/** A dim slider across a wallpaper; 40% by default (plan §8). */
export const DEFAULT_BACKGROUND_DIM = 40;

const PRESET_IDS: readonly string[] = CHAT_BACKGROUND_PRESET_IDS;

function isPresetId(id: string): id is ChatBackgroundPresetId {
  return PRESET_IDS.includes(id);
}

function resolveChoice(
  choice: BackgroundFields | null | undefined,
): EffectiveBackground | undefined {
  if (choice === null || choice === undefined) {
    return undefined;
  }
  if (choice.backgroundPreset !== null && choice.backgroundPreset !== undefined) {
    // An unknown id can only come from a newer server; paint the default instead of nothing.
    return {
      kind: 'preset',
      id: isPresetId(choice.backgroundPreset)
        ? choice.backgroundPreset
        : DEFAULT_CHAT_BACKGROUND_PRESET,
    };
  }
  if (choice.backgroundImageId !== null && choice.backgroundImageId !== undefined) {
    return {
      kind: 'image',
      imageId: choice.backgroundImageId,
      dim: choice.backgroundDim ?? DEFAULT_BACKGROUND_DIM,
    };
  }
  return undefined;
}

/** The chat's look: its own preset or image wins, then the group's shared background, then
 * the caller's global default, else the slate grid. */
export function effectiveBackground(
  pref: BackgroundFields | undefined,
  fallback: BackgroundFields | null,
  group?: BackgroundFields | null,
): EffectiveBackground {
  return (
    resolveChoice(pref) ??
    resolveChoice(group) ??
    resolveChoice(fallback) ?? { kind: 'preset', id: DEFAULT_CHAT_BACKGROUND_PRESET }
  );
}

/** The inline style for an effective look; {} keeps the CSS default. */
export function chatBackgroundStyle(effective: EffectiveBackground): CSSProperties {
  if (effective.kind === 'preset') {
    if (effective.id === DEFAULT_CHAT_BACKGROUND_PRESET) {
      return {};
    }
    const preset = chatBackgroundPresets[effective.id];
    return {
      background: `radial-gradient(${preset.dot} ${chatGrid.dotRadius}px, transparent ${chatGrid.dotRadius}px) 0 0 / ${chatGrid.cell}px ${chatGrid.cell}px ${preset.ground}`,
    };
  }
  const shade = effective.dim / 100;
  return {
    background: `linear-gradient(rgba(0,0,0,${shade}), rgba(0,0,0,${shade})), url("/api/backgrounds/${encodeURIComponent(effective.imageId)}") center / cover no-repeat ${chatGrid.background}`,
  };
}
