import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MetricsModule } from '@payflow/metrics';

@Module({ imports: [MetricsModule.forRoot('payment-service')], controllers: [HealthController, PaymentsController], providers: [HealthService, PaymentsService] })
export class AppModule {}
