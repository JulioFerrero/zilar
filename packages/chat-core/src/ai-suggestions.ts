const SUGGESTIONS: Record<string, readonly string[]> = {
  dev: ['What can you do?', 'Review my last change', 'Plan a small feature'],
  marketing: ['What can you do?', 'Write a launch post', 'Improve this headline'],
};

const DEFAULT_SUGGESTIONS: readonly string[] = [
  'What can you do?',
  'Summarize a link for me',
  'Help me plan my day',
];

export function aiSuggestions(template: string): readonly string[] {
  return SUGGESTIONS[template] ?? DEFAULT_SUGGESTIONS;
}
