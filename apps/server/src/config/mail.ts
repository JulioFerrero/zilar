// Mail transport and GitHub App cross-field rules. Every issue names the variable and
// states what is wrong, never the value, so `SMTP_PASSWORD` cannot leak through an error.

export interface ConfigDetail {
  readonly name: string;
  readonly reason: string;
}

export function crossFieldDetails(
  env: Record<string, string | undefined>,
): ReadonlyArray<ConfigDetail> {
  const details: ConfigDetail[] = [];

  const githubEntries = [
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
    env.GITHUB_APP_INSTALLATION_ID,
  ];
  const present = githubEntries.map((entry) => entry !== undefined);
  if (present.some(Boolean) && !present.every(Boolean)) {
    details.push({
      name: '',
      reason:
        'GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID must be set together',
    });
  }

  if (env.MAIL_TRANSPORT === 'smtp') {
    const fail = (reason: string): void => {
      details.push({ name: 'MAIL_TRANSPORT', reason });
    };
    if (env.SMTP_HOST === undefined) {
      fail('SMTP_HOST is required when MAIL_TRANSPORT=smtp');
    }
    if (env.MAIL_FROM === undefined) {
      fail('MAIL_FROM is required when MAIL_TRANSPORT=smtp');
    }
    const userSet = env.SMTP_USER !== undefined;
    const passwordSet = env.SMTP_PASSWORD !== undefined;
    if (userSet !== passwordSet) {
      fail('SMTP_USER and SMTP_PASSWORD must be set together');
    }
    for (const [name, mailbox] of [
      ['MAIL_FROM', env.MAIL_FROM],
      ['MAIL_REPLY_TO', env.MAIL_REPLY_TO],
    ] as const) {
      if (mailbox !== undefined && !isMailbox(mailbox)) {
        details.push({
          name,
          reason: `${name} must be a valid mailbox (for example: Zilar <no-reply@example.com>)`,
        });
      }
    }
  }

  return details;
}

// A bare address or a display name plus angle-addr; enough to catch a typo in MAIL_FROM
// at startup without a mail parser.
function isMailbox(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('\n') || trimmed.includes('\r')) {
    return false;
  }
  const angle = trimmed.match(/^(.*)<([^<>]+)>$/);
  const address = (angle?.[2] ?? trimmed).trim();
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(address);
}
