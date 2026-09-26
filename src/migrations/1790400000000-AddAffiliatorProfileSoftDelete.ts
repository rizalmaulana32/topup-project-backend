import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAffiliatorProfileSoftDelete1790400000000 implements MigrationInterface {
  name = 'AddAffiliatorProfileSoftDelete1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" ADD "deleted_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "affiliator_profiles" DROP COLUMN "deleted_at"`,
    );
  }
}
