import { Module } from '@nestjs/common';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { AuthModule } from '../auth/auth.module';
import { ContactModule } from '../contact/contact.module';
import { ProductsModule } from '../products/products.module';
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
  ],
  controllers: [AdminController],
})
export class AdminModule {}
