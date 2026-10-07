import { describe, expect, it } from 'vitest';
import { createTransport, type Transporter } from 'nodemailer';
import { loadServerConfig } from '../config';
import { createLogger } from '../logger';
import { TEST_SECRET } from '../test-support';
import { MailerDeliveryError, SmtpMailer } from './mailer';

const baseEnv = {
  DATABASE_URL: 'postgres://user:hunter2@127.0.0.1:5432/zilar',
  BETTER_AUTH_SECRET: TEST_SECRET,
  EJABBERD_ADMIN_JID: 'admin@zilar.localhost',
  EJABBERD_ADMIN_PASSWORD: 'admin-password',
  ZILAR_XMPP_JWT_SECRET: 'x'.repeat(40),
};

const smtpEnv = {
  ...baseEnv,
  MAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  MAIL_FROM: 'Zilar <no-reply@example.com>',
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

// Builds an SMTP mailer over the json transport (no network) and lets the
// test override `sendMail` on the transport to fail or hang.
function smtpMailer(configure: (inner: Transporter) => void, sendTimeoutMs?: number) {
  const config = loadServerConfig(smtpEnv);
  const logs = captureLogs();
  const factory = (): Transporter => {
    const inner = createTransport({ jsonTransport: true });
    configure(inner);
    return inner;
  };
  const mailer = new SmtpMailer(config, createLogger(config, logs.destination), {
    transportFactory: factory,
    ...(sendTimeoutMs === undefined ? {} : { sendTimeoutMs }),
  });
  return { mailer, logs };
}

describe('SmtpMailer.sendOtp on Effect', () => {
  it('fails with MailerDeliveryError and logs the timeout when the transport hangs', async () => {
    const { mailer, logs } = smtpMailer((inner) => {
      inner.sendMail = (() => new Promise(() => {})) as typeof inner.sendMail;
    }, 10);

    await expect(mailer.sendOtp('user@example.com', '123456', 'sign-in')).rejects.toBeInstanceOf(
      MailerDeliveryError,
    );
    const output = logs.output();
    expect(output).toContain('sign-in email delivery timed out');
    expect(output).not.toContain('sign-in email failed');
    expect(output).not.toContain('123456');
  });

  it('fails with MailerDeliveryError and logs the smtp response code when the transport rejects', async () => {
    const { mailer, logs } = smtpMailer((inner) => {
      inner.sendMail = (() => {
        const error = new Error('550 rejected: address denied');
        Object.assign(error, { responseCode: 550 });
        return Promise.reject(error);
      }) as typeof inner.sendMail;
    });

    await expect(mailer.sendOtp('user@example.com', '123456', 'sign-in')).rejects.toBeInstanceOf(
      MailerDeliveryError,
    );
    const output = logs.output();
    expect(output).toContain('sign-in email failed');
    expect(output).toContain('"smtpCode":550');
    expect(output).not.toContain('123456');
    expect(output).not.toContain('denied');
  });
});
