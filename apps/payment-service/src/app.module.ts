import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({ controllers: [HealthController, PaymentsController], providers: [HealthService, PaymentsService] })
export class AppModule {}
