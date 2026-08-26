import { Module } from '@nestjs/common';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { AuthModule } from '../auth/auth.module';
import { ContactModule } from '../contact/contact.module';
import { DuitkuModule } from '../duitku/duitku.module';
import { PlatformModule } from '../platform/platform.module';
import { ProductsModule } from '../products/products.module';
import { ProviderModule } from '../provider/provider.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    AffiliatesModule,
    SettingsModule,
    ProductsModule,
    TransactionsModule,
    AuthModule,
    ContactModule,
    ProviderModule,
    DuitkuModule,
    PlatformModule,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
