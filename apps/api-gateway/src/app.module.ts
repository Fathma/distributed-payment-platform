import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { GatewayProxyController } from './gateway-proxy.controller';

@Module({ controllers: [HealthController, GatewayProxyController], providers: [HealthService] })
export class AppModule {}
