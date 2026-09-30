export type OrderStatus = 'PENDING_PAYMENT' | 'PAYMENT_PROCESSING' | 'PAID' | 'PAYMENT_FAILED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
export type UserRole = 'CUSTOMER' | 'ADMIN';

export interface EventEnvelope<TType extends string, TData> {
  eventId: string;
  eventType: TType;
  schemaVersion: number;
  occurredAt: string;
  producer: string;
  correlationId: string;
  requestId: string;
  aggregateId: string;
  data: TData;
}

export interface OrderCreatedData {
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface PaymentRequestedData {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  providerIdempotencyKey: string;
  processingGeneration: number;
}

export interface PaymentResultData {
  paymentId: string;
  orderId: string;
  providerReference: string | null;
  attemptCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  processingGeneration: number;
}
