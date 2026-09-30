export interface LogContext {
  service: string;
  requestId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export function log(level: 'info' | 'warn' | 'error', message: string, context: LogContext): void {
  const entry = { timestamp: new Date().toISOString(), level, message, ...context };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}
