import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveContactMessageCategory1787196756302 implements MigrationInterface {
  name = 'RemoveContactMessageCategory1787196756302';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contact_messages" DROP COLUMN "category"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contact_messages" ADD "category" character varying NOT NULL`,
    );
  }
}
