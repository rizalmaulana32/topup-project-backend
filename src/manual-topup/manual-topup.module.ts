import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderModule } from '../provider/provider.module';
import { UsersModule } from '../users/users.module';
import { AdminProfile } from './entities/admin-profile.entity';
import { ManualTopup } from './entities/manual-topup.entity';
import { ManualTopupSend } from './entities/manual-topup-send.entity';
import { AdminPanelController } from './admin-panel.controller';
import { ManualTopupController } from './manual-topup.controller';
import { ManualTopupService } from './manual-topup.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminProfile, ManualTopup, ManualTopupSend]),
    ProviderModule,
    UsersModule,
  ],
  controllers: [ManualTopupController, AdminPanelController],
  providers: [ManualTopupService],
  exports: [ManualTopupService],
})
export class ManualTopupModule {}
