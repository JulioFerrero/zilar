import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../config';
import { createLogger } from '../logger';
import { TEST_SECRET } from '../test-support';
import { ConsoleMailer, MailerConfigurationError, createMailer } from './mailer';

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
});
