import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data-preserving rename, same pattern as the earlier
 * RenameXenditColumnsToDuitku1787676524635 migration - pure ALTER TABLE
 * RENAME COLUMN/CONSTRAINT statements, verified by inspection (no
 * migration:generate diff tool involved, so there is no drop+recreate risk
 * to double-check here the way there was for that one).
 *
 * Also adds 'approved' to platform_withdrawals_status_enum: LinkQu's
 * withdraw/payment can genuinely return PENDING (unlike Duitku's always-
 * synchronous Transfer Online), and PlatformWithdrawalStatus.APPROVED
 * models "sent to LinkQu, awaiting its disbursement callback" - mirroring
 * CommissionWithdrawal's WithdrawalStatus.APPROVED, which already existed
 * in that enum (unused under Duitku, now live under LinkQu).
 */
export class RenameDuitkuColumnsToLinkQu1790160000000 implements MigrationInterface {
  name = 'RenameDuitkuColumnsToLinkQu1790160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "duitku_reference" TO "linkqu_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME CONSTRAINT "UQ_140657c52b0123d0252056102f2" TO "UQ_transactions_linkqu_reference"`,
    );

    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" RENAME COLUMN "duitku_disbursement_id" TO "linkqu_disbursement_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" RENAME CONSTRAINT "UQ_d732e48d6ab7ceedfdbe814f9d6" TO "UQ_commission_withdrawals_linkqu_disbursement_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "platform_withdrawals" RENAME COLUMN "duitku_disbursement_id" TO "linkqu_disbursement_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_withdrawals" RENAME CONSTRAINT "UQ_87b4f2c2d3956a115e63000a1cd" TO "UQ_platform_withdrawals_linkqu_disbursement_id"`,
    );

    // Postgres requires ADD VALUE to run outside the migration's implicit
    // transaction in older versions; TypeORM/pg run each query() call
    // separately here (not one wrapping BEGIN/COMMIT block per statement),
    // so this is safe on the Postgres versions this project targets.
    await queryRunner.query(
      `ALTER TYPE "public"."platform_withdrawals_status_enum" ADD VALUE IF NOT EXISTS 'approved'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no DROP VALUE for enums; the added 'approved' value is
    // left in place on down() (harmless - it simply becomes unused again,
    // same as it was dead-but-present in WithdrawalStatus under Duitku).
    await queryRunner.query(
      `ALTER TABLE "platform_withdrawals" RENAME CONSTRAINT "UQ_platform_withdrawals_linkqu_disbursement_id" TO "UQ_87b4f2c2d3956a115e63000a1cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_withdrawals" RENAME COLUMN "linkqu_disbursement_id" TO "duitku_disbursement_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" RENAME CONSTRAINT "UQ_commission_withdrawals_linkqu_disbursement_id" TO "UQ_d732e48d6ab7ceedfdbe814f9d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" RENAME COLUMN "linkqu_disbursement_id" TO "duitku_disbursement_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME CONSTRAINT "UQ_transactions_linkqu_reference" TO "UQ_140657c52b0123d0252056102f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "linkqu_reference" TO "duitku_reference"`,
    );
  }
}
