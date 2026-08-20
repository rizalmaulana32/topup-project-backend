import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { ContactService } from './contact.service';
import {
  ContactMessage,
  ContactMessageStatus,
} from './entities/contact-message.entity';

describe('ContactService', () => {
  let createMock: jest.Mock;
  let saveMock: jest.Mock;
  let findOneMock: jest.Mock;
  let findAndCountMock: jest.Mock;
  let sendMock: jest.Mock;
  let configGetMock: jest.Mock;
  let service: ContactService;

  beforeEach(() => {
    createMock = jest.fn();
    saveMock = jest.fn();
    findOneMock = jest.fn();
    findAndCountMock = jest.fn();
    sendMock = jest.fn().mockResolvedValue(undefined);
    configGetMock = jest.fn();

    const repository = {
      create: createMock,
      save: saveMock,
      findOne: findOneMock,
      findAndCount: findAndCountMock,
    } as unknown as Repository<ContactMessage>;
    const emailService = { send: sendMock } as unknown as EmailService;
    const configService = {
      get: configGetMock,
    } as unknown as ConfigService;

    service = new ContactService(repository, emailService, configService);
  });

  describe('create', () => {
    const dto = {
      name: 'Ricky Oktavio',
      email: 'ricky@example.com',
      message: 'Pembayaran saya belum masuk',
    };

    it('stores the message and sends a notification email when configured', async () => {
      createMock.mockReturnValue(dto);
      saveMock.mockResolvedValue({ id: '1', ...dto });
      configGetMock.mockReturnValue('support@yayagency.com');

      const result = await service.create(dto);

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ...dto,
          status: ContactMessageStatus.OPEN,
        }),
      );
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'support@yayagency.com' }),
      );
      expect(result).toEqual({ id: '1', ...dto });
    });

    it('skips the email when no notification address is configured', async () => {
      createMock.mockReturnValue(dto);
      saveMock.mockResolvedValue({ id: '1', ...dto });
      configGetMock.mockReturnValue(undefined);

      await service.create(dto);

      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('markResolved', () => {
    it('flips status to resolved', async () => {
      const existing = { id: '1', status: ContactMessageStatus.OPEN };
      findOneMock.mockResolvedValue(existing);
      saveMock.mockImplementation((v: unknown) => Promise.resolve(v));

      const result = await service.markResolved('1');

      expect(result).toEqual(
        expect.objectContaining({ status: ContactMessageStatus.RESOLVED }),
      );
    });

    it('throws NotFoundException when the message does not exist', async () => {
      findOneMock.mockResolvedValue(null);

      await expect(service.markResolved('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('paginates and optionally filters by status', async () => {
      findAndCountMock.mockResolvedValue([[], 0]);

      await service.findAll({
        status: ContactMessageStatus.OPEN,
        limit: 20,
        offset: 0,
      });

      expect(findAndCountMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ContactMessageStatus.OPEN },
          take: 20,
          skip: 0,
        }),
      );
    });
  });
});
