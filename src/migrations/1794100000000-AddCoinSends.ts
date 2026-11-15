import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoinSends1794100000000 implements MigrationInterface {
  name = 'AddCoinSends1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "coin_sends" ("id" BIGSERIAL NOT NULL, "target_user_id" character varying NOT NULL, "coin" numeric(14,2) NOT NULL, "status" character varying NOT NULL, "source" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_coin_sends_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_coin_sends_target_coin_created" ON "coin_sends" ("target_user_id", "coin", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "coin_sends"`);
  }
}
