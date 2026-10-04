import 'dotenv/config';

export interface AppConfig {
  port: number;
  redisUrl: string;
  orderDatabaseUrl: string;
  paymentDatabaseUrl: string;
  workerDatabaseUrl: string;
  kafkaBrokers: string[];
}

export function loadConfig(defaultPort = 3000, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? env.SERVICE_PORT ?? defaultPort);
  const kafkaBrokers = (env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((broker) => broker.trim()).filter(Boolean);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid service port: ${port}`);
  if (kafkaBrokers.length === 0) throw new Error('KAFKA_BROKERS must contain at least one broker');

  return {
    port,
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    orderDatabaseUrl: env.ORDER_DATABASE_URL ?? 'postgresql://order_app:order_dev_password@localhost:5432/order_db',
    paymentDatabaseUrl: env.PAYMENT_DATABASE_URL ?? 'postgresql://payment_app:payment_dev_password@localhost:5432/payment_db',
    workerDatabaseUrl: env.WORKER_DATABASE_URL ?? 'postgresql://worker_app:worker_dev_password@localhost:5432/worker_db',
    kafkaBrokers,
  };
}
