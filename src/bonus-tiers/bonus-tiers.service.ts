import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BonusTier } from './entities/bonus-tier.entity';

interface BonusTierParams {
  minAmount?: number;
  maxAmount?: number | null;
  bonusPercent?: number;
  isActive?: boolean;
}

const upper = (t: { maxAmount: number | null }) => t.maxAmount ?? Infinity;
const rupiah = (n: number) => n.toLocaleString('id-ID');
const formatRange = (t: BonusTier) =>
  t.maxAmount === null
    ? `≥ ${rupiah(t.minAmount)}`
    : `${rupiah(t.minAmount)} – ${rupiah(t.maxAmount)}`;

@Injectable()
export class BonusTiersService {
  constructor(
    @InjectRepository(BonusTier)
    private readonly bonusTierRepository: Repository<BonusTier>,
  ) {}

  findAll(): Promise<BonusTier[]> {
    return this.bonusTierRepository.find({ order: { minAmount: 'ASC' } });
  }

  async create(params: BonusTierParams): Promise<BonusTier> {
    const tier = this.bonusTierRepository.create({
      minAmount: params.minAmount,
      maxAmount: params.maxAmount ?? null,
      bonusPercent: params.bonusPercent,
      isActive: params.isActive ?? true,
    });
    await this.assertValidRange(tier);
    return this.bonusTierRepository.save(tier);
  }

  async update(id: string, params: BonusTierParams): Promise<BonusTier> {
    const tier = await this.findByIdOrFail(id);
    if (params.minAmount !== undefined) tier.minAmount = params.minAmount;
    if (params.maxAmount !== undefined) tier.maxAmount = params.maxAmount;
    if (params.bonusPercent !== undefined)
      tier.bonusPercent = params.bonusPercent;
    if (params.isActive !== undefined) tier.isActive = params.isActive;
    await this.assertValidRange(tier);
    return this.bonusTierRepository.save(tier);
  }

  async remove(id: string): Promise<void> {
    await this.findByIdOrFail(id);
    await this.bonusTierRepository.delete(id);
  }

  private async findByIdOrFail(id: string): Promise<BonusTier> {
    const tier = await this.bonusTierRepository.findOne({ where: { id } });
    if (!tier) throw new NotFoundException(`Bonus tier ${id} not found`);
    return tier;
  }

  private async assertValidRange(tier: BonusTier): Promise<void> {
    if (tier.maxAmount !== null && !(tier.maxAmount > tier.minAmount)) {
      throw new BadRequestException(
        'Harga maksimum harus lebih besar dari minimum.',
      );
    }
    // Inactive tiers count too, so re-activating one can never clash.
    const clash = (await this.findAll()).find(
      (o) =>
        o.id !== tier.id &&
        tier.minAmount < upper(o) &&
        o.minAmount < upper(tier),
    );
    if (clash) {
      throw new BadRequestException(
        `Rentang bentrok dengan rentang ${formatRange(clash)}.`,
      );
    }
  }
}
