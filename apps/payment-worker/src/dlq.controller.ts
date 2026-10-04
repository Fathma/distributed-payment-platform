import { Controller, Get, Headers, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { PaymentConsumerService } from './payment-consumer.service';

@Controller('admin/dlq')
export class DlqController {
  constructor(private readonly payments: PaymentConsumerService) {}

  @Get()
  list(@Headers('x-admin-token') token: string | undefined) {
    this.authorize(token);
    return this.payments.listDlq();
  }

  @Post(':id/reprocess')
  async reprocess(@Param('id') id: string, @Headers('x-admin-token') token: string | undefined, @Headers('x-admin-id') adminId: string | undefined) {
    this.authorize(token);
    if (!await this.payments.reprocess(id, adminId ?? 'local-admin')) throw new NotFoundException({ code: 'DLQ_ENTRY_NOT_FOUND', message: 'Unprocessed DLQ entry was not found' });
    return { status: 'REQUEUED', dlqId: id };
  }

  private authorize(token: string | undefined) {
    const expected = process.env.DLQ_ADMIN_TOKEN;
    if (!expected || token !== expected) throw new UnauthorizedException({ code: 'ADMIN_AUTH_REQUIRED', message: 'A valid X-Admin-Token header is required' });
  }
}
