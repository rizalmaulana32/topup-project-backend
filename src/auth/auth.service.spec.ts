import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole, UserStatus } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let findByEmailMock: jest.Mock;
  let findByIdOrFailMock: jest.Mock;
  let signMock: jest.Mock;
  let verifyMock: jest.Mock;
  let service: AuthService;

  const passwordHash = bcrypt.hashSync('correct-password', 4);
  const user = {
    id: '1',
    name: 'Ana Affiliate',
    email: 'ana@example.com',
    passwordHash,
    role: UserRole.AFFILIATOR,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
  };

  beforeEach(() => {
    findByEmailMock = jest.fn();
    findByIdOrFailMock = jest.fn();
    signMock = jest.fn();
    verifyMock = jest.fn();

    const usersService = {
      findByEmail: findByEmailMock,
      findByIdOrFail: findByIdOrFailMock,
    } as unknown as UsersService;
    const jwtService = {
      sign: signMock,
      verify: verifyMock,
    } as unknown as JwtService;

    service = new AuthService(usersService, jwtService);
  });

  describe('validateUser', () => {
    it('returns the user when the password matches', async () => {
      findByEmailMock.mockResolvedValue(user);

      const result = await service.validateUser(
        'ana@example.com',
        'correct-password',
      );

      expect(result).toBe(user);
    });

    it('rejects an unknown email', async () => {
      findByEmailMock.mockResolvedValue(null);

      await expect(
        service.validateUser('unknown@example.com', 'anything'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      findByEmailMock.mockResolvedValue(user);

      await expect(
        service.validateUser('ana@example.com', 'wrong-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('issueTokens', () => {
    it('signs an access token and a refresh token with the correct type', () => {
      signMock
        .mockReturnValueOnce('access.jwt')
        .mockReturnValueOnce('refresh.jwt');

      const tokens = service.issueTokens(user);

      expect(tokens).toEqual({
        access_token: 'access.jwt',
        refresh_token: 'refresh.jwt',
      });
      expect(signMock).toHaveBeenNthCalledWith(
        1,
        { sub: '1', role: UserRole.AFFILIATOR, type: 'access' },
        { expiresIn: '15m' },
      );
      expect(signMock).toHaveBeenNthCalledWith(
        2,
        { sub: '1', role: UserRole.AFFILIATOR, type: 'refresh' },
        { expiresIn: '7d' },
      );
    });
  });

  describe('refreshAccessToken', () => {
    it('issues a new access token for a valid refresh token', async () => {
      verifyMock.mockReturnValue({
        sub: '1',
        role: UserRole.AFFILIATOR,
        type: 'refresh',
      });
      findByIdOrFailMock.mockResolvedValue(user);
      signMock.mockReturnValue('new-access.jwt');

      const result = await service.refreshAccessToken('refresh.jwt');

      expect(result).toEqual({ access_token: 'new-access.jwt' });
    });

    it('rejects a token that is not a refresh token', async () => {
      verifyMock.mockReturnValue({
        sub: '1',
        role: UserRole.AFFILIATOR,
        type: 'access',
      });

      await expect(
        service.refreshAccessToken('access.jwt'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an invalid or expired token', async () => {
      verifyMock.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(
        service.refreshAccessToken('garbage'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
