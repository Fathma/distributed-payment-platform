import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { Public } from './auth/auth.decorators';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('health')
  healthCheck() { return { status: 'ok', service: 'api-gateway' }; }

  @Public()
  @Get('ready')
  async readiness() {
    const result = await this.health.check();
    if (result.status !== 'ready') throw new ServiceUnavailableException(result);
    return result;
  }
}
