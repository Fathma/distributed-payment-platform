import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from '@payflow/config';

async function bootstrap() {
  const config = loadConfig(3003, { ...process.env, PORT: process.env.PAYMENT_WORKER_PORT ?? process.env.PORT });
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
