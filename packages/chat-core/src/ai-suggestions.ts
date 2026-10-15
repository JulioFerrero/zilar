// The chips an AI's empty chat offers, by template
// (docs/design/mockups/empty-chat/Main.dc.html). Web (T-1511) and phone share
// this one list, so a new template's chips never drift between the apps.

const SUGGESTIONS: Record<string, readonly string[]> = {
  dev: ['What can you do?', 'Review my last change', 'Plan a small feature'],
  marketing: ['What can you do?', 'Write a launch post', 'Improve this headline'],
};

const DEFAULT_SUGGESTIONS: readonly string[] = [
  'What can you do?',
  'Summarize a link for me',
  'Help me plan my day',
];

/** The chips for an AI's template; an unknown template gets the default list. */
export function aiSuggestions(template: string): readonly string[] {
  return SUGGESTIONS[template] ?? DEFAULT_SUGGESTIONS;
}
