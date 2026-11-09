import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Super affiliates: profiles, their commission ledger (one CREDIT per
 * transaction, enforced by a partial unique index), their own withdrawals
 * table, and affiliator_profiles.super_affiliate_profile_id (an affiliate
 * has one upline only - admin OR super affiliate).
 */
export class AddSuperAffiliates1793700000000 implements MigrationInterface {
  name = 'AddSuperAffiliates1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."super_affiliate_profiles_threshold_mode_enum" AS ENUM('per_transaction', 'monthly_total_downline', 'monthly_per_affiliate')`,
    );
    await queryRunner.query(
      `CREATE TABLE "super_affiliate_profiles" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "referral_code" character varying NOT NULL, "commission_rate" numeric(5,2) NOT NULL DEFAULT '1', "threshold_mode" "public"."super_affiliate_profiles_threshold_mode_enum" NOT NULL DEFAULT 'per_transaction', "threshold_amount" numeric(14,2) NOT NULL DEFAULT '1000000', "commission_balance" numeric(14,2) NOT NULL DEFAULT '0', "total_commission_earned" numeric(14,2) NOT NULL DEFAULT '0', "bank_name" character varying NOT NULL, "account_number" character varying NOT NULL, "account_holder" character varying NOT NULL, "phone_number" character varying NOT NULL, "created_by" bigint NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_8d00377281e61740983ff5a84c3" UNIQUE ("user_id"), CONSTRAINT "UQ_4c9719b47bdbe37a2144cd624ec" UNIQUE ("referral_code"), CONSTRAINT "REL_8d00377281e61740983ff5a84c" UNIQUE ("user_id"), CONSTRAINT "CHK_super_affiliate_profiles_rate" CHECK ("commission_rate" >= 0 AND "commission_rate" <= 100), CONSTRAINT "PK_f6017ed31799d71950bf9734dec" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."super_affiliate_commission_logs_type_enum" AS ENUM('credit', 'debit')`,
    );
    await queryRunner.query(
      `CREATE TABLE "super_affiliate_commission_logs" ("id" BIGSERIAL NOT NULL, "super_affiliate_profile_id" bigint NOT NULL, "affiliator_id" bigint, "transaction_id" character varying, "withdrawal_id" character varying, "type" "public"."super_affiliate_commission_logs_type_enum" NOT NULL, "amount" numeric(14,2) NOT NULL, "balance_after" numeric(14,2) NOT NULL, "description" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fc8621709b7fafa116eab89049f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_super_affiliate_commission_logs_credit" ON "super_affiliate_commission_logs"  ("super_affiliate_profile_id", "transaction_id") WHERE "type" = 'credit' AND "transaction_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."super_affiliate_withdrawals_method_enum" AS ENUM('bank', 'momo_coin')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."super_affiliate_withdrawals_status_enum" AS ENUM('pending', 'approved', 'rejected', 'paid', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "super_affiliate_withdrawals" ("id" character varying NOT NULL, "amount" numeric(14,2) NOT NULL, "admin_fee" numeric(14,2) NOT NULL DEFAULT '0', "net_amount" numeric(14,2) NOT NULL, "method" "public"."super_affiliate_withdrawals_method_enum" NOT NULL DEFAULT 'bank', "momo_user_id" character varying, "bank_name" character varying, "account_number" character varying, "account_holder" character varying, "status" "public"."super_affiliate_withdrawals_status_enum" NOT NULL DEFAULT 'pending', "linkqu_disbursement_id" character varying, "admin_notes" character varying, "approved_by" bigint, "approved_at" TIMESTAMP WITH TIME ZONE, "processed_by" bigint, "processed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "super_affiliate_profile_id" bigint NOT NULL, CONSTRAINT "UQ_0eb6c351100b4444db2ca560865" UNIQUE ("linkqu_disbursement_id"), CONSTRAINT "PK_e0cccd98273eba25fd1ebcefb0f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD "super_affiliate_profile_id" bigint`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE 'super_affiliate'`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD CONSTRAINT "CHK_affiliator_profiles_single_upline" CHECK ("admin_profile_id" IS NULL OR "super_affiliate_profile_id" IS NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "super_affiliate_profiles" ADD CONSTRAINT "FK_8d00377281e61740983ff5a84c3" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD CONSTRAINT "FK_5161f19ffc43385e1f23ae23ec8" FOREIGN KEY ("super_affiliate_profile_id") REFERENCES "super_affiliate_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "super_affiliate_withdrawals" ADD CONSTRAINT "FK_9ccfe181f7c3138ea02a0b2d2b4" FOREIGN KEY ("super_affiliate_profile_id") REFERENCES "super_affiliate_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "super_affiliate_withdrawals" DROP CONSTRAINT "FK_9ccfe181f7c3138ea02a0b2d2b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP CONSTRAINT "FK_5161f19ffc43385e1f23ae23ec8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "super_affiliate_profiles" DROP CONSTRAINT "FK_8d00377281e61740983ff5a84c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP CONSTRAINT "CHK_affiliator_profiles_single_upline"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum_old" AS ENUM('superadmin', 'affiliator', 'customer', 'admin')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_old" USING "role"::"text"::"public"."users_role_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum_old" RENAME TO "users_role_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP COLUMN "super_affiliate_profile_id"`,
    );
    await queryRunner.query(`DROP TABLE "super_affiliate_withdrawals"`);
    await queryRunner.query(
      `DROP TYPE "public"."super_affiliate_withdrawals_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."super_affiliate_withdrawals_method_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_super_affiliate_commission_logs_credit"`,
    );
    await queryRunner.query(`DROP TABLE "super_affiliate_commission_logs"`);
    await queryRunner.query(
      `DROP TYPE "public"."super_affiliate_commission_logs_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "super_affiliate_profiles"`);
    await queryRunner.query(
      `DROP TYPE "public"."super_affiliate_profiles_threshold_mode_enum"`,
    );
  }
}
