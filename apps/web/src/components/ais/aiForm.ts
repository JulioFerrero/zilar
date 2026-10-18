import type { AiTemplate } from '@/lib/api';

export { buildCreateBody, buildPatch } from '@zilar/chat-core';

export interface AiFormState {
  name: string;
  template: AiTemplate;
  persona: string;
  personaTouched: boolean;
  providerConnectionId: string | null;
  model: string;
  day: string;
  month: string;
}
