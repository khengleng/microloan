import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Sentry, sentryEnabled } from './sentry';

/**
 * Reports server-side faults to Sentry while preserving Nest's default response
 * behavior. Expected client errors (4xx HttpExceptions) are NOT reported —
 * only 5xx and non-HTTP (unexpected) exceptions, to keep the signal clean.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (sentryEnabled() && (status >= 500 || !(exception instanceof HttpException))) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
