import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { FindOptionsWhere, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';
import {
  WithdrawalBase,
  WithdrawalStatus,
} from './entities/commission-withdrawal.entity';

/**
 * Withdrawal rules shared by affiliates and super affiliates - one copy so
 * the two flows can't drift apart.
 */

/** Catch a mistyped Momo ID at request time, not after an admin approves and the send fails. */
export async function assertMomoIdExists(
  provider: ProviderTopUpPort,
  momoUserId: string | undefined,
): Promise<void> {
  try {
    await provider.checkId('', momoUserId ?? '');
  } catch {
    throw new BadRequestException(`Momo ID ${momoUserId} was not found.`);
  }
}

/** Validates a request against the balance and settings; returns the net amount paid out. */
export function priceWithdrawal(params: {
  balance: number;
  amount: number;
  minimumWithdrawal: number;
  adminFee: number;
  isCoin: boolean;
}): number {
  const { balance, amount, minimumWithdrawal, adminFee, isCoin } = params;
  if (balance < minimumWithdrawal) {
    throw new BadRequestException(
      `Commission balance (${balance}) has not reached the minimum withdrawal amount (${minimumWithdrawal}).`,
    );
  }
  if (amount <= 0) {
    throw new BadRequestException('Withdrawal amount must be positive.');
  }
  if (amount > balance) {
    throw new BadRequestException(
      `Requested amount (${amount}) exceeds available commission balance (${balance}).`,
    );
  }
  const netAmount = amount - adminFee;
  if (netAmount <= 0) {
    throw new BadRequestException(
      `Requested amount (${amount}) does not cover the withdrawal admin fee (${adminFee}).`,
    );
  }
  if (isCoin && !Number.isInteger(netAmount)) {
    throw new BadRequestException(
      `Net amount (${netAmount}) must be a whole number to pay out as Momo coins.`,
    );
  }
  return netAmount;
}

/**
 * Sends a momo_coin withdrawal's net_amount coins. The row is claimed
 * APPROVED -> PAID before sending, so a double click or retry can never
 * send twice. If MomoLive definitely refused (nothing sent) it goes back to
 * APPROVED for a retry. If the outcome is unknown (network error, timeout,
 * non-JSON reply) it stays PAID with a note: the coins may have arrived,
 * and re-sending is how WDW duplicates happened before (2026-11-07).
 */
export async function sendMomoCoinPayout<T extends WithdrawalBase>(
  repository: Repository<T>,
  provider: ProviderTopUpPort,
  logger: Logger,
  withdrawal: T,
  adminUserId: string,
  notes: string | undefined,
  productProviderCode: string,
): Promise<void> {
  const update = (
    where: string | Partial<WithdrawalBase>,
    patch: Partial<WithdrawalBase>,
  ) =>
    repository.update(
      where as string | FindOptionsWhere<T>,
      patch as QueryDeepPartialEntity<T>,
    );

  const claimed = await update(
    { id: withdrawal.id, status: WithdrawalStatus.APPROVED },
    {
      status: WithdrawalStatus.PAID,
      processedBy: adminUserId,
      processedAt: new Date(),
    },
  );
  if (!claimed.affected) {
    throw new ConflictException(
      `Withdrawal ${withdrawal.id} is not approved (current status: ${withdrawal.status})`,
    );
  }

  const result = await provider
    .injectCoin({
      productProviderCode,
      targetUserId: withdrawal.momoUserId ?? '',
      coin: Number(withdrawal.netAmount),
    })
    .catch((error: unknown) => ({
      success: false,
      rejected: false,
      response: error instanceof Error ? error.message : String(error),
    }));
  const prefix = notes ? `${notes} | ` : '';

  if (result.success) {
    await update(withdrawal.id, {
      adminNotes: `${prefix}Momo coin send: ${result.response}`,
    });
    return;
  }

  if (result.rejected) {
    await update(withdrawal.id, {
      status: WithdrawalStatus.APPROVED,
      processedBy: null,
      processedAt: null,
    });
    throw new BadGatewayException(
      `MomoLive refused the coin send for withdrawal ${withdrawal.id} (nothing sent, still approved - retry): ${result.response}`,
    );
  }

  await update(withdrawal.id, {
    adminNotes: `${prefix}UNVERIFIED Momo coin send - check MomoLive before sending again: ${result.response}`,
  });
  logger.error(
    `Momo coin send for withdrawal ${withdrawal.id} has an unknown outcome: ${result.response}`,
  );
  throw new BadGatewayException(
    `Momo coin send for withdrawal ${withdrawal.id} has an unknown outcome: ${result.response}. Marked paid to prevent a duplicate send - check in MomoLive whether the coins arrived.`,
  );
}
