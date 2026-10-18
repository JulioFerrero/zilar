// effect-plain: the wizard's key-check helpers are plain promise edges over the injected connections API; there is no product flow to model as an Effect.
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

export function keyStateAfterBaseUrlEdit(state: KeyCheckState): KeyCheckState {
  return state.created || state.verified ? EMPTY_KEY_STATE : state;
}

/** A Base URL edit deletes the connection this flow made for the old URL. */
export async function dropCreatedKey(api: KeyCheckApi, state: KeyCheckState): Promise<void> {
  if (!state.created || !state.verified || state.connectionId === null) return;
  await api.deleteConnection(state.connectionId).catch(() => undefined);
}

/** A verified connection is deleted, an unverified one abandoned; a saved key (`created: false`) is never deleted. */
export async function discardCreatedKey(api: KeyCheckApi, state: KeyCheckState): Promise<void> {
  await dropCreatedKey(api, state);
  await abandonKeyCheck(api, state);
}

/** A settled check counts only while latest; else its connection is abandoned. */
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
