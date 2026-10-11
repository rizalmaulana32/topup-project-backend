import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LinkQuService } from '../linkqu/linkqu.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TopupService } from './topup.service';

/**
 * Safety net for a real, recurring pattern: a customer pays via LinkQu,
 * LinkQu's own checkstatus confirms it, but the webhook never arrives -
 * first seen during a server outage (2026-10-10), then confirmed again
 * on a fully healthy server (2026-10-11, Shopee e-wallet payment,
 * TRX-20261011-0684) - so webhook delivery itself is not 100% reliable
 * even without any infrastructure problem on our side. This sweep
 * periodically re-checks every PENDING transaction that has a LinkQu
 * invoice directly against LinkQu's own checkstatus API and
 * completes/expires it itself if the webhook never shows up, instead of
 * relying on a human noticing and replaying it manually.
 *
 * Runs every minute (tightened from every 5 minutes 2026-10-11) so a
 * missed webhook never costs more than ~60s instead of up to 5 minutes -
 * cheap to run this often since it's a no-op fast return whenever there's
 * nothing pending.
 *
 * Reuses TopupService.handleInvoicePaid/handleInvoiceExpired - the exact
 * same atomic, idempotent completion path the real webhook uses (see the
 * 2026-10-05 race-condition fix), so this can never double-process a
 * transaction even if it runs at the same moment a real webhook finally
 * arrives.
 */
const LINKQU_INVOICE_EXPIRY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TransactionReconciliationService {
  private readonly logger = new Logger(TransactionReconciliationService.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly linkQuService: LinkQuService,
    private readonly topupService: TopupService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcilePendingTransactions(): Promise<void> {
    const pending =
      await this.transactionsService.findPendingWithLinkQuReference();

    if (pending.length === 0) {
      return;
    }

    this.logger.log(
      `Reconciling ${pending.length} pending transaction(s) against LinkQu`,
    );

    for (const transaction of pending) {
      try {
        const status = await this.linkQuService.checkTransactionStatus(
          transaction.id,
        );

        if (status.statusCode === 'success') {
          this.logger.warn(
            `Transaction ${transaction.id} is paid on LinkQu's side but was still PENDING here - completing it now (webhook was likely lost).`,
          );
          await this.topupService.handleInvoicePaid(transaction.id);
          continue;
        }

        const ageMs = Date.now() - transaction.createdAt.getTime();
        if (ageMs > LINKQU_INVOICE_EXPIRY_MS) {
          this.logger.log(
            `Transaction ${transaction.id} is past its 24h invoice window and still unpaid on LinkQu - marking expired.`,
          );
          await this.topupService.handleInvoiceExpired(transaction.id);
        }
      } catch (error) {
        // One transaction's check failing (e.g. a transient LinkQu error)
        // must not stop the rest of the sweep from running.
        this.logger.warn(
          `Reconciliation check failed for ${transaction.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
  }
}
