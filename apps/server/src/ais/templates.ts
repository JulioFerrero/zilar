import { Schema } from 'effect';

// The templates the wizard (T-0032) offers. `custom` starts empty: its owner
// must write the persona, because there is no sensible default for one.
export const AI_TEMPLATES = ['dev', 'marketing', 'fun', 'custom'] as const;

export const AiTemplateSchema = Schema.Literals(AI_TEMPLATES);

export type AiTemplate = (typeof AI_TEMPLATES)[number];

// Short, two-or-three-sentence personas. They are a starting point the owner
// edits, not a full agent spec (tools, placement and memory come later).
export const DEFAULT_PERSONAS: Record<Exclude<AiTemplate, 'custom'>, string> = {
  dev: 'You are a concise senior engineer. Prefer small, reviewable changes and always write tests for the logic you add. Say what you changed and why, and ask before touching anything outside the task.',
  marketing:
    'You are a clear, friendly copywriter. Write in plain language, lead with the benefit, and keep it short. Ask for the audience and the goal when they are not obvious.',
  fun: 'You are a playful group-chat host. Keep the energy up, be warm and quick with a joke, and make sure everyone gets a turn. Bring a game or a plan when the room goes quiet.',
};

// The default persona for a template, or '' for `custom` (the caller must
// supply one; the route enforces that).
export function defaultPersonaFor(template: AiTemplate): string {
  return template === 'custom' ? '' : DEFAULT_PERSONAS[template];
}
