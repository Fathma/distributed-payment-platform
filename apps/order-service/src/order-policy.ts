import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CreateOrderRequest } from './orders.controller';

export function normalizeOrder(input: CreateOrderRequest) {
  if (!input || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new BadRequestException('items must contain between 1 and 50 entries');
  if (typeof input.currency !== 'string' || !/^[A-Za-z]{3}$/.test(input.currency)) throw new BadRequestException('currency must be a three-letter code');
  const items = input.items.map((item) => {
    if (!item || typeof item.productId !== 'string' || item.productId.trim().length === 0 || item.productId.length > 100) throw new BadRequestException('each item requires a productId');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) throw new BadRequestException('quantity must be an integer from 1 to 10000');
    if (!Number.isSafeInteger(item.unitAmount) || item.unitAmount < 0) throw new BadRequestException('unitAmount must be a non-negative integer in minor currency units');
    return { productId: item.productId, quantity: item.quantity, unitAmount: item.unitAmount };
  });
  const totalAmount = items.reduce((total, item) => total + item.quantity * item.unitAmount, 0);
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) throw new BadRequestException('order total must be a positive safe integer');
  return { items, currency: input.currency.toUpperCase(), totalAmount };
}

export function hashOrderRequest(items: CreateOrderRequest['items'], currency: string) {
  return createHash('sha256').update(JSON.stringify({ items, currency })).digest('hex');
}

export function assertIdempotencyRequestMatches(existingHash: string, requestHash: string) {
  if (existingHash !== requestHash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'Idempotency key was used with a different request' });
}
