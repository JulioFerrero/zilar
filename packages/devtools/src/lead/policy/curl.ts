function isLocalhostUrl(token: string): boolean {
  const match = /^https?:\/\/([^/:]+)/i.exec(token);
  if (match === null) {
    return false;
  }
  const host = (match[1] as string).toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

const CURL_SHORT_VALUE = new Set([
  'X',
  'd',
  'F',
  'T',
  'o',
  'K',
  'u',
  'H',
  'b',
  'c',
  'e',
  'm',
  'A',
  'x',
  'w',
]);
const CURL_SHORT_BOOL = new Set([
  's',
  'S',
  'f',
  'L',
  'I',
  'i',
  'v',
  'k',
  'q',
  'N',
  'g',
  'l',
  'G',
  '0',
  '1',
  '2',
  '3',
  '4',
  '6',
  '#',
]);
const CURL_LONG_VALUE_OK = new Set([
  'referer',
  'max-time',
  'connect-timeout',
  'max-redirs',
  'retry',
  'retry-delay',
  'limit-rate',
  'user-agent',
  'write-out',
  'resolve',
  'connect-to',
  'proxy',
  'cacert',
  'capath',
]);
const CURL_LONG_BOOL_OK = new Set([
  'silent',
  'show-error',
  'fail',
  'fail-with-body',
  'location',
  'location-trusted',
  'head',
  'include',
  'verbose',
  'no-verbose',
  'insecure',
  'ipv4',
  'ipv6',
  'no-buffer',
  'compressed',
  'http1.0',
  'http1.1',
  'http2',
  'get',
  'globoff',
  'path-as-is',
  'progress-bar',
  'no-progress-meter',
  'create-dirs',
  'remove-on-error',
  'fail-early',
]);

function hasAuthOrCookie(value: string | undefined): boolean {
  return value === undefined || /authorization|cookie/i.test(value);
}

// True only for a read-only GET that prints to stdout: no request override
// (other than GET/HEAD), no body, no file output, no config file, no
// credentials. Combined short flags (`-sXPOST`) and `--opt=value` forms are
// parsed. Anything unrecognized fails closed.
export function isReadOnlyCurl(args: string[]): boolean {
  let sawUrl = false;
  let i = 0;
  const next = (): string | undefined => {
    i += 1;
    return args[i];
  };
  while (i < args.length) {
    const token = args[i] as string;
    if (token === '--') {
      i += 1;
      while (i < args.length) {
        if (!isLocalhostUrl(args[i] as string)) {
          return false;
        }
        sawUrl = true;
        i += 1;
      }
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).toLowerCase();
      const attached = eq === -1 ? null : token.slice(eq + 1);
      if (name === 'request') {
        const method = (attached ?? next() ?? '').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
          return false;
        }
      } else if (name === 'header') {
        if (hasAuthOrCookie(attached ?? next())) {
          return false;
        }
      } else if (
        name === 'data' ||
        name.startsWith('data-') ||
        name === 'json' ||
        name === 'form' ||
        name.startsWith('form-') ||
        name === 'upload-file' ||
        name === 'config' ||
        name === 'user' ||
        name === 'cookie' ||
        name === 'cookie-jar' ||
        name === 'netrc' ||
        name === 'netrc-file' ||
        name === 'netrc-optional' ||
        name === 'cert' ||
        name === 'key' ||
        name === 'pass'
      ) {
        return false;
      } else if (name === 'output') {
        if ((attached ?? next()) !== '-') {
          return false;
        }
      } else if (
        name === 'remote-name' ||
        name === 'remote-name-all' ||
        name === 'remote-header-name' ||
        name === 'output-dir'
      ) {
        return false;
      } else if (CURL_LONG_VALUE_OK.has(name)) {
        if (attached === null) {
          next();
        }
      } else if (!CURL_LONG_BOOL_OK.has(name)) {
        return false;
      }
      i += 1;
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      let j = 1;
      while (j < token.length) {
        const flag = token[j] as string;
        if (flag === 'n') {
          return false;
        }
        if (CURL_SHORT_VALUE.has(flag)) {
          const attached = token.slice(j + 1);
          const value = attached.length > 0 ? attached : next();
          if (flag === 'X') {
            const method = (value ?? '').toUpperCase();
            if (method !== 'GET' && method !== 'HEAD') {
              return false;
            }
          } else if (flag === 'o') {
            if (value !== '-') {
              return false;
            }
          } else if (flag === 'H') {
            if (hasAuthOrCookie(value)) {
              return false;
            }
          } else if (
            flag === 'd' ||
            flag === 'F' ||
            flag === 'T' ||
            flag === 'K' ||
            flag === 'u' ||
            flag === 'b' ||
            flag === 'c'
          ) {
            return false;
          }
          // e, m, A, x, w take a harmless value, already consumed.
          break;
        }
        if (!CURL_SHORT_BOOL.has(flag)) {
          return false;
        }
        j += 1;
      }
      i += 1;
      continue;
    }
    // Positional: must be a localhost URL (a lone `-` means stdin: reject).
    if (!isLocalhostUrl(token)) {
      return false;
    }
    sawUrl = true;
    i += 1;
  }
  return sawUrl;
}

// wget's smaller cousin: no POST-ish method or body, no output file.
export function isReadOnlyWget(args: string[]): boolean {
  let sawUrl = false;
  let i = 0;
  while (i < args.length) {
    const token = args[i] as string;
    if (token === '-O' || token === '--output-document') {
      if (args[i + 1] !== '-') {
        return false;
      }
      i += 2;
      continue;
    }
    if (/^-[a-zA-Z0-9]*O/.test(token)) {
      const rest = token.slice(token.indexOf('O') + 1);
      const value = rest.length > 0 ? rest : args[i + 1];
      if (value !== '-') {
        return false;
      }
      i += rest.length > 0 ? 1 : 2;
      continue;
    }
    if (token.startsWith('--output-document=')) {
      if (token.slice('--output-document='.length) !== '-') {
        return false;
      }
      i += 1;
      continue;
    }
    if (
      token === '--post-data' ||
      token === '--post-file' ||
      token === '--body-data' ||
      token === '--body-file'
    ) {
      return false;
    }
    if (token === '--method') {
      const method = (args[i + 1] ?? '').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        return false;
      }
      i += 2;
      continue;
    }
    if (token.startsWith('--method=')) {
      const method = token.slice('--method='.length).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        return false;
      }
      i += 1;
      continue;
    }
    if (token.startsWith('--') && token.includes('=')) {
      const name = token.slice(2, token.indexOf('=')).toLowerCase();
      if (name !== 'tries' && name !== 'timeout' && name !== 'wait' && name !== 'limit-rate') {
        return false;
      }
      i += 1;
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      i += 1;
      continue;
    }
    if (!isLocalhostUrl(token)) {
      return false;
    }
    sawUrl = true;
    i += 1;
  }
  return sawUrl;
}
