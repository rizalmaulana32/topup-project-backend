import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoinSendAudit1794200000000 implements MigrationInterface {
  name = 'AddCoinSendAudit1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coin_sends" ADD "admin_id" bigint, ADD "reason" text, ADD "provider_response" text, ADD "balance_after" numeric(14,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "coin_sends" DROP COLUMN "balance_after", DROP COLUMN "provider_response", DROP COLUMN "reason", DROP COLUMN "admin_id"`,
    );
  }
}
