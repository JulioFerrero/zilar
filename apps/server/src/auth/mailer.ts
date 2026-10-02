import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Logger } from 'pino';
import { OTP_EXPIRES_IN_SECONDS } from './auth';
import type { ServerConfig } from '../config';

export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';

export interface Mailer {
  sendOtp(email: string, code: string, purpose: OtpPurpose): Promise<void>;
}

export class MailerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerConfigurationError';
  }
}

export class MailerDeliveryError extends Error {
  constructor() {
    super('Could not deliver the sign-in email. Please try again.');
    this.name = 'MailerDeliveryError';
  }
}

// Thrown when no mail transport is configured (T-0161): no
// `MAIL_TRANSPORT`/`SMTP_*` env and no stored Resend settings from the
// setup screen. The sign-in hook maps it to a 503 `mail_not_configured`
// response (see `auth/auth.ts`); the message never names a provider or a
// secret.
export class MailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured. Finish the server setup first.');
    this.name = 'MailNotConfiguredError';
  }
}

const CONNECTION_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 20_000;

const SUBJECTS: Record<OtpPurpose, string> = {
  'sign-in': 'Your Zilar sign-in code',
  'email-verification': 'Verify your email',
  'forget-password': 'Reset your Zilar sign-in',
  'change-email': 'Confirm your new email',
};

function validityMinutes(): number {
  return Math.max(1, Math.ceil(OTP_EXPIRES_IN_SECONDS / 60));
}

function buildTextBody(code: string, minutes: number): string {
  return (
    `Your Zilar code is ${code}.\n\n` +
    `It is valid for ${minutes} minutes.\n\n` +
    `If you did not ask for this, ignore this email.`
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function buildHtmlBody(code: string, minutes: number): string {
  return (
    `<p>Your Zilar code is <strong>${escapeHtml(code)}</strong>.</p>` +
    `<p>It is valid for ${minutes} minutes.</p>` +
    `<p>If you did not ask for this, ignore this email.</p>`
  );
}

export interface SmtpTransportFactory {
  (options: SMTPTransport.Options): Transporter;
}

export interface SmtpMailerOptions {
  transportFactory?: SmtpTransportFactory;
  sendTimeoutMs?: number;
}

export class SmtpMailer implements Mailer {
  readonly #transporter: Transporter;
  readonly #logger: Logger;
  readonly #from: string;
  readonly #replyTo: string | undefined;
  readonly #sendTimeoutMs: number;

  constructor(config: ServerConfig, logger: Logger, options: SmtpMailerOptions = {}) {
    if (config.MAIL_TRANSPORT !== 'smtp') {
      throw new MailerConfigurationError('MAIL_TRANSPORT=smtp is required for the SMTP mailer.');
    }
    if (config.SMTP_HOST === undefined) {
      throw new MailerConfigurationError('SMTP_HOST is required when MAIL_TRANSPORT=smtp.');
    }
    if (config.MAIL_FROM === undefined) {
      throw new MailerConfigurationError('MAIL_FROM is required when MAIL_TRANSPORT=smtp.');
    }

    const secure = config.SMTP_SECURE;
    const factory = options.transportFactory ?? createTransport;
    this.#transporter = factory({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure,
      ...(secure ? {} : { requireTLS: true }),
      ...(config.SMTP_USER !== undefined && config.SMTP_PASSWORD !== undefined
        ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
        : {}),
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: CONNECTION_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    });
    this.#logger = logger;
    this.#from = config.MAIL_FROM;
    this.#replyTo = config.MAIL_REPLY_TO;
    this.#sendTimeoutMs = options.sendTimeoutMs ?? SEND_TIMEOUT_MS;
  }

  verifyConnection(): Promise<void> {
    return this.#transporter.verify().then(
      () => undefined,
      (error: unknown) => {
        this.#logger.warn(
          { smtpCode: smtpResponseCode(error) },
          'SMTP connection check failed; mail will be retried on the next send',
        );
      },
    );
  }

  async sendOtp(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    if (!/^\d+$/.test(code)) {
      throw new MailerDeliveryError();
    }
    const minutes = validityMinutes();
    const send = this.#transporter.sendMail({
      from: this.#from,
      to: email,
      subject: SUBJECTS[purpose],
      text: buildTextBody(code, minutes),
      html: buildHtmlBody(code, minutes),
      ...(this.#replyTo === undefined ? {} : { replyTo: this.#replyTo }),
    });
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new MailerDeliveryError()), this.#sendTimeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([send, timeout]);
    } catch (error) {
      if (error instanceof MailerDeliveryError) {
        this.#logger.warn({ purpose }, 'sign-in email delivery timed out');
        throw error;
      }
      this.#logger.warn({ purpose, smtpCode: smtpResponseCode(error) }, 'sign-in email failed');
      throw new MailerDeliveryError();
    }
  }
}

