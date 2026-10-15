// effect-plain: the wizard's key-check helpers are plain promise edges over the injected
// connections API (the same shape the flow hook used); they moved here to stay within the
// 400-line cap, and there is no product flow to model as an Effect.
import {
  abandonKeyCheck,
  buildCreateBody,
  buildPatch,
  type AiCreateFields,
  type KeyCheckApi,
  type KeyCheckResult,
  type KeyCheckState,
} from '@zilar/chat-core';

import type { AiLimits, CreateAiInput } from '../../lib/ais-api';

// T-0876: the create/patch builders live in @zilar/chat-core and are shared
// with web. The wizard form is the shared create fields.
// T-1445: the New AI wizard's pure key-check helpers live here too, so the flow
// hook stays inside the 400-line cap.
export type WizardForm = AiCreateFields;
export { buildPatch };

export function buildCreateInput(form: WizardForm, limits: AiLimits | null): CreateAiInput | null {
  return buildCreateBody(form, limits);
}

export const EMPTY_KEY_STATE: KeyCheckState = {
  connectionId: null,
  created: false,
  verified: false,
};

/** A typed key starts a fresh connection (never a saved one); ours is reused on a retry. */
export function keyCheckBaseState(keyValue: string, state: KeyCheckState): KeyCheckState {
  return keyValue.trim() !== '' && !state.created ? EMPTY_KEY_STATE : state;
}

/** T-1445: a compatible-field edit (Base URL or Name) always ends in the empty key state. */
export function keyStateAfterBaseUrlEdit(state: KeyCheckState): KeyCheckState {
  return state.created || state.verified ? EMPTY_KEY_STATE : state;
}

/** T-1445: a Base URL edit deletes the connection this flow made for the old URL. */
export async function dropCreatedKey(api: KeyCheckApi, state: KeyCheckState): Promise<void> {
  if (!state.created || !state.verified || state.connectionId === null) return;
  await api.deleteConnection(state.connectionId).catch(() => undefined);
}

/** T-1445: drops whatever this flow created — a verified connection is deleted, an
 * unverified one abandoned; a saved key (`created: false`) is never deleted. */
export async function discardCreatedKey(api: KeyCheckApi, state: KeyCheckState): Promise<void> {
  await dropCreatedKey(api, state);
  await abandonKeyCheck(api, state);
}

/** T-1445: a settled check counts only while latest; else its connection is abandoned. */
export async function settleNewAiKeyCheck(
  api: KeyCheckApi,
  token: number,
  current: number,
  result: KeyCheckResult,
): Promise<boolean> {
  if (token === current) return true;
  await discardCreatedKey(api, result);
  return false;
}
