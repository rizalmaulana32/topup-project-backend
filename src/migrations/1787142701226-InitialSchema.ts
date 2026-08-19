import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1787142701226 implements MigrationInterface {
  name = 'InitialSchema1787142701226';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum" AS ENUM('superadmin', 'affiliator', 'customer')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'inactive', 'pending_approval')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" BIGSERIAL NOT NULL, "name" character varying NOT NULL, "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL, "status" "public"."users_status_enum" NOT NULL DEFAULT 'pending_approval', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "affiliator_profiles" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "affiliate_code" character varying, "commission_rate" numeric(5,2) NOT NULL DEFAULT '10', "bank_name" character varying NOT NULL, "account_number" character varying NOT NULL, "account_holder" character varying NOT NULL, "commission_balance" numeric(14,2) NOT NULL DEFAULT '0', "total_commission_earned" numeric(14,2) NOT NULL DEFAULT '0', "approved_by" bigint, "approved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_dc65832a7bdfc4f7e6e2107f79c" UNIQUE ("user_id"), CONSTRAINT "UQ_4a268313f9a7d684ea2518bf7c2" UNIQUE ("affiliate_code"), CONSTRAINT "REL_dc65832a7bdfc4f7e6e2107f79" UNIQUE ("user_id"), CONSTRAINT "PK_52af694012bd7249a7463ba674e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."commission_logs_type_enum" AS ENUM('credit', 'debit')`,
    );
    await queryRunner.query(
      `CREATE TABLE "commission_logs" ("id" BIGSERIAL NOT NULL, "affiliator_id" character varying NOT NULL, "transaction_id" character varying, "withdrawal_id" character varying, "type" "public"."commission_logs_type_enum" NOT NULL, "amount" numeric(14,2) NOT NULL, "balance_after" numeric(14,2) NOT NULL, "description" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_094089a11e1fdf055310e297af5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."commission_withdrawals_status_enum" AS ENUM('pending', 'approved', 'rejected', 'paid', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "commission_withdrawals" ("id" character varying NOT NULL, "affiliator_id" bigint NOT NULL, "amount" numeric(14,2) NOT NULL, "bank_name" character varying NOT NULL, "account_number" character varying NOT NULL, "account_holder" character varying NOT NULL, "status" "public"."commission_withdrawals_status_enum" NOT NULL DEFAULT 'pending', "xendit_disbursement_id" character varying, "admin_notes" character varying, "processed_by" bigint, "processed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_0cf1c54b4551439c8fec4e5cf65" UNIQUE ("xendit_disbursement_id"), CONSTRAINT "PK_96955e071f4fd2ea8b258ba951c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."products_status_enum" AS ENUM('active', 'inactive')`,
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" BIGSERIAL NOT NULL, "name" character varying NOT NULL, "provider_code" character varying NOT NULL, "base_price" numeric(14,2) NOT NULL, "selling_price" numeric(14,2) NOT NULL, "status" "public"."products_status_enum" NOT NULL DEFAULT 'active', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "platform_settings" ("id" integer NOT NULL DEFAULT '1', "global_commission_rate" numeric(5,2) NOT NULL DEFAULT '10', "minimum_withdrawal_amount" numeric(14,2) NOT NULL DEFAULT '100000', "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2934aeb70ec285196dcab4a2e96" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_payment_status_enum" AS ENUM('pending', 'paid', 'failed', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."transactions_provider_status_enum" AS ENUM('pending', 'success', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "transactions" ("id" character varying NOT NULL, "product_id" bigint NOT NULL, "target_user_id" character varying NOT NULL, "target_zone_id" character varying, "referral_code" character varying, "gross_amount" numeric(14,2) NOT NULL, "affiliate_commission" numeric(14,2), "xendit_invoice_id" character varying, "payment_status" "public"."transactions_payment_status_enum" NOT NULL DEFAULT 'pending', "provider_status" "public"."transactions_provider_status_enum" NOT NULL DEFAULT 'pending', "provider_response" text, "paid_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_86d5b013c2d0e4f1879cd97a360" UNIQUE ("xendit_invoice_id"), CONSTRAINT "PK_a219afd8dd77ed80f5a862f1db9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD CONSTRAINT "FK_dc65832a7bdfc4f7e6e2107f79c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" ADD CONSTRAINT "FK_47436e5a1b24fe6c4da9a794ee5" FOREIGN KEY ("affiliator_id") REFERENCES "affiliator_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "FK_8d5b2e87f2129081ebacc894f8f" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_8d5b2e87f2129081ebacc894f8f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commission_withdrawals" DROP CONSTRAINT "FK_47436e5a1b24fe6c4da9a794ee5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP CONSTRAINT "FK_dc65832a7bdfc4f7e6e2107f79c"`,
    );
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(
      `DROP TYPE "public"."transactions_provider_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."transactions_payment_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "platform_settings"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(`DROP TYPE "public"."products_status_enum"`);
    await queryRunner.query(`DROP TABLE "commission_withdrawals"`);
    await queryRunner.query(
      `DROP TYPE "public"."commission_withdrawals_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "commission_logs"`);
    await queryRunner.query(`DROP TYPE "public"."commission_logs_type_enum"`);
    await queryRunner.query(`DROP TABLE "affiliator_profiles"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
  }
}
