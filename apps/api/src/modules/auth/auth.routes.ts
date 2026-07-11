import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createAuthService } from './auth.service';
import {
  sendOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  setPinSchema,
  type SendOtpInput,
  type VerifyOtpInput,
  type RefreshTokenInput,
  type SetPinInput,
} from './auth.schema';
import { ValidationError } from '../../shared/errors/app-errors';
import { authenticate } from '../../shared/middleware/auth.middleware';

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // Service created once — prisma + redis injected from app decorators
  const authService = createAuthService(app.prisma, app.redis);

  // Pre-declared guard const — a typed FastifyRequest<{Body}> handler with an
  // INLINE { preHandler } object trips the repo's exactOptionalPropertyTypes
  // baseline; a const sidesteps it (same pattern as catalog.routes writeGuard).
  const authGuard = { preHandler: [authenticate] };

  // ── POST /api/v1/auth/send-otp ────────────────────────────────────────────
  app.post(
    '/send-otp',
    {
      config: {
        // Tighter rate limit on OTP endpoints
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (
      request: FastifyRequest<{ Body: SendOtpInput }>,
      reply: FastifyReply,
    ) => {
      const parsed = sendOtpSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors[0]?.message ?? 'Invalid input',
        );
      }

      const ip = request.ip ?? '0.0.0.0';
      const result = await authService.sendOtp(parsed.data.phone, ip);

      return reply.status(200).send(result);
    },
  );

  // ── POST /api/v1/auth/verify-otp ──────────────────────────────────────────
  app.post(
    '/verify-otp',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (
      request: FastifyRequest<{ Body: VerifyOtpInput }>,
      reply: FastifyReply,
    ) => {
      const parsed = verifyOtpSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors[0]?.message ?? 'Invalid input',
        );
      }

      const result = await authService.verifyOtp(
        parsed.data.phone,
        parsed.data.otp,
        parsed.data.referralCode,
      );

      return reply.status(200).send({
        tokens: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
        },
        isNewUser: result.isNewUser,
        requiresPin: result.requiresPin,
        role: result.role,
      });
    },
  );

  // ── POST /api/v1/auth/refresh ─────────────────────────────────────────────
  app.post(
    '/refresh',
    async (
      request: FastifyRequest<{ Body: RefreshTokenInput }>,
      reply: FastifyReply,
    ) => {
      const parsed = refreshTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid refresh token');
      }

      const tokens = await authService.refresh(parsed.data.refreshToken);
      return reply.status(200).send({ tokens });
    },
  );

  // ── POST /api/v1/auth/logout ──────────────────────────────────────────────
  // Route generics (<{ Body }>) instead of annotated request/reply params — a
  // fully-annotated handler pins the route generic to RouteGenericInterface and
  // fails the exactOptionalPropertyTypes baseline (Fastify v4 TS docs).
  app.post<{ Body: RefreshTokenInput }>(
    '/logout',
    authGuard,
    async (request, reply) => {
      const parsed = refreshTokenSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid refresh token');
      }

      await authService.logout(request.auth!.userId, parsed.data.refreshToken);
      return reply.status(200).send({ message: 'Logout successful' });
    },
  );

  // ── POST /api/v1/auth/set-pin ─────────────────────────────────────────────
  app.post<{ Body: SetPinInput }>(
    '/set-pin',
    authGuard,
    async (request, reply) => {
      const parsed = setPinSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors[0]?.message ?? 'Invalid PIN',
        );
      }

      await authService.setPin(
        request.auth!.userId,
        request.auth!.role,
        parsed.data.pin,
      );

      return reply.status(200).send({ message: 'PIN set ho gaya' });
    },
  );
}
