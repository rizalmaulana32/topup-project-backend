import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSettings } from './entities/platform-settings.entity';

const SETTINGS_ROW_ID = 1;

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
    adminBankName?: string;
    adminAccountNumber?: string;
    adminAccountHolder?: string;
  }): Promise<PlatformSettings> {
    const current = await this.get();

    if (params.globalCommissionRate !== undefined) {
      current.globalCommissionRate = params.globalCommissionRate.toFixed(2);
    }
    if (params.minimumWithdrawalAmount !== undefined) {
      current.minimumWithdrawalAmount =
        params.minimumWithdrawalAmount.toFixed(2);
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

    return this.settingsRepository.save(current);
  }
}
