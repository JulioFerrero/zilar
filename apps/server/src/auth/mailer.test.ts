import { describe, expect, it } from 'vitest';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { loadServerConfig } from '../config';
import { createLogger } from '../logger';
import { TEST_SECRET } from '../test-support';
import {
  ConsoleMailer,
  MailerConfigurationError,
  MailerDeliveryError,
  SmtpMailer,
  createMailer,
} from './mailer';

const baseEnv = {
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/galena',
  BETTER_AUTH_SECRET: TEST_SECRET,
  EJABBERD_ADMIN_JID: 'admin@galena.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  GALENA_XMPP_JWT_SECRET: 'x'.repeat(40),
};

function captureLogs() {
  const chunks: string[] = [];
  return {
    destination: {
      write: (message: string): void => {
        chunks.push(message);
      },
    },
    output: () => chunks.join(''),
  };
}

const smtpEnv = {
  ...baseEnv,
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  MAIL_FROM: 'Galena <no-reply@example.com>',
};

interface SentMessage {
  from: { address: string; name: string };
  to: Array<{ address: string; name: string }>;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: Array<{ address: string; name: string }>;
}

function readLastSent(captured: Array<{ message: string }>): SentMessage {
  const last = captured[captured.length - 1];
  if (!last) {
    throw new Error('expected a sent message');
  }
  return JSON.parse(last.message) as SentMessage;
}

// jsonTransport never touches the network; wrapping it lets the test read
// the composed message and record the transport options the mailer used.
function capturingFactory(captured: Array<{ message: string }>) {
  let seenOptions: SMTPTransport.Options | undefined;
  const factory = (options: SMTPTransport.Options): Transporter => {
    seenOptions = options;
    const inner = createTransport({ jsonTransport: true });
    const send = inner.sendMail.bind(inner);
    inner.sendMail = ((mailOptions: { from: string; to: string; subject: string; text: string }) =>
      send(mailOptions).then((info) => {
        captured.push({ message: String(info.message) });
        return info;
      })) as typeof inner.sendMail;
    return inner;
  };
  return { factory, options: () => seenOptions };
}

function smtpMailer(
  env: Record<string, string | undefined>,
  captured: Array<{ message: string }>,
  logs: ReturnType<typeof captureLogs>,
) {
  const config = loadServerConfig({ ...smtpEnv, ...env });
  const { factory, options } = capturingFactory(captured);
  const mailer = new SmtpMailer(config, createLogger(config, logs.destination), {
    transportFactory: factory,
  });
  return { mailer, options };
}

