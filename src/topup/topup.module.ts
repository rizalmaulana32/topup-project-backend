import { Module } from '@nestjs/common';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { ProductsModule } from '../products/products.module';
import { ProviderModule } from '../provider/provider.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { XenditModule } from '../xendit/xendit.module';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';
import { XenditWebhookController } from './webhook/xendit-webhook.controller';

@Module({
  imports: [
    ProductsModule,
    TransactionsModule,
    ProviderModule,
    XenditModule,
    AffiliatesModule,
  ],
  controllers: [TopupController, XenditWebhookController],
  providers: [TopupService],
})
export class TopupModule {}
