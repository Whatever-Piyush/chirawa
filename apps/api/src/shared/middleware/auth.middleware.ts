import type { FastifyRequest, FastifyReply } from 'fastify';
import { AuthenticationError } from '../errors/app-errors';

/**
 * Authentication middleware stub.
 * Full implementation in Step 4 (Auth module).
 *
 * Step 4 will:
 *  - Verify RS256 JWT signature and expiry
 *  - Extract role from JWT claims
 *  - Load minimal user context into request (userId, role, profileId)
 *  - Enforce resource ownership at service layer
 */
export async function authenticate(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Placeholder — throws so protected routes fail loudly until Step 4
  throw new AuthenticationError('Auth middleware not yet implemented (Step 4)');
}

/** Role type for route-level authorization */
export type Role = 'customer' | 'seller' | 'rider' | 'admin';

/** Attached to request by authenticate() middleware after Step 4 */
export interface AuthContext {
  userId: string;
  role: Role;
  profileId: string;
}

// Extend Fastify's Request type to include auth context
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
