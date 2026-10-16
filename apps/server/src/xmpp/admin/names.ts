import { Exit, Schema } from 'effect';
import { JidSchema, isValid } from '@zilar/protocol';
import { firstIssueMessage } from '../../effect/schema-issues';
import { NameSchema } from './schemas';

export function parseName(value: string, label: string): string {
  const exit = Schema.decodeUnknownExit(NameSchema)(value);
  if (Exit.isFailure(exit)) {
    let message: string | undefined;
    for (const reason of exit.cause.reasons) {
      if (reason._tag === 'Fail') {
        message = firstIssueMessage(reason.error.issue);
        break;
      }
    }
    throw new Error(`${label} "${value}" is invalid: ${message ?? 'invalid'}`);
  }
  return exit.value;
}

export function splitBareJid(value: string): { user: string; host: string } {
  if (!isValid(JidSchema)(value)) {
    throw new Error(`jid "${value}" is invalid`);
  }
  const at = value.indexOf('@');
  return { user: value.slice(0, at), host: value.slice(at + 1) };
}

// A JID that may carry a resource (a full JID), for `send_stanza`.
export function parseJid(value: string, label: string): string {
  if (!isValid(JidSchema)(value)) {
    throw new Error(`${label} jid "${value}" is invalid`);
  }
  return value;
}
