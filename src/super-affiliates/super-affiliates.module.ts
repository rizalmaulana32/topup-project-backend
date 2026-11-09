import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AffiliatorProfile } from '../affiliates/entities/affiliator-profile.entity';
import { AuthModule } from '../auth/auth.module';
import { ProviderModule } from '../provider/provider.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { SuperAffiliateCommissionLog } from './entities/super-affiliate-commission-log.entity';
import { SuperAffiliateProfile } from './entities/super-affiliate-profile.entity';
import { SuperAffiliateWithdrawal } from './entities/super-affiliate-withdrawal.entity';
import { SuperAffiliatesAdminController } from './super-affiliates-admin.controller';
import { SuperAffiliatesController } from './super-affiliates.controller';
import { SuperAffiliatesService } from './super-affiliates.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SuperAffiliateProfile,
      SuperAffiliateCommissionLog,
      SuperAffiliateWithdrawal,
      AffiliatorProfile,
    ]),
    UsersModule,
    AuthModule,
    SettingsModule,
    ProviderModule,
  ],
  controllers: [SuperAffiliatesController, SuperAffiliatesAdminController],
  providers: [SuperAffiliatesService],
  exports: [SuperAffiliatesService],
})
export class SuperAffiliatesModule {}
