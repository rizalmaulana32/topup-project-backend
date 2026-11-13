import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualTopupReferralCode1794000000000 implements MigrationInterface {
  name = 'AddManualTopupReferralCode1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_topups" ADD "referral_code" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_topups" DROP COLUMN "referral_code"`,
    );
  }
}
