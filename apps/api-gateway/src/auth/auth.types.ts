import type { Request } from 'express';

export type UserRole = 'CUSTOMER' | 'ADMIN';

export interface AuthenticatedUser {
  sub: string;
  role: UserRole;
  email: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