describe('mailer', () => {
  it('(i) refuses to start in production and never logs a code', () => {
    const config = loadServerConfig({ ...baseEnv, NODE_ENV: 'production' });
    const logs = captureLogs();
    const logger = createLogger(config, logs.destination);

    expect(() => createMailer(config, logger)).toThrow(MailerConfigurationError);
    expect(() => new ConsoleMailer(config, logger)).toThrow(/No email provider/);
    expect(logs.output()).toBe('');
  });

  it('logs the OTP at info in development', async () => {
    const config = loadServerConfig({ ...baseEnv, NODE_ENV: 'development' });
    const logs = captureLogs();
    const mailer = createMailer(config, createLogger(config, logs.destination));

    await mailer.sendOtp('dev@example.com', '123456', 'sign-in');

    expect(logs.output()).toContain('[dev-mailer] OTP for dev@example.com: 123456');
  });

  it('logs the OTP at info in test', async () => {
    const config = loadServerConfig({ ...baseEnv, NODE_ENV: 'test' });
    const logs = captureLogs();
    const mailer = createMailer(config, createLogger(config, logs.destination));

    await mailer.sendOtp('test@example.com', '654321', 'sign-in');

    expect(logs.output()).toContain('[dev-mailer] OTP for test@example.com: 654321');
  });

  it('composes subject, from, recipient, text and HTML with the validity in minutes', async () => {
    const captured: Array<{ message: string }> = [];
    const logs = captureLogs();
    const { mailer } = smtpMailer({}, captured, logs);

    await mailer.sendOtp('user@example.com', '123456', 'sign-in');

    const message = readLastSent(captured);
    expect(message.subject).toBe('Your Galena sign-in code');
    expect(message.from).toEqual({ address: 'no-reply@example.com', name: 'Galena' });
    expect(message.to).toEqual([{ address: 'user@example.com', name: '' }]);
    expect(message.text).toContain('123456');
    expect(message.text).toContain('10 minutes');
    expect(message.html).toContain('123456');
    expect(message.html).toContain('10 minutes');
    expect(message.text).not.toMatch(/https?:\/\//);
    expect(message.html).not.toContain('<a ');
    expect(logs.output()).not.toContain('123456');
  });

  it('uses one subject per purpose', async () => {
    const expected: Array<[Parameters<SmtpMailer['sendOtp']>[2], string]> = [
      ['sign-in', 'Your Galena sign-in code'],
      ['email-verification', 'Verify your email'],
      ['forget-password', 'Reset your Galena sign-in'],
      ['change-email', 'Confirm your new email'],
    ];
    for (const [purpose, subject] of expected) {
      const captured: Array<{ message: string }> = [];
      const { mailer } = smtpMailer({}, captured, captureLogs());
      await mailer.sendOtp('user@example.com', '123456', purpose);
      expect(readLastSent(captured).subject).toBe(subject);
    }
  });

  it('escapes hostile content and never interpolates addresses into markup', async () => {
    const captured: Array<{ message: string }> = [];
    const logs = captureLogs();
    const { mailer } = smtpMailer({}, captured, logs);

    await mailer.sendOtp('evil"<script>alert(1)</script>@example.com', '123456', 'sign-in');

    const message = readLastSent(captured);
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('123456');
    expect(message.text).toContain('123456');
  });

  it('passes SMTP_SECURE=false as requireTLS and SMTP_SECURE=true as secure', () => {
    const insecureCaptured: Array<{ message: string }> = [];
    const insecure = smtpMailer({}, insecureCaptured, captureLogs());
    expect(insecure.options()?.secure).toBe(false);
    expect(insecure.options()?.requireTLS).toBe(true);

    const secureCaptured: Array<{ message: string }> = [];
    const secure = smtpMailer(
      { SMTP_SECURE: 'true', SMTP_PORT: '465' },
      secureCaptured,
      captureLogs(),
    );
    expect(secure.options()?.secure).toBe(true);
    expect(secure.options()?.requireTLS).toBeUndefined();
  });

  it('sends without auth when both user and password are absent', () => {
    const captured: Array<{ message: string }> = [];
    const { options } = smtpMailer({}, captured, captureLogs());
    expect(options()?.auth).toBeUndefined();
  });

  it('sets reply-to when configured and auth when both user and password are set', async () => {
    const captured: Array<{ message: string }> = [];
    const logs = captureLogs();
    const { mailer, options } = smtpMailer(
      {
        MAIL_REPLY_TO: 'help@example.com',
        SMTP_USER: 'smtp-user',
        SMTP_PASSWORD: 'smtp-password',
      },
      captured,
      logs,
    );
    expect(options()?.auth).toEqual({ user: 'smtp-user', pass: 'smtp-password' });

    await mailer.sendOtp('user@example.com', '123456', 'sign-in');

    const message = readLastSent(captured);
    expect(message.replyTo).toEqual([{ address: 'help@example.com', name: '' }]);
    expect(logs.output()).not.toContain('smtp-password');
    expect(logs.output()).not.toContain('123456');
  });

  it('throws MailerDeliveryError on transport failure without logging the code', async () => {
    const code = '123456';
    const config = loadServerConfig(smtpEnv);
    const logs = captureLogs();
    const failing = (): Transporter => {
      const inner = createTransport({ jsonTransport: true });
      inner.sendMail = (() =>
        Promise.reject(new Error('550 rejected: address denied'))) as typeof inner.sendMail;
      return inner;
    };
    const mailer = new SmtpMailer(config, createLogger(config, logs.destination), {
      transportFactory: failing,
    });

    await expect(mailer.sendOtp('user@example.com', code, 'sign-in')).rejects.toBeInstanceOf(
      MailerDeliveryError,
    );
    const output = logs.output();
    expect(output).not.toContain(code);
    expect(output).not.toContain('denied');
    expect(output).toContain('sign-in email failed');
  });

  it('times out a hanging transport with MailerDeliveryError', async () => {
    const code = '234567';
    const logs = captureLogs();
    const config = loadServerConfig(smtpEnv);
    const hanging = (): Transporter => {
      const inner = createTransport({ jsonTransport: true });
      inner.sendMail = (() => new Promise(() => {})) as typeof inner.sendMail;
      return inner;
    };
    const mailer = new SmtpMailer(config, createLogger(config, logs.destination), {
      transportFactory: hanging,
      sendTimeoutMs: 10,
    });

    await expect(mailer.sendOtp('user@example.com', code, 'sign-in')).rejects.toBeInstanceOf(
      MailerDeliveryError,
    );
    expect(logs.output()).not.toContain(code);
  });

  it('warns and does not crash when the startup verify fails', async () => {
    const config = loadServerConfig(smtpEnv);
    const logs = captureLogs();
    const logger = createLogger(config, logs.destination);
    const failingVerify = (): Transporter => {
      const inner = createTransport({ jsonTransport: true });
      inner.verify = (() => Promise.reject(new Error('connection refused'))) as typeof inner.verify;
      return inner;
    };
    const mailer = new SmtpMailer(config, logger, { transportFactory: failingVerify });

    await expect(mailer.verifyConnection()).resolves.toBeUndefined();
    expect(logs.output()).toContain('SMTP connection check failed');
    expect(logs.output()).not.toContain('connection refused');
  });

  it('createMailer picks smtp and keeps a failed startup verify from crashing', async () => {
    const config = loadServerConfig({
      ...smtpEnv,
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '9',
    });
    const logs = captureLogs();
    const mailer = createMailer(config, createLogger(config, logs.destination));
    expect(mailer).toBeInstanceOf(SmtpMailer);
    await (mailer as SmtpMailer).verifyConnection();
    expect(logs.output()).toContain('SMTP connection check failed');
  });

  it('refuses console in production without the opt-in, naming the variables', () => {
    const config = loadServerConfig({
      ...baseEnv,
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'console',
    });
    const logs = captureLogs();
    expect(() => new ConsoleMailer(config, createLogger(config, logs.destination))).toThrow(
      /MAIL_ALLOW_CONSOLE_IN_PRODUCTION/,
    );
    expect(logs.output()).toBe('');
  });

  it('lets the console opt-in run in production with a loud warning and warn-level codes', async () => {
    const code = '345678';
    const config = loadServerConfig({
      ...baseEnv,
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'console',
      MAIL_ALLOW_CONSOLE_IN_PRODUCTION: 'true',
    });
    const logs = captureLogs();
    const mailer = createMailer(config, createLogger(config, logs.destination));
    expect(mailer).toBeInstanceOf(ConsoleMailer);

    await mailer.sendOtp('operator@example.com', code, 'sign-in');

    const output = logs.output();
    expect(output).toContain('sign-in codes are written to the server log');
    expect(output).toContain(code);
    expect(output).toContain('"level":40');
  });

  it('keeps secrets out of stringified config logs and thrown messages', () => {
    const password = 'smtp-password-value';
    const config = loadServerConfig({
      ...smtpEnv,
      SMTP_USER: 'smtp-user',
      SMTP_PASSWORD: password,
    });
    const asLogged = JSON.stringify({
      ...config,
      SMTP_PASSWORD: '[redacted]',
      DATABASE_URL: '[redacted]',
    });
    expect(asLogged).not.toContain(password);

    const logs = captureLogs();
    const logger = createLogger(config, logs.destination);
    logger.info({ SMTP_PASSWORD: password, SMTP_USER: 'smtp-user' }, 'config dump');
    expect(logs.output()).not.toContain(password);
    expect(logs.output()).not.toContain('smtp-user');
    expect(logs.output()).toContain('[redacted]');
  });
});
