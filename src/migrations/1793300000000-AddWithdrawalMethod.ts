import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWithdrawalMethod1793300000000 implements MigrationInterface {
  name = 'AddWithdrawalMethod1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."commission_withdrawals_method_enum" AS ENUM('bank', 'momo_coin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ADD "method" "public"."commission_withdrawals_method_enum" NOT NULL DEFAULT 'bank'`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ADD "momo_user_id" character varying`,
    );
    // Momo coin payouts have no bank account.
    for (const column of ['bank_name', 'account_number', 'account_holder']) {
      await queryRunner.query(
        `ALTER TABLE "commission_withdrawals" ALTER COLUMN "${column}" DROP NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['bank_name', 'account_number', 'account_holder']) {
      await queryRunner.query(
        `UPDATE "commission_withdrawals" SET "${column}" = '' WHERE "${column}" IS NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "commission_withdrawals" ALTER COLUMN "${column}" SET NOT NULL`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" DROP COLUMN "momo_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" DROP COLUMN "method"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."commission_withdrawals_method_enum"`,
    );
  }
}
