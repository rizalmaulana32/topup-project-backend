import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';

const SETTINGS_ROW_ID = 1;

/** Image type from magic bytes; null if not png/jpeg/webp. */
export function detectImageMimeType(buf: Buffer): string | null {
  if (buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (buf.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) {
    return 'image/jpeg';
  }
  if (
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(PlatformSettings)
    private readonly settingsRepository: Repository<PlatformSettings>,
  ) {}

  async get(): Promise<PlatformSettings> {
    const existing = await this.settingsRepository.findOne({
      where: { id: SETTINGS_ROW_ID },
    });
    if (existing) {
      return existing;
    }

    const defaults = this.settingsRepository.create({ id: SETTINGS_ROW_ID });
    return this.settingsRepository.save(defaults);
  }

  async update(params: {
    globalCommissionRate?: number;
    minimumWithdrawalAmount?: number;
    customAmountMarginRate?: number;
    customAmountExtraCoinEnabled?: boolean;
    customerDiscountRate?: number;
    customerDiscountMinAmount?: number;
    withdrawalAdminFee?: number;
    adminBankName?: string;
    adminAccountNumber?: string;
    adminAccountHolder?: string;
    manualQrisEnabled?: boolean;
  }): Promise<PlatformSettings> {
    const current = await this.get();

    if (params.globalCommissionRate !== undefined) {
      current.globalCommissionRate = params.globalCommissionRate.toFixed(2);
    }
    if (params.minimumWithdrawalAmount !== undefined) {
      current.minimumWithdrawalAmount =
        params.minimumWithdrawalAmount.toFixed(2);
    }
    if (params.customAmountMarginRate !== undefined) {
      current.customAmountMarginRate = params.customAmountMarginRate.toFixed(2);
    }
    if (params.customAmountExtraCoinEnabled !== undefined) {
      current.customAmountExtraCoinEnabled =
        params.customAmountExtraCoinEnabled;
    }
    if (params.customerDiscountRate !== undefined) {
      current.customerDiscountRate = params.customerDiscountRate.toFixed(2);
    }
    if (params.customerDiscountMinAmount !== undefined) {
      current.customerDiscountMinAmount =
        params.customerDiscountMinAmount.toFixed(2);
    }
    if (params.withdrawalAdminFee !== undefined) {
      current.withdrawalAdminFee = params.withdrawalAdminFee.toFixed(2);
    }
    if (params.adminBankName !== undefined) {
      current.adminBankName = params.adminBankName;
    }
    if (params.adminAccountNumber !== undefined) {
      current.adminAccountNumber = params.adminAccountNumber;
    }
    if (params.adminAccountHolder !== undefined) {
      current.adminAccountHolder = params.adminAccountHolder;
    }
    if (params.manualQrisEnabled !== undefined) {
      current.manualQrisEnabled = params.manualQrisEnabled;
    }

    return this.settingsRepository.save(current);
  }

  async setManualQris(image: Buffer): Promise<PlatformSettings> {
    const mimeType = detectImageMimeType(image);
    if (!mimeType) {
      throw new BadRequestException('QRIS image must be PNG, JPEG or WebP');
    }
    await this.get();
    await this.settingsRepository.update(SETTINGS_ROW_ID, {
      manualQrisImage: image,
      manualQrisMimeType: mimeType,
    });
    return this.get();
  }

  async clearManualQris(): Promise<PlatformSettings> {
    await this.get();
    await this.settingsRepository.update(SETTINGS_ROW_ID, {
      manualQrisImage: null,
      manualQrisMimeType: null,
      manualQrisEnabled: false,
    });
    return this.get();
  }

  /** The uploaded image, or null if none (ignores the enabled toggle). */
  async getManualQris(): Promise<{ image: Buffer; mimeType: string } | null> {
    const row = await this.settingsRepository
      .createQueryBuilder('s')
      .addSelect('s.manualQrisImage')
      .where('s.id = :id', { id: SETTINGS_ROW_ID })
      .getOne();
    if (!row?.manualQrisImage || !row.manualQrisMimeType) {
      return null;
    }
    return { image: row.manualQrisImage, mimeType: row.manualQrisMimeType };
  }
}
