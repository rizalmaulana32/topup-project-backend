import { Module } from '@nestjs/common';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { BonusTiersModule } from '../bonus-tiers/bonus-tiers.module';
import { LinkQuModule } from '../linkqu/linkqu.module';
import { PlatformModule } from '../platform/platform.module';
import { ProviderModule } from '../provider/provider.module';
import { SettingsModule } from '../settings/settings.module';
import { SuperAffiliatesModule } from '../super-affiliates/super-affiliates.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';
import { TransactionReconciliationService } from './transaction-reconciliation.service';
import { LinkQuWebhookController } from './webhook/linkqu-webhook.controller';

@Module({
  imports: [
    TransactionsModule,
    ProviderModule,
    LinkQuModule,
    AffiliatesModule,
    PlatformModule,
    SettingsModule,
    BonusTiersModule,
    SuperAffiliatesModule,
  ],
  controllers: [TopupController, LinkQuWebhookController],
  providers: [TopupService, TransactionReconciliationService],
  exports: [TopupService],
})
export class TopupModule {}
