import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let findOneMock: jest.Mock;
  let createMock: jest.Mock;
  let saveMock: jest.Mock;
  let updateMock: jest.Mock;
  let service: UsersService;

  beforeEach(() => {
    findOneMock = jest.fn();
    createMock = jest.fn();
    saveMock = jest.fn();
    updateMock = jest.fn();

    const userRepository = {
      findOne: findOneMock,
      create: createMock,
      save: saveMock,
      update: updateMock,
    } as unknown as Repository<User>;

    service = new UsersService(userRepository);
  });

  describe('createUser', () => {
    it('rejects an email that already belongs to any user', async () => {
      findOneMock.mockResolvedValue({ id: '1', email: 'taken@example.com' });

      await expect(
        service.createUser({
          name: 'New User',
          email: 'taken@example.com',
          passwordHash: 'hash',
          role: UserRole.AFFILIATOR,
          status: UserStatus.PENDING_APPROVAL,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates the user when the email is free', async () => {
      findOneMock.mockResolvedValue(null);
      createMock.mockReturnValue({ email: 'free@example.com' });
      saveMock.mockResolvedValue({ id: '1', email: 'free@example.com' });

      const result = await service.createUser({
        name: 'New User',
        email: 'free@example.com',
        passwordHash: 'hash',
        role: UserRole.AFFILIATOR,
        status: UserStatus.PENDING_APPROVAL,
      });

      expect(result).toEqual({ id: '1', email: 'free@example.com' });
    });
  });

  describe('archiveEmailForReuse', () => {
    it('renames the stored email so the original becomes free, without touching anything else', async () => {
      findOneMock.mockResolvedValue({
        id: '42',
        email: 'affiliate@example.com',
      });

      await service.archiveEmailForReuse('42');

      expect(updateMock).toHaveBeenCalledTimes(1);
      const [id, patch] = updateMock.mock.calls[0] as [string, { email: string }];
      expect(id).toBe('42');
      expect(patch.email).toMatch(/^deleted-\d+-affiliate@example\.com$/);
    });

    it('is a no-op when the user no longer exists', async () => {
      findOneMock.mockResolvedValue(null);

      await service.archiveEmailForReuse('missing');

      expect(updateMock).not.toHaveBeenCalled();
    });
  });
});
