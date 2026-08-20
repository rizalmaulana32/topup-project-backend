import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactMessages1787193838511 implements MigrationInterface {
  name = 'AddContactMessages1787193838511';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."contact_messages_status_enum" AS ENUM('open', 'resolved')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contact_messages" ("id" BIGSERIAL NOT NULL, "name" character varying NOT NULL, "email" character varying NOT NULL, "category" character varying NOT NULL, "message" text NOT NULL, "status" "public"."contact_messages_status_enum" NOT NULL DEFAULT 'open', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b74f96eb2edd977ccfba6533293" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "contact_messages"`);
    await queryRunner.query(
      `DROP TYPE "public"."contact_messages_status_enum"`,
    );
  }
}
