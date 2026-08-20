import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
}

/**
 * Best-effort email sender: if SMTP isn't configured, or a send fails,
 * this logs and returns instead of throwing - notification email is a
 * nice-to-have on top of the contact message being stored, not something
 * that should ever block a real submission.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const password = this.configService.get<string>('SMTP_PASSWORD');
    this.fromAddress = this.configService.get<string>(
      'SMTP_FROM',
      user ?? 'no-reply@example.com',
    );

    if (host && port && user && password) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass: password },
      });
    } else {
      this.transporter = null;
      this.logger.warn(
        'SMTP is not configured (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD) - email notifications are disabled.',
      );
    }
  }

  async send(params: SendEmailParams): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Email not sent (SMTP disabled): ${params.subject}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: params.to,
        subject: params.subject,
        text: params.text,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send email "${params.subject}": ${(error as Error).message}`,
      );
    }
  }
}
