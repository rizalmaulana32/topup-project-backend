import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manual, no-payment-gateway coin sends + the manual-send-only "admin" role
 * (client request via Ricky 2026-11-02). See src/manual-topup/.
 */
export class AddManualTopup1793000000000 implements MigrationInterface {
  name = 'AddManualTopup1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // See RenameDuitkuColumnsToLinkQu1790160000000 for why ADD VALUE is
    // safe to run as its own statement here.
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'admin'`,
    );

    await queryRunner.query(
      `CREATE TABLE "admin_profiles" ("id" BIGSERIAL NOT NULL, "user_id" bigint NOT NULL, "coin_limit" numeric(14,2) NOT NULL DEFAULT 0, "total_coin_sent" numeric(14,2) NOT NULL DEFAULT 0, "created_by" bigint NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_admin_profiles_user_id" UNIQUE ("user_id"), CONSTRAINT "PK_admin_profiles_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_profiles" ADD CONSTRAINT "FK_admin_profiles_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."manual_topups_status_enum" AS ENUM('active', 'completed', 'cancelled', 'paused')`,
    );
    await queryRunner.query(
      `CREATE TABLE "manual_topups" ("id" character varying NOT NULL, "momo_user_id" character varying NOT NULL, "customer_name" character varying, "total_amount" numeric(14,2) NOT NULL, "amount_per_send" numeric(14,2) NOT NULL, "amount_sent" numeric(14,2) NOT NULL DEFAULT 0, "interval_minutes" integer, "status" "public"."manual_topups_status_enum" NOT NULL DEFAULT 'active', "next_run_at" TIMESTAMP WITH TIME ZONE, "created_by" bigint NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_manual_topups_id" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."manual_topup_sends_status_enum" AS ENUM('success', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "manual_topup_sends" ("id" BIGSERIAL NOT NULL, "manual_topup_id" character varying NOT NULL, "amount" numeric(14,2) NOT NULL, "status" "public"."manual_topup_sends_status_enum" NOT NULL, "provider_response" text, "sent_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_manual_topup_sends_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "manual_topup_sends" ADD CONSTRAINT "FK_manual_topup_sends_manual_topup_id" FOREIGN KEY ("manual_topup_id") REFERENCES "manual_topups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_topup_sends" DROP CONSTRAINT "FK_manual_topup_sends_manual_topup_id"`,
    );
    await queryRunner.query(`DROP TABLE "manual_topup_sends"`);
    await queryRunner.query(`DROP TYPE "public"."manual_topup_sends_status_enum"`);

    await queryRunner.query(`DROP TABLE "manual_topups"`);
    await queryRunner.query(`DROP TYPE "public"."manual_topups_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "admin_profiles" DROP CONSTRAINT "FK_admin_profiles_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "admin_profiles"`);

    // Postgres has no DROP VALUE for enums; the added 'admin' value is left
    // in place on down() (harmless - becomes unused again).
  }
}
