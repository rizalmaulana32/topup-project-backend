import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DuitkuModule } from '../duitku/duitku.module';
import { PlatformSettings } from '../settings/entities/platform-settings.entity';
import { PlatformRevenueLog } from './entities/platform-revenue-log.entity';
import { PlatformWithdrawal } from './entities/platform-withdrawal.entity';
import { PlatformService } from './platform.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformSettings,
      PlatformRevenueLog,
      PlatformWithdrawal,
    ]),
    DuitkuModule,
  ],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
