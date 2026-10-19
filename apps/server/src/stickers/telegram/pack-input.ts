// effect-plain: pure input parsing, no effects.
import { TelegramImportError } from './errors';

const PACK_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

/** Parses the import input: a bare pack name, a
 *  `https://t.me/addstickers/<name>` link (query strings ignored) or a
 *  `tg://addstickers?set=<name>` link; anything else fails `invalid_request`
 *  before any network request. */
export function parseTelegramPackInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '' || /[\s]/.test(trimmed)) {
    throw new TelegramImportError('invalid_request', 'Give a sticker pack link or name');
  }
  const tme = /^https?:\/\/t\.me\/addstickers\/([^\s/?#]+)/i.exec(trimmed);
  if (tme !== null) {
    // A bare path prefix is not enough: `…/FunCats/extra` or a trailing
    // query must not smuggle a second path past the name check.
    const rest = trimmed.slice(tme[0].length);
    if (rest !== '' && !rest.startsWith('?') && !rest.startsWith('#')) {
      throw new TelegramImportError('invalid_request', 'That sticker pack link is not valid');
    }
    return checkPackName(decodeURIComponentSafe(tme[1]!));
  }
  if (/^tg:\/\/addstickers(\?|$)/i.test(trimmed)) {
    const queryStart = trimmed.indexOf('?');
    const params = new URLSearchParams(queryStart === -1 ? '' : trimmed.slice(queryStart + 1));
    return checkPackName(params.get('set') ?? '');
  }
  return checkPackName(trimmed);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new TelegramImportError('invalid_request', 'That sticker pack link is not valid');
  }
}

function checkPackName(name: string): string {
  if (!PACK_NAME_PATTERN.test(name)) {
    throw new TelegramImportError('invalid_request', 'That sticker pack link is not valid');
  }
  return name;
}
