import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { MetricsModule } from '@payflow/metrics';

@Module({ imports: [MetricsModule.forRoot('order-service')], controllers: [HealthController, OrdersController], providers: [HealthService, OrdersService] })
export class AppModule {}
