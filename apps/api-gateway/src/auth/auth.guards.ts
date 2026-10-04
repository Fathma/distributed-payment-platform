import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { IS_PUBLIC, ALLOWED_ROLES } from './auth.decorators';
import { JwtAuthService } from './jwt-auth.service';
import type { AuthenticatedRequest, UserRole } from './auth.types';
import { RedisService } from '../redis.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtAuthService) {}

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<Request>() as AuthenticatedRequest;
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'A bearer token is required' });
    request.user = this.jwt.verify(authorization.slice(7));
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ALLOWED_ROLES, [context.getHandler(), context.getClass()]);
    if (roles?.length && !roles.includes(request.user.role)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role cannot access this resource' });
    return true;
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const path = request.originalUrl.split('?')[0];
    if (path.startsWith('/api/docs') || path === '/health' || path === '/ready') return true;
    const login = request.method === 'POST' && path === '/api/auth/login';
    const write = request.method !== 'GET' && request.method !== 'HEAD';
    const limit = login ? 10 : write ? 10 : 120;
    const identity = login ? `ip:${request.ip}` : `user:${request.user?.sub ?? request.ip}`;
    const bucket = Math.floor(Date.now() / 60_000);
    const key = `rate:${login ? 'login' : write ? 'write' : 'read'}:${createHash('sha256').update(identity).digest('hex')}:${bucket}`;
    let count: number;
    let ttl: number;
    try {
      [count, ttl] = await this.redis.consumeFixedWindow(key);
    } catch {
      throw new ServiceUnavailableException({ code: 'RATE_LIMIT_UNAVAILABLE', message: 'Request protection is temporarily unavailable' });
    }
    if (count > limit) {
      response.setHeader('Retry-After', Math.max(1, ttl));
      throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many requests', retryAfterSeconds: Math.max(1, ttl) }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
