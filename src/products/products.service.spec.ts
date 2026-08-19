import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let findOneMock: jest.Mock;
  let findMock: jest.Mock;
  let createMock: jest.Mock;
  let saveMock: jest.Mock;
  let service: ProductsService;

  beforeEach(() => {
    findOneMock = jest.fn();
    findMock = jest.fn();
    createMock = jest.fn();
    saveMock = jest.fn();

    const repository = {
      findOne: findOneMock,
      find: findMock,
      create: createMock,
      save: saveMock,
    } as unknown as Repository<Product>;

    service = new ProductsService(repository);
  });

  describe('findActiveByIdOrFail', () => {
    it('throws NotFoundException when no active product matches', async () => {
      findOneMock.mockResolvedValue(null);

      await expect(service.findActiveByIdOrFail('1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('formats prices to two decimal places', async () => {
      createMock.mockImplementation((v: unknown) => v);
      saveMock.mockImplementation((v: unknown) => Promise.resolve(v));

      const result = await service.create({
        name: '120 Diamonds',
        providerCode: 'ml_120',
        basePrice: 15000,
        sellingPrice: 20000,
        coinAmount: 120,
      });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          basePrice: '15000.00',
          sellingPrice: '20000.00',
          coinAmount: '120.00',
          bonusCoin: '0.00',
          flag: null,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ basePrice: '15000.00' }),
      );
    });

    it('formats bonus_coin and keeps an explicit flag', async () => {
      createMock.mockImplementation((v: unknown) => v);
      saveMock.mockImplementation((v: unknown) => Promise.resolve(v));

      await service.create({
        name: '30M Koin (+600K Bonus)',
        providerCode: 'MOMO_30M',
        basePrice: 30000000,
        sellingPrice: 30000000,
        coinAmount: 30000000,
        bonusCoin: 600000,
        flag: 'Terlaris',
      });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          coinAmount: '30000000.00',
          bonusCoin: '600000.00',
          flag: 'Terlaris',
        }),
      );
    });
  });

  describe('update', () => {
    it('only overwrites provided fields', async () => {
      const existing: Partial<Product> = {
        id: '1',
        name: 'Old Name',
        providerCode: 'old_code',
        basePrice: '10000.00',
        sellingPrice: '15000.00',
        status: ProductStatus.ACTIVE,
      };
      findOneMock.mockResolvedValue(existing);
      saveMock.mockImplementation((v: unknown) => Promise.resolve(v));

      const result = await service.update('1', {
        status: ProductStatus.INACTIVE,
      });

      expect(result).toEqual(
        expect.objectContaining({
          name: 'Old Name',
          status: ProductStatus.INACTIVE,
        }),
      );
    });
  });
});
