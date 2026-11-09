import { Module } from '@nestjs/common';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { AuthModule } from '../auth/auth.module';
import { BonusTiersModule } from '../bonus-tiers/bonus-tiers.module';
import { ContactModule } from '../contact/contact.module';
import { LinkQuModule } from '../linkqu/linkqu.module';
import { PlatformModule } from '../platform/platform.module';
import { ProviderModule } from '../provider/provider.module';
import { SettingsModule } from '../settings/settings.module';
import { TopupModule } from '../topup/topup.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    AffiliatesModule,
    SettingsModule,
    TransactionsModule,
    AuthModule,
    ContactModule,
    ProviderModule,
    LinkQuModule,
    PlatformModule,
    TopupModule,
    BonusTiersModule,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
