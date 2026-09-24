import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { LinkQuModule } from '../linkqu/linkqu.module';
import { PlatformModule } from '../platform/platform.module';
import { SettingsModule } from '../settings/settings.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { UsersModule } from '../users/users.module';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatesService } from './affiliates.service';
import { AffiliatorProfile } from './entities/affiliator-profile.entity';
import { CommissionLog } from './entities/commission-log.entity';
import { CommissionWithdrawal } from './entities/commission-withdrawal.entity';
import { LinkQuDisbursementWebhookController } from './webhook/linkqu-disbursement-webhook.controller';

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
    LinkQuModule,
    PlatformModule,
  ],
  controllers: [AffiliatesController, LinkQuDisbursementWebhookController],
  providers: [AffiliatesService],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}
