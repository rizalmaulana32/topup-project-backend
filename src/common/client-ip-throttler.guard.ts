import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * ThrottlerGuard keyed on the real client. Behind Cloudflare + nginx, req.ip
 * is nginx's 127.0.0.1 for everyone, so a "per IP" limit was one limit
 * shared by every visitor.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  // ponytail: CF-Connecting-IP can be forged by hitting the origin directly (bypassing Cloudflare); that only dodges the limit. Restrict the origin to Cloudflare IPs if it matters.
  protected getTracker(req: Request): Promise<string> {
    const cfIp = req.headers['cf-connecting-ip'];
    return Promise.resolve(
      (typeof cfIp === 'string' && cfIp) || req.ip || 'unknown',
    );
  }
}
