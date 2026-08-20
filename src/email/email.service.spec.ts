import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer');

function buildConfigService(
  env: Record<string, string | number>,
): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) =>
      key in env ? env[key] : defaultValue,
  } as unknown as ConfigService;
}

describe('EmailService', () => {
  let sendMailMock: jest.Mock;

  beforeEach(() => {
    sendMailMock = jest.fn().mockResolvedValue(undefined);
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: sendMailMock,
    });
  });

  it('sends an email when SMTP is fully configured', async () => {
    const service = new EmailService(
      buildConfigService({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_USER: 'user@example.com',
        SMTP_PASSWORD: 'secret',
      }),
    );

    await service.send({
      to: 'support@example.com',
      subject: 'Hello',
      text: 'Body',
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'support@example.com',
        subject: 'Hello',
        text: 'Body',
      }),
    );
  });

  it('does not attempt to send when SMTP is not configured', async () => {
    const service = new EmailService(buildConfigService({}));

    await service.send({
      to: 'support@example.com',
      subject: 'Hello',
      text: 'Body',
    });

    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('swallows a send failure instead of throwing', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP connection refused'));
    const service = new EmailService(
      buildConfigService({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_USER: 'user@example.com',
        SMTP_PASSWORD: 'secret',
      }),
    );

    await expect(
      service.send({ to: 'support@example.com', subject: 'Hi', text: 'x' }),
    ).resolves.toBeUndefined();
  });
});
