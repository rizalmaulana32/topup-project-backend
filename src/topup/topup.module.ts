import { Module } from '@nestjs/common';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { DuitkuModule } from '../duitku/duitku.module';
import { PlatformModule } from '../platform/platform.module';
import { ProductsModule } from '../products/products.module';
import { ProviderModule } from '../provider/provider.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { TopupController } from './topup.controller';
import { TopupService } from './topup.service';
import { DuitkuWebhookController } from './webhook/duitku-webhook.controller';

@Module({
  imports: [
    ProductsModule,
    TransactionsModule,
    ProviderModule,
    DuitkuModule,
    AffiliatesModule,
    PlatformModule,
  ],
  controllers: [TopupController, DuitkuWebhookController],
  providers: [TopupService],
})
export class TopupModule {}
