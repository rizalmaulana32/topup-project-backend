import { Module } from '@nestjs/common';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { LinkQuModule } from '../linkqu/linkqu.module';
import { PlatformModule } from '../platform/platform.module';
import { ProductsModule } from '../products/products.module';
import { ProviderModule } from '../provider/provider.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';
import { TransactionReconciliationService } from './transaction-reconciliation.service';
import { LinkQuWebhookController } from './webhook/linkqu-webhook.controller';

@Module({
  imports: [
    ProductsModule,
    TransactionsModule,
    ProviderModule,
    LinkQuModule,
    AffiliatesModule,
    PlatformModule,
    SettingsModule,
  ],
  controllers: [TopupController, LinkQuWebhookController],
  providers: [TopupService, TransactionReconciliationService],
  exports: [TopupService],
})
export class TopupModule {}
