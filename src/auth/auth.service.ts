import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './types/jwt-payload';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return user;
  }

  issueTokens(user: User): { access_token: string; refresh_token: string } {
    const basePayload: Pick<JwtPayload, 'sub' | 'role'> = {
      sub: user.id,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(
        { ...basePayload, type: 'access' } satisfies JwtPayload,
        { expiresIn: ACCESS_TOKEN_TTL },
      ),
      refresh_token: this.jwtService.sign(
        { ...basePayload, type: 'refresh' } satisfies JwtPayload,
        { expiresIn: REFRESH_TOKEN_TTL },
      ),
    };
  }

  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ access_token: string }> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('A valid refresh token is required');
    }

    const user = await this.usersService.findByIdOrFail(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const accessToken = this.jwtService.sign(
      { sub: user.id, role: user.role, type: 'access' } satisfies JwtPayload,
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    return { access_token: accessToken };
  }
}
