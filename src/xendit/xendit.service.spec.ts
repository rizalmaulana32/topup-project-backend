import { ConfigService } from '@nestjs/config';
import { XenditService } from './xendit.service';

function buildService(env: Record<string, string>): XenditService {
  const configService = {
    getOrThrow: (key: string) => {
      if (!(key in env)) {
        throw new Error(`Missing config key: ${key}`);
      }
      return env[key];
    },
  } as unknown as ConfigService;

  return new XenditService(configService);
}

describe('XenditService', () => {
  const env = {
    XENDIT_SECRET_KEY: 'xnd_development_test_key',
    XENDIT_CALLBACK_TOKEN: 'expected-callback-token',
  };

  it('accepts the correct callback token', () => {
    const service = buildService(env);

    expect(service.verifyCallbackToken('expected-callback-token')).toBe(true);
  });

  it('rejects an incorrect callback token', () => {
    const service = buildService(env);

    expect(service.verifyCallbackToken('wrong-token')).toBe(false);
  });

  it('rejects a missing callback token', () => {
    const service = buildService(env);

    expect(service.verifyCallbackToken(undefined)).toBe(false);
  });

  it('rejects a callback token of a different length without throwing', () => {
    const service = buildService(env);

    expect(service.verifyCallbackToken('short')).toBe(false);
  });
});
