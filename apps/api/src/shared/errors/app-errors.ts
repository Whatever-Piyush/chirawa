/**
 * Base error class for all application errors.
 * The global error handler in app.ts detects these and
 * serializes them into consistent JSON responses.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    // Preserves stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — Client sent invalid data */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/** 401 — No valid auth token */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, message, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

/** 403 — Valid token but wrong role / not owner of resource */
export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(403, message, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

/** 404 — Resource doesn't exist */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/** 409 — Duplicate resource or state conflict */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

/** 402 — Payment related error */
export class PaymentError extends AppError {
  constructor(message: string, details?: unknown) {
    super(402, message, 'PAYMENT_ERROR', details);
    this.name = 'PaymentError';
  }
}

/** 422 — Logically invalid operation (e.g. invalid order state transition) */
export class BusinessRuleError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, message, 'BUSINESS_RULE_VIOLATION', details);
    this.name = 'BusinessRuleError';
  }
}

/** 503 — External service (Razorpay, Maps, FCM) is down */
export class ExternalServiceError extends AppError {
  constructor(service: string, message?: string) {
    super(
      503,
      message ?? `${service} is temporarily unavailable`,
      'EXTERNAL_SERVICE_ERROR',
    );
    this.name = 'ExternalServiceError';
  }
}
