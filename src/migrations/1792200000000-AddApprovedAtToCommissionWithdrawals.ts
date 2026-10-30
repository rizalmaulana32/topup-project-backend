import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApprovedAtToCommissionWithdrawals1792200000000
  implements MigrationInterface
{
  name = 'AddApprovedAtToCommissionWithdrawals1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ADD "approved_by" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ADD "approved_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" DROP COLUMN "approved_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" DROP COLUMN "approved_by"`,
    );
  }
}
