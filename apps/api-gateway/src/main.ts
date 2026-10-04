import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadConfig } from '@payflow/config';

async function bootstrap() {
  const config = loadConfig(3000, { ...process.env, PORT: process.env.API_GATEWAY_PORT ?? process.env.PORT });
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  const openApiConfig = new DocumentBuilder()
    .setTitle('PayFlow Public API')
    .setDescription('Order and payment endpoints exposed by the API Gateway. Payment processing is asynchronous.')
    .setVersion('1.0.0')
    .addTag('Public API')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, openApiConfig), {
    useGlobalPrefix: true,
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
  await app.listen(config.port);
}

void bootstrap();
