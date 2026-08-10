import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Log in and get an access + refresh token' })
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    const tokens = this.authService.issueTokens(user);

    return {
      success: true,
      data: {
        ...tokens,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      },
    };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Trade a refresh token for a new access token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    const data = await this.authService.refreshAccessToken(dto.refresh_token);
    return { success: true, data };
  }
}
