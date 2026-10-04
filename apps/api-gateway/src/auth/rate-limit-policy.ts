export interface RateLimitPolicy { kind: 'login' | 'write' | 'read'; limit: number }

export function rateLimitPolicy(method: string, path: string): RateLimitPolicy {
  if (method.toUpperCase() === 'POST' && path === '/api/auth/login') return { kind: 'login', limit: 10 };
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) return { kind: 'write', limit: 10 };
  return { kind: 'read', limit: 120 };
}
