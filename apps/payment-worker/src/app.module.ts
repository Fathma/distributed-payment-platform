import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PaymentConsumerService } from './payment-consumer.service';
import { MockPaymentProvider } from './mock-payment-provider';

@Module({ controllers: [HealthController], providers: [HealthService, PaymentConsumerService, MockPaymentProvider] })
export class AppModule {}