function smtpResponseCode(error: unknown): number | string {
  if (typeof error === 'object' && error !== null && 'responseCode' in error) {
    const code = (error as { responseCode?: unknown }).responseCode;
    if (typeof code === 'number') {
      return code;
    }
  }
  return 'unknown';
}

const CONSOLE_IN_PRODUCTION_WARNING =
  'MAIL_ALLOW_CONSOLE_IN_PRODUCTION is on: sign-in codes are written to the server log. ' +
  'Anyone with log access can sign in as anyone. Use MAIL_TRANSPORT=smtp for any shared install.';

export class ConsoleMailer implements Mailer {
  readonly #logger: Logger;
  readonly #consoleInProduction: boolean;

  constructor(config: ServerConfig, logger: Logger) {
    if (config.MAIL_TRANSPORT === 'smtp') {
      throw new MailerConfigurationError('MAIL_TRANSPORT=smtp needs the SMTP mailer, not console.');
    }
    this.#logger = logger;
    this.#consoleInProduction =
      config.NODE_ENV === 'production' && config.MAIL_ALLOW_CONSOLE_IN_PRODUCTION;
    if (this.#consoleInProduction) {
      logger.warn(CONSOLE_IN_PRODUCTION_WARNING);
    }
  }

  async sendOtp(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    if (this.#consoleInProduction) {
      this.#logger.warn({ purpose }, `[dev-mailer] OTP for ${email}: ${code}`);
      return;
    }
    this.#logger.info({ purpose }, `[dev-mailer] OTP for ${email}: ${code}`);
  }
}

/**
 * The live sign-in mailer while no transport is configured (T-0161): no
 * `MAIL_TRANSPORT`/`SMTP_*` env and no stored Resend settings from the
 * setup screen. The server boots with it in production, and every code
 * send fails with a clear logged error (no secret in it) so the caller
 * can answer 503 `mail_not_configured`.
 */
export class NotConfiguredMailer implements Mailer {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  async sendOtp(_email: string, _code: string, purpose: OtpPurpose): Promise<void> {
    this.#logger.warn(
      { purpose },
      'sign-in email not sent: no mail transport is configured (finish the setup screen)',
    );
    throw new MailNotConfiguredError();
  }
}

/**
 * The single live mailer the auth flow sends through (T-0161). It
 * delegates to the current transport and swaps it without a restart:
 * explicit `MAIL_TRANSPORT`/`SMTP_*` env sets it at boot, otherwise it
 * starts as `NotConfiguredMailer` and the setup screen swaps in the
 * stored Resend mailer on success (and at the next boot, from storage).
 */
export class CurrentMailer implements Mailer {
  #current: Mailer;

  constructor(initial: Mailer) {
    this.#current = initial;
  }

  get configured(): boolean {
    return isTransportConfigured(this.#current);
  }

  use(mailer: Mailer): void {
    this.#current = mailer;
  }

  async sendOtp(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    await this.#current.sendOtp(email, code, purpose);
  }
}

/**
 * Whether a mailer can actually send: anything except the
 * `NotConfiguredMailer` counts (test fakes, console, SMTP, Resend).
 */
export function isTransportConfigured(mailer: Mailer): boolean {
  if (mailer instanceof CurrentMailer) {
    return mailer.configured;
  }
  return !(mailer instanceof NotConfiguredMailer);
}

export const RESEND_SMTP = { host: 'smtp.resend.com', port: 465, user: 'resend' } as const;

// Resend is used through its SMTP endpoint with the existing SMTP mailer:
// the API key is the SMTP password. No new dependency.
export function createResendMailer(
  config: ServerConfig,
  logger: Logger,
  settings: { resendApiKey: string; from: string },
  options: SmtpMailerOptions = {},
): SmtpMailer {
  return new SmtpMailer(
    {
      ...config,
      MAIL_TRANSPORT: 'smtp',
      SMTP_HOST: RESEND_SMTP.host,
      SMTP_PORT: RESEND_SMTP.port,
      SMTP_SECURE: true,
      SMTP_USER: RESEND_SMTP.user,
      SMTP_PASSWORD: settings.resendApiKey,
      MAIL_FROM: settings.from,
    },
    logger,
    options,
  );
}

export function createMailer(config: ServerConfig, logger: Logger): Mailer {
  if (config.MAIL_TRANSPORT === 'smtp') {
    const mailer = new SmtpMailer(config, logger);
    void mailer.verifyConnection();
    return mailer;
  }
  if (config.MAIL_TRANSPORT === 'console') {
    return new ConsoleMailer(config, logger);
  }
  return new NotConfiguredMailer(logger);
}
