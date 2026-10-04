import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '@payflow/config';
import type { AuthenticatedUser, UserRole } from './auth.types';

interface LoginIdentity { id: string; email: string; password: string; role: UserRole }
const TOKEN_TTL_SECONDS = 60 * 60;

@Injectable()
export class JwtAuthService {
  private readonly secret = loadConfig().jwtSecret;

  constructor() {
    if (Buffer.byteLength(this.secret) < 32) throw new Error('JWT_SECRET must be at least 32 bytes');
  }

  login(email: string, password: string) {
    const customer = this.identity('CUSTOMER');
    const admin = this.identity('ADMIN');
    const identity = [customer, admin].find((candidate) => this.safeEqual(candidate.email.toLowerCase(), email.toLowerCase()) && this.safeEqual(candidate.password, password));
    if (!identity) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' });
    const now = Math.floor(Date.now() / 1000);
    const payload: AuthenticatedUser = { sub: identity.id, email: identity.email, role: identity.role, iat: now, exp: now + TOKEN_TTL_SECONDS };
    const encodedHeader = this.encode({ alg: 'HS256', typ: 'JWT' });
    const encodedPayload = this.encode(payload);
    const unsigned = `${encodedHeader}.${encodedPayload}`;
    return { accessToken: `${unsigned}.${this.sign(unsigned)}`, tokenType: 'Bearer', expiresIn: TOKEN_TTL_SECONDS };
  }

  verify(token: string): AuthenticatedUser {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'A valid bearer token is required' });
    const unsigned = `${parts[0]}.${parts[1]}`;
    if (!this.safeEqual(this.sign(unsigned), parts[2])) throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'A valid bearer token is required' });
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; typ?: string };
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as AuthenticatedUser;
      const validRole = payload.role === 'CUSTOMER' || payload.role === 'ADMIN';
      if (header.alg !== 'HS256' || !payload.sub || !payload.email || !validRole || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Invalid JWT claims');
      return payload;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'A valid bearer token is required' });
    }
  }

  private identity(role: UserRole): LoginIdentity {
    if (role === 'CUSTOMER') return {
      id: process.env.DEV_CUSTOMER_ID ?? 'usr_customer',
      email: process.env.DEV_CUSTOMER_EMAIL ?? 'customer@example.test',
      password: process.env.DEV_CUSTOMER_PASSWORD ?? 'customer-dev-password',
      role,
    };
    return {
      id: process.env.DEV_ADMIN_ID ?? 'usr_admin',
      email: process.env.DEV_ADMIN_EMAIL ?? 'admin@example.test',
      password: process.env.DEV_ADMIN_PASSWORD ?? 'admin-dev-password',
      role,
    };
  }

  private encode(value: object) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
  private sign(value: string) { return createHmac('sha256', this.secret).update(value).digest('base64url'); }
  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
