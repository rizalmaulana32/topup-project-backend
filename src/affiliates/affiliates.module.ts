import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DuitkuModule } from '../duitku/duitku.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatesService } from './affiliates.service';
import { AffiliatorProfile } from './entities/affiliator-profile.entity';
import { CommissionLog } from './entities/commission-log.entity';
import { CommissionWithdrawal } from './entities/commission-withdrawal.entity';
import { DuitkuDisbursementWebhookController } from './webhook/duitku-disbursement-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AffiliatorProfile,
      CommissionLog,
      CommissionWithdrawal,
    ]),
    UsersModule,
    TransactionsModule,
    AuthModule,
    SettingsModule,
    DuitkuModule,
  ],
  controllers: [AffiliatesController, DuitkuDisbursementWebhookController],
  providers: [AffiliatesService],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}
