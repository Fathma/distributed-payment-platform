import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { JwtAuthGuard, RateLimitGuard } from './auth/auth.guards';
import { JwtAuthService } from './auth/jwt-auth.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { GatewayProxyController } from './gateway-proxy.controller';
import { RedisService } from './redis.service';
import { MetricsModule } from '@payflow/metrics';

@Module({
  controllers: [HealthController, GatewayProxyController, AuthController],
  imports: [MetricsModule.forRoot('api-gateway')],
  providers: [
    HealthService,
    RedisService,
    JwtAuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
