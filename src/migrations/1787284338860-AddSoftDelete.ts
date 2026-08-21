import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDelete1787284338860 implements MigrationInterface {
  name = 'AddSoftDelete1787284338860';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD "deleted_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_messages" ADD "deleted_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "contact_messages" DROP COLUMN "deleted_at"`,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "deleted_at"`);
  }
}
