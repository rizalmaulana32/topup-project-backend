import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LinkQuModule } from '../linkqu/linkqu.module';
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
    LinkQuModule,
  ],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
