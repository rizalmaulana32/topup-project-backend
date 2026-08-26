import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlatformRevenueAndWithdrawal1787737048257 implements MigrationInterface {
  name = 'AddPlatformRevenueAndWithdrawal1787737048257';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."platform_revenue_logs_type_enum" AS ENUM('credit', 'debit')`,
    );
    await queryRunner.query(
      `CREATE TABLE "platform_revenue_logs" ("id" BIGSERIAL NOT NULL, "transaction_id" character varying, "withdrawal_id" character varying, "type" "public"."platform_revenue_logs_type_enum" NOT NULL, "amount" numeric(14,2) NOT NULL, "balance_after" numeric(14,2) NOT NULL, "description" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_17fbe365c4cf09dcf5ae56cc7d8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."platform_withdrawals_status_enum" AS ENUM('pending', 'rejected', 'paid', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "platform_withdrawals" ("id" character varying NOT NULL, "amount" numeric(14,2) NOT NULL, "bank_name" character varying NOT NULL, "account_number" character varying NOT NULL, "account_holder" character varying NOT NULL, "status" "public"."platform_withdrawals_status_enum" NOT NULL DEFAULT 'pending', "duitku_disbursement_id" character varying, "processed_by" bigint, "processed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_87b4f2c2d3956a115e63000a1cd" UNIQUE ("duitku_disbursement_id"), CONSTRAINT "PK_6972924348852fb71ef1eb4f8b5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "platform_balance" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "admin_bank_name" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "admin_account_number" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" ADD "admin_account_holder" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "admin_account_holder"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "admin_account_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "admin_bank_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "platform_settings" DROP COLUMN "platform_balance"`,
    );
    await queryRunner.query(`DROP TABLE "platform_withdrawals"`);
    await queryRunner.query(
      `DROP TYPE "public"."platform_withdrawals_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "platform_revenue_logs"`);
    await queryRunner.query(
      `DROP TYPE "public"."platform_revenue_logs_type_enum"`,
    );
  }
}
