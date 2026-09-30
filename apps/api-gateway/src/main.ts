import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from '@payflow/config';

async function bootstrap() {
  const config = loadConfig(3000, { ...process.env, PORT: process.env.API_GATEWAY_PORT ?? process.env.PORT });
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  await app.listen(config.port);
}

void bootstrap();
