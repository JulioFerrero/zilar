import type { AiTemplate } from '../../lib/ais-api';

// Display copy for the Create an AI wizard. The four default personas mirror
// apps/server/src/ais/templates.ts, which is the source of truth: if a server
// persona changes, update these strings too.
export interface AiTemplateOption {
  id: AiTemplate;
  label: string;
  description: string;
  defaultPersona: string;
}

export const AI_TEMPLATE_OPTIONS: readonly AiTemplateOption[] = [
  {
    id: 'dev',
    label: 'Dev',
    description: 'A concise engineer who writes tests',
    defaultPersona:
      'You are a concise senior engineer. Prefer small, reviewable changes and always write tests for the logic you add. Say what you changed and why, and ask before touching anything outside the task.',
  },
  {
    id: 'marketing',
    label: 'Marketing',
    description: 'A clear, friendly copywriter',
    defaultPersona:
      'You are a clear, friendly copywriter. Write in plain language, lead with the benefit, and keep it short. Ask for the audience and the goal when they are not obvious.',
  },
  {
    id: 'fun',
    label: 'Fun',
    description: 'A playful group-chat host',
    defaultPersona:
      'You are a playful group-chat host. Keep the energy up, be warm and quick with a joke, and make sure everyone gets a turn. Bring a game or a plan when the room goes quiet.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Write the persona yourself',
    defaultPersona: '',
  },
];

export function defaultPersonaFor(template: AiTemplate): string {
  return AI_TEMPLATE_OPTIONS.find((option) => option.id === template)?.defaultPersona ?? '';
}

export function templateLabel(template: AiTemplate): string {
  return AI_TEMPLATE_OPTIONS.find((option) => option.id === template)?.label ?? template;
}
