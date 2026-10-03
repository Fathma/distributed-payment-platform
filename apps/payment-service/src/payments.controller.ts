import { Controller, Get, Headers, NotFoundException, Param } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id')
  async get(@Param('id') id: string, @Headers('x-user-id') userId: string | undefined) {
    const payment = await this.payments.get(id, userId ?? 'usr_dev');
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment was not found' });
    return payment;
  }
}
