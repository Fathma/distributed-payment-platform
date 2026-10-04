export type PaymentLifecycleStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

const ALLOWED_TRANSITIONS: Record<PaymentLifecycleStatus, readonly PaymentLifecycleStatus[]> = {
  PENDING: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'],
  PROCESSING: ['PROCESSING', 'SUCCESS', 'FAILED'],
  SUCCESS: ['SUCCESS'],
  FAILED: ['FAILED', 'SUCCESS'],
};

export function canTransitionPayment(current: PaymentLifecycleStatus, next: PaymentLifecycleStatus) {
  return ALLOWED_TRANSITIONS[current].includes(next);
}
