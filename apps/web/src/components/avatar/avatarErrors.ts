/** The fixed user-facing sentence for an upload or remove failure. */
export function friendlyUploadError(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    switch (code) {
      case 'avatar_empty':
        return 'The picture file is empty.';
      case 'avatar_too_large':
        return 'The picture is larger than 256 KiB. Try a smaller file.';
      case 'avatar_animated':
        return 'The picture must be a still image, not an animation.';
      case 'avatar_not_square':
        return 'The picture must be square.';
      case 'avatar_bad_size':
        return 'The picture must be between 64 and 512 pixels on each side.';
      case 'avatar_not_image':
        return 'That file is not a supported picture. Choose a PNG or WebP image.';
      case 'rate_limited':
        return 'Too many uploads — wait a little and try again.';
      case 'network_error':
        return 'Could not reach the server. Try again.';
      default:
        break;
    }
    if (typeof (error as { message?: unknown }).message === 'string') {
      return (error as unknown as { message: string }).message;
    }
  }
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return 'Could not save the picture. Try again.';
}
