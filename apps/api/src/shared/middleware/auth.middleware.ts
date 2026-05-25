import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../../modules/auth/token.service';
import { AuthenticationError, ForbiddenError } from '../errors/app-errors';

export type Role = 'customer' | 'seller' | 'rider' | 'admin';

export interface AuthContext {
  userId: string;
  role: Role;
  profileId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Authenticate middleware — verify JWT and attach auth context to request.
 * Use as preHandler on any protected route:
 *
 *   app.get('/me', { preHandler: [authenticate] }, handler)
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    throw new AuthenticationError('Authorization header required');
  }

  const token = header.slice(7); // Remove "Bearer "
  const payload = verifyAccessToken(token); // Throws if invalid/expired

  request.auth = {
    userId: payload.sub,
    role: payload.role as Role,
    profileId: payload.profileId,
  };
}

/**
 * Role guard factory — use after authenticate.
 *
 * Example: requireRole('admin', 'seller')
 * Allows admins and sellers, rejects customers and riders.
 */
export function requireRole(...allowedRoles: Role[]) {
  return async function roleGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    if (!request.auth) {
      throw new AuthenticationError('Not authenticated');
    }
    if (!allowedRoles.includes(request.auth.role)) {
      throw new ForbiddenError(
        `Access denied. Required: ${allowedRoles.join(' or ')}`,
      );
    }
  };
}
