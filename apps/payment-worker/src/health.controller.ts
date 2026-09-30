import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('health')
  healthCheck() { return { status: 'ok', service: 'payment-worker' }; }

  @Get('ready')
  async readiness() {
    const result = await this.health.check();
    if (result.status !== 'ready') throw new ServiceUnavailableException(result);
    return result;
  }
}
