import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAffiliatePhoneNumber1793100000000
  implements MigrationInterface
{
  name = 'AddAffiliatePhoneNumber1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD "phone_number" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP COLUMN "phone_number"`,
    );
  }
}
