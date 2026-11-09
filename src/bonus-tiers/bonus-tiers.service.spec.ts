import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BonusTiersService } from './bonus-tiers.service';
import { BonusTier } from './entities/bonus-tier.entity';

describe('BonusTiersService', () => {
  const existing = [
    {
      id: '1',
      minAmount: 100000,
      maxAmount: 300000,
      bonusPercent: 1,
      isActive: true,
    },
    {
      id: '2',
      minAmount: 300000,
      maxAmount: 500000,
      bonusPercent: 2,
      isActive: false,
    },
  ] as BonusTier[];
  let save: jest.Mock;
  let service: BonusTiersService;

  beforeEach(() => {
    save = jest.fn((t: BonusTier) => Promise.resolve(t));
    const repo = {
      find: jest.fn().mockResolvedValue(existing),
      findOne: jest.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(existing.find((t) => t.id === id) ?? null),
      ),
      create: jest.fn((t: Partial<BonusTier>) => ({ ...t })),
      save,
    };
    service = new BonusTiersService(repo as unknown as Repository<BonusTier>);
  });

  it('accepts a range that starts exactly where another ends', async () => {
    await service.create({
      minAmount: 500000,
      maxAmount: null,
      bonusPercent: 3,
    });
    expect(save).toHaveBeenCalled();
  });

  it('rejects an overlap, naming the clashing range - inactive tiers count too', async () => {
    await expect(
      service.create({ minAmount: 400000, maxAmount: null, bonusPercent: 3 }),
    ).rejects.toThrow(
      new BadRequestException(
        'Rentang bentrok dengan rentang 300.000 – 500.000.',
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects max_amount <= min_amount', async () => {
    await expect(
      service.create({ minAmount: 300000, maxAmount: 300000, bonusPercent: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not count the tier being edited as a clash with itself', async () => {
    await service.update('1', { bonusPercent: 5 });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ bonusPercent: 5 }),
    );
  });

  it('rejects an edit that grows into a neighbour', async () => {
    await expect(
      service.update('1', { maxAmount: 350000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
