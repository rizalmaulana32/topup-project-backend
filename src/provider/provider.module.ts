import { Module } from '@nestjs/common';
import { MockProviderTopUpService } from './mock-provider-top-up.service';
import { PROVIDER_TOP_UP_PORT } from './provider-top-up.port';

@Module({
  providers: [
    {
      provide: PROVIDER_TOP_UP_PORT,
      useClass: MockProviderTopUpService,
    },
  ],
  exports: [PROVIDER_TOP_UP_PORT],
})
export class ProviderModule {}
