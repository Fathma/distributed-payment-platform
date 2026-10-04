import { Controller, DynamicModule, Get, Inject, Module, Res } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const PAYFLOW_METRICS = Symbol('PAYFLOW_METRICS');

export class MetricsService {
  readonly registry = new Registry();
  private readonly httpRequests: Counter<'method' | 'path' | 'status_code'>;
  private readonly httpDuration: Histogram<'method' | 'path' | 'status_code'>;
  private readonly kafkaMessages: Counter<'topic' | 'outcome'>;
  private readonly kafkaProcessing: Histogram<'topic'>;
  private readonly paymentOutcomes: Counter<'outcome'>;
  private readonly paymentProcessing: Histogram<'outcome'>;
  private readonly paymentRetries: Counter<'failure_code'>;
  private readonly dlqMessages: Counter<'action'>;
  private readonly dependencyDuration: Histogram<'dependency' | 'outcome'>;
  private readonly consumerLag: Gauge<'group' | 'topic' | 'partition'>;

  constructor(serviceName: string) {
    this.registry.setDefaultLabels({ service: serviceName });
    collectDefaultMetrics({ register: this.registry });
    this.httpRequests = new Counter({ name: 'payflow_http_requests_total', help: 'HTTP requests handled by the service.', labelNames: ['method', 'path', 'status_code'], registers: [this.registry] });
    this.httpDuration = new Histogram({ name: 'payflow_http_request_duration_seconds', help: 'HTTP request duration in seconds.', labelNames: ['method', 'path', 'status_code'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [this.registry] });
    this.kafkaMessages = new Counter({ name: 'payflow_kafka_messages_total', help: 'Kafka messages processed by the service.', labelNames: ['topic', 'outcome'], registers: [this.registry] });
    this.kafkaProcessing = new Histogram({ name: 'payflow_kafka_processing_duration_seconds', help: 'Kafka message processing duration in seconds.', labelNames: ['topic'], buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 15, 30], registers: [this.registry] });
    this.paymentOutcomes = new Counter({ name: 'payflow_payment_outcomes_total', help: 'Terminal payment outcomes observed by the worker.', labelNames: ['outcome'], registers: [this.registry] });
    this.paymentProcessing = new Histogram({ name: 'payflow_payment_processing_duration_seconds', help: 'Durable payment job processing duration in seconds.', labelNames: ['outcome'], buckets: [0.01, 0.1, 0.5, 1, 2.5, 5, 15, 30, 60], registers: [this.registry] });
    this.paymentRetries = new Counter({ name: 'payflow_payment_retries_total', help: 'Retryable payment provider attempts.', labelNames: ['failure_code'], registers: [this.registry] });
    this.dlqMessages = new Counter({ name: 'payflow_dlq_messages_total', help: 'Dead-letter messages created or reprocessed.', labelNames: ['action'], registers: [this.registry] });
    this.dependencyDuration = new Histogram({ name: 'payflow_dependency_check_duration_seconds', help: 'Dependency probe duration in seconds.', labelNames: ['dependency', 'outcome'], buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2], registers: [this.registry] });
    this.consumerLag = new Gauge({ name: 'payflow_kafka_consumer_lag', help: 'Latest known Kafka consumer lag in messages.', labelNames: ['group', 'topic', 'partition'], registers: [this.registry] });
  }

  middleware() {
    return (request: Request, response: Response, next: NextFunction) => {
      const startedAt = process.hrtime.bigint();
      response.on('finish', () => {
        const labels = { method: request.method, path: this.normalizePath(request.path), status_code: String(response.statusCode) };
        this.httpRequests.inc(labels);
        this.httpDuration.observe(labels, Number(process.hrtime.bigint() - startedAt) / 1e9);
      });
      next();
    };
  }

  recordKafkaMessage(topic: string, outcome: 'success' | 'failure', durationSeconds: number) {
    this.kafkaMessages.inc({ topic, outcome });
    this.kafkaProcessing.observe({ topic }, durationSeconds);
  }
  recordPaymentOutcome(outcome: 'success' | 'failure') { this.paymentOutcomes.inc({ outcome }); }
  recordPaymentProcessing(outcome: 'success' | 'failure', durationSeconds: number) { this.paymentProcessing.observe({ outcome }, durationSeconds); }
  recordRetry(failureCode: string) { this.paymentRetries.inc({ failure_code: failureCode }); }
  recordDlq(action: 'created' | 'reprocessed') { this.dlqMessages.inc({ action }); }
  recordDependency(dependency: string, outcome: 'ok' | 'failure', durationSeconds: number) { this.dependencyDuration.observe({ dependency, outcome }, durationSeconds); }
  setConsumerLag(group: string, topic: string, partition: number, lag: number) { this.consumerLag.set({ group, topic, partition: String(partition) }, Math.max(0, lag)); }
  async metrics() { return this.registry.metrics(); }

  private normalizePath(path: string) {
    if (path === '/api/orders') return path;
    if (/^\/api\/orders\/[^/]+$/.test(path)) return '/api/orders/:id';
    if (/^\/api\/payments\/[^/]+$/.test(path)) return '/api/payments/:id';
    if (path === '/api/auth/login') return path;
    if (path === '/api/admin/dlq') return path;
    if (/^\/api\/admin\/dlq\/[^/]+\/reprocess$/.test(path)) return '/api/admin/dlq/:id/reprocess';
    if (path === '/health' || path === '/ready' || path === '/metrics') return path;
    return 'unmatched';
  }
}

@Controller()
class MetricsController {
  constructor(@Inject(PAYFLOW_METRICS) private readonly metricsService: MetricsService) {}

  @Get('metrics')
  async metrics(@Res() response: Response) {
    response.setHeader('Content-Type', this.metricsService.registry.contentType);
    response.send(await this.metricsService.metrics());
  }
}

@Module({})
export class MetricsModule {
  static forRoot(serviceName: string): DynamicModule {
    return {
      module: MetricsModule,
      controllers: [MetricsController],
      providers: [{ provide: PAYFLOW_METRICS, useValue: new MetricsService(serviceName) }],
      exports: [PAYFLOW_METRICS],
    };
  }
}
