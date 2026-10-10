import type { AiTemplate } from '@/lib/api';

// T-0876: the create/patch builders live in @zilar/chat-core and are shared
// with mobile; this file keeps the web form shape (it also holds the limit text).
export {
  buildCreateBody,
  buildPatch,
  DEFAULT_DAILY_USD,
  DEFAULT_MONTHLY_USD,
} from '@zilar/chat-core';

/** The form fields shared by the create dialog and the edit panel. */
export interface AiFormState {
  name: string;
  template: AiTemplate;
  persona: string;
  /** Whether the persona differs from the template default. */
  personaTouched: boolean;
  providerConnectionId: string | null;
  model: string;
  day: string;
  month: string;
}
