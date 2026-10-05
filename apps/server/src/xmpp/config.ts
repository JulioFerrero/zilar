import { z } from 'zod';
import { JidSchema } from '@zilar/protocol';

// Lowercase host name (letters, digits, dots, hyphens). No port, no scheme.
const DomainSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/, 'must be a lowercase host name');

// Configuration the XMPP module needs. Env var names are kept as the schema
// keys so error messages can name the variable that is missing or invalid.
export const xmppEnvSchema = z.object({
  EJABBERD_API_URL: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:5280/api'),
  EJABBERD_ADMIN_JID: JidSchema,
  EJABBERD_ADMIN_PASSWORD: z.string().min(1, 'must not be empty'),
  XMPP_DOMAIN: DomainSchema.default('zilar.localhost'),
  XMPP_MUC_DOMAIN: DomainSchema.default('rooms.zilar.localhost'),
  XMPP_WS_PUBLIC_URL: z.url({ protocol: /^wss?$/ }).default('ws://127.0.0.1:5280/ws'),
  ZILAR_XMPP_JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
});

export type XmppEnv = z.infer<typeof xmppEnvSchema>;

export type XmppConfig = {
  apiUrl: string;
  adminJid: string;
  adminPassword: string;
  domain: string;
  mucDomain: string;
  wsPublicUrl: string;
  jwtSecret: string;
};

// Turns a ZodError into one message naming every invalid variable and why.
// Only the field names and Zod's own messages are used, never a value, so a
// secret can never leak through a configuration error.
function formatIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.map(String).join('.');
    return `- ${name === '' ? '(configuration)' : name}: ${issue.message}`;
  });
  return `Invalid XMPP configuration:\n${lines.join('\n')}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function loadXmppConfig(env: Record<string, string | undefined>): XmppConfig {
  const result = xmppEnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(formatIssues(result.error));
  }
  return {
    apiUrl: trimTrailingSlash(result.data.EJABBERD_API_URL),
    adminJid: result.data.EJABBERD_ADMIN_JID,
    adminPassword: result.data.EJABBERD_ADMIN_PASSWORD,
    domain: result.data.XMPP_DOMAIN,
    mucDomain: result.data.XMPP_MUC_DOMAIN,
    wsPublicUrl: result.data.XMPP_WS_PUBLIC_URL,
    jwtSecret: result.data.ZILAR_XMPP_JWT_SECRET,
  };
}
