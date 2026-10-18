// `undefined` means the code is not a handle code, so the caller keeps its own fallback.
export function handleSaveMessage(
  error: { code: string; message: string; nextChangeAt?: string | undefined },
  noun: 'username' | 'handle',
): string | undefined {
  switch (error.code) {
    case 'handle_invalid':
      return 'Use 3–32 characters: letters, numbers and _, starting with a letter.';
    case 'handle_reserved':
      return `That ${noun} is reserved. Try another.`;
    case 'handle_taken':
      return `That ${noun} was just taken. Try another.`;
    case 'handle_change_too_soon': {
      if (error.nextChangeAt !== undefined && error.nextChangeAt !== '') {
        const date = new Date(error.nextChangeAt);
        if (!Number.isNaN(date.getTime())) {
          return `Next change possible on ${date.toLocaleDateString()}`;
        }
      }
      return error.message;
    }
    case 'rate_limited':
      return 'Too many tries — wait a little and try again.';
    default:
      return undefined;
  }
}
