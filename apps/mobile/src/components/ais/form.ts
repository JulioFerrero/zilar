import { buildCreateBody, buildPatch, type AiCreateFields } from '@zilar/chat-core';

import type { AiLimits, CreateAiInput } from '../../lib/ais-api';

// T-0876: the create/patch builders live in @zilar/chat-core and are shared
// with web. The wizard form is the shared create fields.
export type WizardForm = AiCreateFields;
export { buildPatch };

export function buildCreateInput(form: WizardForm, limits: AiLimits | null): CreateAiInput | null {
  return buildCreateBody(form, limits);
}
