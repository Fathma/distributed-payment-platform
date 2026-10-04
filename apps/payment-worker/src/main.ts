import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from '@payflow/config';
import { MetricsService, PAYFLOW_METRICS } from '@payflow/metrics';

async function bootstrap() {
  const config = loadConfig(3003, { ...process.env, PORT: process.env.PAYMENT_WORKER_PORT ?? process.env.PORT });
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use(app.get<MetricsService>(PAYFLOW_METRICS).middleware());
  await app.listen(config.port);
}

void bootstrap();
