import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminReferral1793400000000 implements MigrationInterface {
  name = 'AddAdminReferral1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admin_profiles" ADD "referral_code" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_profiles" ADD "deleted_at" TIMESTAMP`,
    );
    // Give existing admins a code in the same ADM-XXXXXX shape new ones get.
    await queryRunner.query(
      `UPDATE "admin_profiles" SET "referral_code" = 'ADM-' || upper(substr(md5(random()::text || "id"::text), 1, 6)) WHERE "referral_code" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_profiles" ADD CONSTRAINT "UQ_admin_profiles_referral_code" UNIQUE ("referral_code")`,
    );

    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD "admin_profile_id" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD CONSTRAINT "FK_affiliator_profiles_admin_profile_id" FOREIGN KEY ("admin_profile_id") REFERENCES "admin_profiles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP CONSTRAINT "FK_affiliator_profiles_admin_profile_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP COLUMN "admin_profile_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_profiles" DROP CONSTRAINT "UQ_admin_profiles_referral_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_profiles" DROP COLUMN "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_profiles" DROP COLUMN "referral_code"`,
    );
  }
}
