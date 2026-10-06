import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/text-input';
import { copyText } from '@/lib/clipboard';
import type { GroupInviteLink } from '@/lib/api';

function linkState(
  link: GroupInviteLink,
  now: number,
): 'active' | 'expired' | 'exhausted' | 'revoked' {
  if (link.revoked) {
    return 'revoked';
  }
  if (link.expiresAt !== null && Date.parse(link.expiresAt) <= now) {
    return 'expired';
  }
  if (link.maxUses !== null && link.uses >= link.maxUses) {
    return 'exhausted';
  }
  return 'active';
}

function describeLink(link: GroupInviteLink, now: number): string {
  const state = linkState(link, now);
  const used = link.maxUses === null ? `${link.uses} uses` : `${link.uses}/${link.maxUses} uses`;
  const expiry =
    link.expiresAt === null
      ? 'never expires'
      : `expires ${new Date(link.expiresAt).toLocaleString()}`;
  const name = link.label === null || link.label === '' ? `····${link.tokenHint}` : link.label;
  return state === 'active'
    ? `${name} — ${used}, ${expiry}`
    : `${name} — ${used}, ${expiry}, ${state}`;
}

/**
 * The group invite-links section (T-0115): owners and admins create a link
 * (label, expiry, max uses), see the URL once with a Copy button and a
 * warning that anyone with the link can join, and list/revoke links.
 */
export function InviteLinksSection({
  links,
  busy,
  error,
  created,
  onCreate,
  onRevoke,
  onDismissCreated,
}: {
  links: GroupInviteLink[];
  busy: boolean;
  error: string | undefined;
  created: { url: string } | undefined;
  onCreate: (input: { label?: string; expiresInHours?: number; maxUses?: number }) => void;
  onRevoke: (linkId: string) => void | Promise<void>;
  onDismissCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = label.trim();
    if (trimmed.length > 60) {
      setFormError('The label must be at most 60 characters.');
      return;
    }
    const expiresInHours = expiry === '' ? undefined : Number(expiry);
    if (
      expiresInHours !== undefined &&
      (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 8760)
    ) {
      setFormError('Expiry must be 1 to 8760 hours.');
      return;
    }
    const max = maxUses === '' ? undefined : Number(maxUses);
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 10000)) {
      setFormError('Max uses must be 1 to 10000.');
      return;
    }
    setFormError(undefined);
    onCreate({
      ...(trimmed === '' ? {} : { label: trimmed }),
      ...(expiresInHours === undefined ? {} : { expiresInHours }),
      ...(max === undefined ? {} : { maxUses: max }),
    });
  };

  const copy = (): void => {
    if (created === undefined) {
      return;
    }
    void copyText(created.url).then(() => setCopied(true));
  };

  const revoke = async (linkId: string): Promise<void> => {
    setRevokingId(linkId);
    // The parent owns the request and its error; the busy mark clears when
    // its promise settles (success or failure) so a failed revoke never
    // sticks on "Revoking…" (the error renders from the parent's `error`
    // prop). Awaiting the parent's DELETE keeps the button busy until the
    // request settles instead of clearing on the next microtask.
    try {
      await onRevoke(linkId);
    } finally {
      setRevokingId((current) => (current === linkId ? undefined : current));
    }
  };
  return (
    <section aria-label="Invite links" className="flex flex-col gap-2 px-2">
      <h2 className="px-2 text-[13px] font-semibold text-muted-foreground">Invite links</h2>

      {created !== undefined && (
        <div className="flex flex-col gap-2 rounded-xl border border-border-strong bg-surface-raised p-3">
          <p className="text-[13px] font-medium">Share this link</p>
          <div className="flex items-center gap-2 rounded-lg border border-divider bg-muted px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px]">{created.url}</span>
            <Button
              type="button"
              aria-label="Copy invite link"
              onClick={copy}
              size="sm"
              className="shrink-0"
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Anyone with this link can join the group. It is shown once — copy it now.
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={onDismissCreated}
            className="self-start px-0 text-accent"
          >
            Done
          </Button>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl px-2 py-1">
        <TextInput
          value={label}
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Friends"
          label="Label (optional, up to 60 characters)"
          aria-label="Link label"
        />
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              value={expiry}
              inputMode="numeric"
              onChange={(event) => setExpiry(event.target.value)}
              placeholder="e.g. 48"
              label="Expires in (hours, optional)"
              aria-label="Expiry in hours"
            />
          </div>
          <div className="min-w-0 flex-1">
            <TextInput
              value={maxUses}
              inputMode="numeric"
              onChange={(event) => setMaxUses(event.target.value)}
              placeholder="e.g. 10"
              label="Max uses (optional)"
              aria-label="Max uses"
            />
          </div>
        </div>
        <Button type="submit" disabled={busy} className="self-start">
          {busy ? 'Creating…' : 'Create invite link'}
        </Button>
        {formError !== undefined && (
          <p role="alert" className="text-[13px] text-danger">
            {formError}
          </p>
        )}
        {error !== undefined && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </form>

      <LinkStatesList links={links} revokingId={revokingId} onRevoke={revoke} />
    </section>
  );
}

function LinkStatesList({
  links,
  revokingId,
  onRevoke,
}: {
  links: GroupInviteLink[];
  revokingId: string | undefined;
  onRevoke: (linkId: string) => void | Promise<void>;
}) {
  // Fixed at mount: the expired/exhausted labels only re-render with the
  // list itself (the parent reloads after create/revoke).
  const [now] = useState(() => Date.now());
  if (links.length === 0) {
    return <p className="px-2 text-[13px] text-muted-foreground">No invite links yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {links.map((link) => {
        const state = linkState(link, now);
        const revoking = revokingId === link.id;
        return (
          <li
            key={link.id}
            className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-list-hover"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]">
                {link.label === null || link.label === '' ? (
                  <span className="font-mono">····{link.tokenHint}</span>
                ) : (
                  link.label
                )}
              </p>
              <p className="truncate text-[12px] text-muted-foreground">
                {describeLink(link, now)}
              </p>
            </div>
            {state !== 'revoked' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Revoke invite link ${link.label ?? link.tokenHint}`}
                disabled={revoking}
                onClick={() => onRevoke(link.id)}
                className="shrink-0"
              >
                {revoking ? 'Revoking…' : 'Revoke'}
              </Button>
            ) : (
              <span className="shrink-0 px-2 text-[12px] text-muted-foreground">revoked</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
