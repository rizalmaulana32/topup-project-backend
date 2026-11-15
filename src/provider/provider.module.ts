import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoinSendGuard } from './coin-send-guard.service';
import { CoinSend } from './entities/coin-send.entity';
import { MockProviderTopUpService } from './mock-provider-top-up.service';
import { MomoProviderTopUpService } from './momo-provider-top-up.service';
import {
  PROVIDER_TOP_UP_PORT,
  ProviderTopUpPort,
} from './provider-top-up.port';

@Module({
  imports: [TypeOrmModule.forFeature([CoinSend])],
  providers: [
    CoinSendGuard,
    {
      provide: PROVIDER_TOP_UP_PORT,
      // Only constructs the vendor actually selected - MomoProviderTopUpService
      // requires real credentials (MOMO_MERCHANT_ID/MOMO_API_SECRET) that local
      // dev/tests don't set, so it must never be eagerly instantiated when
      // mock is selected. Defaults to mock; set PROVIDER_TOP_UP_VENDOR=momo to
      // use the real vendor. Always wrapped in the duplicate-send guard.
      useFactory: (
        config: ConfigService,
        guard: CoinSendGuard,
      ): ProviderTopUpPort => {
        const vendor = config.get<string>('PROVIDER_TOP_UP_VENDOR', 'mock');
        return guard.wrap(
          vendor === 'momo'
            ? new MomoProviderTopUpService(config)
            : new MockProviderTopUpService(),
        );
      },
      inject: [ConfigService, CoinSendGuard],
    },
  ],
  exports: [PROVIDER_TOP_UP_PORT, CoinSendGuard],
})
export class ProviderModule {}
