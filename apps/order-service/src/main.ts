import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from '@payflow/config';

async function bootstrap() {
  const config = loadConfig(3001, { ...process.env, PORT: process.env.ORDER_SERVICE_PORT ?? process.env.PORT });
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
