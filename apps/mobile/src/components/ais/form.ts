// effect-plain: the wizard form is plain data over the shared create body builders; the key-check helpers live in @zilar/client-core.
import { buildCreateBody, buildPatch, type AiCreateFields } from '@zilar/chat-core';

import type { AiLimits, CreateAiInput } from '../../lib/ais-api';

export type WizardForm = AiCreateFields;
export { buildPatch };
export {
  EMPTY_KEY_STATE,
  discardCreatedKey,
  dropCreatedKey,
  keyCheckBaseState,
  keyStateAfterBaseUrlEdit,
  settleNewAiKeyCheck,
} from '@zilar/client-core';

export function buildCreateInput(form: WizardForm, limits: AiLimits | null): CreateAiInput | null {
  return buildCreateBody(form, limits);
}
