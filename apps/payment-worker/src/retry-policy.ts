export function isRetryableProviderFailure(code: string) {
  return code !== 'PROVIDER_DECLINED';
}

export function retryDelayMs(attempt: number, baseMs: number, maxMs: number, random = Math.random) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('attempt must be a positive integer');
  if (!Number.isFinite(baseMs) || baseMs < 0 || !Number.isFinite(maxMs) || maxMs < 0) throw new RangeError('retry delays must be finite and non-negative');
  const ceiling = Math.min(maxMs, baseMs * (2 ** (attempt - 1)));
  return Math.floor(ceiling * (0.5 + Math.min(1, Math.max(0, random())) * 0.5));
}
