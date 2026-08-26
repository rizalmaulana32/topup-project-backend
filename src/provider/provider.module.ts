import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockProviderTopUpService } from './mock-provider-top-up.service';
import { MomoProviderTopUpService } from './momo-provider-top-up.service';
import {
  PROVIDER_TOP_UP_PORT,
  ProviderTopUpPort,
} from './provider-top-up.port';

@Module({
  providers: [
    {
      provide: PROVIDER_TOP_UP_PORT,
      // Only constructs the vendor actually selected - MomoProviderTopUpService
      // requires real credentials (MOMO_MERCHANT_ID/MOMO_API_SECRET) that local
      // dev/tests don't set, so it must never be eagerly instantiated when
      // mock is selected. Defaults to mock; set PROVIDER_TOP_UP_VENDOR=momo to
      // use the real vendor.
      useFactory: (config: ConfigService): ProviderTopUpPort => {
        const vendor = config.get<string>('PROVIDER_TOP_UP_VENDOR', 'mock');
        return vendor === 'momo'
          ? new MomoProviderTopUpService(config)
          : new MockProviderTopUpService();
      },
      inject: [ConfigService],
    },
  ],
  exports: [PROVIDER_TOP_UP_PORT],
})
export class ProviderModule {}
