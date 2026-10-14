import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// T-1357: every shipped ejabberd config must let mod_push publish a message.
//
// ejabberd 26.07 `mod_push` only publishes when the XEP-0357 summary is
// defined, or when `notify_on` is `all`:
//
//   notify/7 (mod_push.erl):  {make_summary(...), notify_on} = {undefined, messages} -> suppress
//   make_summary/3 (mod_push.erl): {false, false} include_sender/include_body -> undefined
//
// So `notify_on: messages` (T-1155, to silence typing and presence) together
// with the old `include_sender: false` + `include_body: false` (T-0145, to keep
// message text out of the summary) suppressed *every* publish: ejabberd never
// sent a DMs or group notification to the component for a pending or offline
// session. The fix keeps the text out with a static body instead of `false`.
//
// The comment `mod_push` docs themselves recommend this shape: `include_body`
// "can instead be set to a static 'Text' ... without leaking actual message
// contents", and its own default is "New message".

type ModPushOptions = {
  includeSender: string | undefined;
  includeBody: string | undefined;
  notifyOn: string | undefined;
};

const configFiles = ['deploy/ejabberd/ejabberd.yml', 'deploy/baremetal/ejabberd.yml'] as const;

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function readModPush(relativePath: string): ModPushOptions {
  const lines = readFileSync(join(repoRoot, relativePath), 'utf8').split('\n');
  const start = lines.findIndex((line) => line === '  mod_push:');
  if (start < 0) {
    throw new Error(`no top-level mod_push block in ${relativePath}`);
  }
  const options: ModPushOptions = {
    includeSender: undefined,
    includeBody: undefined,
    notifyOn: undefined,
  };
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || line.startsWith('#')) {
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }
    const match = /^ {4}([a-z_]+):\s*(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const [, key, rawValue] = match;
    const value = (rawValue ?? '').trim().replace(/^["']|["']$/g, '');
    if (key === 'include_sender') options.includeSender = value;
    if (key === 'include_body') options.includeBody = value;
    if (key === 'notify_on') options.notifyOn = value;
  }
  return options;
}

// The exact branch in mod_push `notify/7`: a stanza that carries a body
// publishes unless both `include_*` are false and `notify_on` is `messages`.
function publishesMessages(options: ModPushOptions): boolean {
  const summaryDefined = options.includeSender !== 'false' || options.includeBody !== 'false';
  return summaryDefined || (options.notifyOn ?? 'all') !== 'messages';
}

describe('mod_push configuration', () => {
  for (const file of configFiles) {
    it(`${file} lets mod_push publish a message`, () => {
      const options = readModPush(file);
      expect(publishesMessages(options)).toBe(true);
      // Text stays out of the summary: the server component resolves the
      // content itself from the archive, so `include_body` must be a fixed
      // string, never the real body.
      expect(options.includeBody).not.toBe('true');
      expect(options.includeBody).not.toBe('false');
      // Typing and presence stay silent.
      expect(options.notifyOn).toBe('messages');
    });
  }
});
