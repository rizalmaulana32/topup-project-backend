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
      });

      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          basePrice: '15000.00',
          sellingPrice: '20000.00',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ basePrice: '15000.00' }),
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
