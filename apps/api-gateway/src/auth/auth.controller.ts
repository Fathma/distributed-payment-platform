import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Public } from './auth.decorators';
import { JwtAuthService } from './jwt-auth.service';

class LoginRequest {
  @ApiProperty({ example: 'customer@example.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'customer-dev-password' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: JwtAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a development customer/admin login for a JWT' })
  @ApiBody({ type: LoginRequest })
  @ApiResponse({ status: 200, description: 'Bearer token and lifetime.' })
  @ApiResponse({ status: 401, description: 'Credentials are invalid.' })
  @ApiResponse({ status: 429, description: 'Login rate limit exceeded.' })
  login(@Body() body: LoginRequest) {
    return this.auth.login(body.email, body.password);
  }
}
