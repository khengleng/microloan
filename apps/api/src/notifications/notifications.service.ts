import { Injectable, Logger } from '@nestjs/common';
import {
    isEmailConfigured,
    isSmsConfigured,
    sendEmailViaProvider,
    sendSmsViaProvider,
    SendResult,
} from './notification.providers';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    get status() {
        return { email: { configured: isEmailConfigured() }, sms: { configured: isSmsConfigured() } };
    }

    /** Send an email. Never throws — returns a result the caller can log/ignore. */
    async sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
        try {
            const result = await sendEmailViaProvider(to, subject, html);
            if (!result.sent) this.logger.warn(`Email not sent: ${result.reason}`);
            else this.logger.log(`Email sent (provider=${result.provider} ref=${result.ref || 'n/a'})`); // no recipient logged (PII)
            return result;
        } catch (err) {
            this.logger.error('Email send error', err instanceof Error ? err.stack : String(err));
            return { sent: false, provider: 'email', reason: 'Unexpected email error.' };
        }
    }

    /** Send an SMS. Never throws — returns a result the caller can log/ignore. */
    async sendSms(to: string, message: string): Promise<SendResult> {
        try {
            const result = await sendSmsViaProvider(to, message);
            if (!result.sent) this.logger.warn(`SMS not sent: ${result.reason}`);
            return result;
        } catch (err) {
            this.logger.error('SMS send error', err instanceof Error ? err.stack : String(err));
            return { sent: false, provider: 'sms', reason: 'Unexpected SMS error.' };
        }
    }
}
