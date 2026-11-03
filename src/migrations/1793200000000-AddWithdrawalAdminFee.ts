import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWithdrawalAdminFee1793200000000 implements MigrationInterface {
  name = 'AddWithdrawalAdminFee1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "withdrawal_admin_fee" numeric(14,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ADD "admin_fee" numeric(14,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ADD "net_amount" numeric(14,2)`,
    );
    // Backfill existing rows (fee was 0 before this feature existed).
    await queryRunner.query(
      `UPDATE "commission_withdrawals" SET "net_amount" = "amount" WHERE "net_amount" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ALTER COLUMN "net_amount" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" DROP COLUMN "net_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" DROP COLUMN "admin_fee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "withdrawal_admin_fee"`,
    );
  }
}
