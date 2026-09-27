import type { Logger } from 'pino';
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

export class ConsoleMailer implements Mailer {
  readonly #logger: Logger;

  constructor(config: ServerConfig, logger: Logger) {
    if (config.NODE_ENV === 'production') {
      throw new MailerConfigurationError(
        'No email provider is configured. Set up a real mailer before running in production.',
      );
    }
    this.#logger = logger;
  }

  async sendOtp(email: string, code: string, purpose: OtpPurpose): Promise<void> {
    this.#logger.info({ purpose }, `[dev-mailer] OTP for ${email}: ${code}`);
  }
}

export function createMailer(config: ServerConfig, logger: Logger): Mailer {
  return new ConsoleMailer(config, logger);
}
