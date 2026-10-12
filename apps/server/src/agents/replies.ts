// The fixed texts an AI sends when a model call fails (AI-3, AI-4) or comes
// back cut at the token cap (AI-5). They are user-facing sentences, never the
// provider body: `mapFailureToReply` in `tool-exec.ts` picks one from the
// failure's status and detail.
export const BUDGET_EXCEEDED_REPLY =
  "I've reached my spending limit for this period. You can raise it in My AIs.";
export const PROVIDER_KEY_REJECTED_REPLY =
  'My provider rejected the API key. Check it under Connections → Test.';
export const TRANSIENT_FAILURE_REPLY = "I couldn't reply just now. Please try again in a minute.";
export const RATE_LIMITED_REPLY = 'My provider is busy right now. Please try again in a minute.';
export const MODEL_NOT_FOUND_REPLY =
  "My model name isn't recognised by the provider. The owner can change it in My AIs.";
export const CONTEXT_TOO_LONG_REPLY =
  'This conversation is too long for my model. Start a new topic or ask me something shorter.';

// AI-5: appended to a reply the provider cut at `max_tokens`, so it does not
// arrive mid-sentence as if it were complete.
export const CUT_SHORT_SUFFIX = '\n\n(cut short; ask me to continue)';

export function cutShortSuffix(finishReason: string | undefined): string {
  return finishReason === 'length' ? CUT_SHORT_SUFFIX : '';
}
