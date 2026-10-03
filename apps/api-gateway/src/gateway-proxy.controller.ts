import { All, Controller, HttpException, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

@Controller()
export class GatewayProxyController {
  private readonly orderServiceUrl = process.env.ORDER_SERVICE_URL ?? 'http://localhost:3001';
  private readonly paymentServiceUrl = process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3002';

  @All('orders')
  proxyOrders(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, this.orderServiceUrl);
  }

  @All('orders/:id')
  proxyOrder(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, this.orderServiceUrl);
  }

  @All('payments/:id')
  proxyPayment(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, this.paymentServiceUrl);
  }

  private async forward(request: Request, response: Response, serviceUrl: string) {
    const requestId = request.header('x-request-id') ?? randomUUID();
    const correlationId = request.header('x-correlation-id') ?? requestId;
    const headers: Record<string, string> = {
      'x-request-id': requestId,
      'x-correlation-id': correlationId,
      'x-user-id': request.header('x-user-id') ?? 'usr_dev',
    };
    const idempotencyKey = request.header('idempotency-key');
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const contentType = request.header('content-type');
    if (contentType) headers['content-type'] = contentType;
    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(request.body ?? {});

    try {
      const upstream = await fetch(`${serviceUrl}${request.originalUrl.replace(/^\/api/, '')}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      });
      response.status(upstream.status);
      response.setHeader('x-request-id', requestId);
      response.setHeader('x-correlation-id', correlationId);
      const upstreamContentType = upstream.headers.get('content-type');
      if (upstreamContentType) response.setHeader('content-type', upstreamContentType);
      response.send(await upstream.text());
    } catch {
      throw new HttpException({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'A downstream service is unavailable', requestId } }, 503);
    }
  }
}
