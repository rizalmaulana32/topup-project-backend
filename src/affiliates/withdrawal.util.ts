import { BadRequestException } from '@nestjs/common';
import type { ProviderTopUpPort } from '../provider/provider-top-up.port';

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
