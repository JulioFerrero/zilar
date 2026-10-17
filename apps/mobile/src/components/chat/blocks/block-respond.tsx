import type { BlocksRespondValue } from '@zilar/api-contract';
import { createContext, useContext } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';

/**
 * The card answer context (T-1796): the message a card came in with, plus the
 * submit the card shell owns. `BlockCard` provides it from its `respond` prop;
 * with no provider (the catalog, own cards) the controls are drawn disabled.
 */

/** The message identity an answer and its @AI reply need. */
export interface BlockRespondTarget {
  messageId: string;
  chatId: string;
  aiName: string;
  aiJid: string;
  /** A direct chat (T-1825): the reply is plain text, with no mention. */
  direct?: boolean;
}

/**
 * One tap. `reply` is the @AI reply text a decision kind sends after the route
 * succeeds (the label, option, `n/max` or `Label: value` pairs); checklist and
 * poll leave it out. `onSettled` lets an optimistic control revert on failure.
 */
export interface BlockSubmit {
  blockId: string;
  itemId?: string;
  value: BlocksRespondValue;
  reply?: string;
  onSettled?: (ok: boolean) => void;
}

export interface BlockRespondValue extends BlockRespondTarget {
  /** Sends the answer; the card updates from the route's merged data. */
  submit: (request: BlockSubmit) => void;
  pending: boolean;
}

export const BlockRespondContext = createContext<BlockRespondValue | null>(null);

/** Reads the card's answer handle, or null when the card is read-only. */
export function useBlockRespond(): BlockRespondValue | null {
  return useContext(BlockRespondContext);
}

// The choice boards' key, well and track recipes
// (docs/design/mockups/blocks/PhoneChoices.dc.html:25-31), shared by every
// renderer so the five kinds look like one family.
export const KEY_LIGHT: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #ffffff, #d9d9d9)',
  borderWidth: 1,
  borderColor: '#ffffff',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4), 0 2px 6px rgba(0,0,0,.6)',
};

export const KEY_DARK: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #1c1c1c, #121212)',
  borderWidth: 1,
  borderColor: '#2a2a2a',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 2px 6px rgba(0,0,0,.6)',
};

// Typed for both a `View` and a `TextInput` (the form's inputs sit in wells).
export const WELL: ViewStyle & TextStyle = {
  backgroundColor: '#0c0c0c',
  borderWidth: 1,
  borderColor: '#1f1f1f',
  boxShadow:
    'inset 0 2px 6px rgba(0,0,0,.9), inset 0 1px 1px rgba(0,0,0,.8), inset 0 0 0 1px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.06)',
};

export const TRACK: ViewStyle = {
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.05)',
};

export const FILL_LIGHT: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #f5f5f5, #b5b5b5)',
};

export const FILL_DIM: ViewStyle = { backgroundColor: '#3a3a3a' };
