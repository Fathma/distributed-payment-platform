import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PaymentConsumerService } from './payment-consumer.service';
import { MockPaymentProvider } from './mock-payment-provider';
import { DlqController } from './dlq.controller';
import { MetricsModule } from '@payflow/metrics';

@Module({ imports: [MetricsModule.forRoot('payment-worker')], controllers: [HealthController, DlqController], providers: [HealthService, PaymentConsumerService, MockPaymentProvider] })
export class AppModule {}
