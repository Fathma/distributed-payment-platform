import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';

export interface CreateOrderRequest {
  items: Array<{ productId: string; quantity: number; unitAmount: number }>;
  currency: string;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Body() body: CreateOrderRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    if (!idempotencyKey?.trim()) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header is required' });
    return this.orders.create(body, idempotencyKey, userId ?? 'usr_dev', requestId, correlationId);
  }

  @Get()
  list(@Headers('x-user-id') userId: string | undefined, @Query('limit') limit?: string) {
    return this.orders.list(userId ?? 'usr_dev', limit);
  }

  @Get(':id')
  get(@Param('id') id: string, @Headers('x-user-id') userId: string | undefined) {
    return this.orders.get(id, userId ?? 'usr_dev');
  }
}
