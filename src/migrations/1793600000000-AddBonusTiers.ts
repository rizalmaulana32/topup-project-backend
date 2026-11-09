import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBonusTiers1793600000000 implements MigrationInterface {
  name = 'AddBonusTiers1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bonus_tiers" (
        "id" BIGSERIAL NOT NULL,
        "min_amount" numeric(14,2) NOT NULL,
        "max_amount" numeric(14,2),
        "bonus_percent" numeric(5,2) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bonus_tiers_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bonus_tiers_percent" CHECK ("bonus_percent" > 0 AND "bonus_percent" <= 100),
        CONSTRAINT "CHK_bonus_tiers_range" CHECK ("min_amount" >= 0 AND ("max_amount" IS NULL OR "max_amount" > "min_amount")),
        CONSTRAINT "EX_bonus_tiers_no_overlap" EXCLUDE USING gist (numrange("min_amount", "max_amount", '[)') WITH &&)
      )`,
    );
    // Close to the old hardcoded poster tiers (350k..1jt ~1%, 1jt+ ~2%) -
    // the old table floored to the lower tier (512.000 -> 5.000), percent
    // now gives 5.120; to be confirmed with the client.
    await queryRunner.query(
      `INSERT INTO "bonus_tiers" ("min_amount", "max_amount", "bonus_percent") VALUES
        (350000, 1000000, 1),
        (1000000, NULL, 2)`,
    );

    // Bonus is now snapshotted at checkout (tiers can change before payment).
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "bonus_coin" numeric(14,2)`,
    );
    // Backfill existing custom-amount rows with the old hardcoded table, so
    // a still-pending one deducts exactly the bonus its customer was shown.
    await queryRunner.query(
      `UPDATE "transactions" SET "bonus_coin" = CASE
          WHEN "gross_amount" >= 30000000 THEN 600000
          WHEN "gross_amount" >= 20000000 THEN 400000
          WHEN "gross_amount" >= 10000000 THEN 200000
          WHEN "gross_amount" >= 7000000 THEN 140000
          WHEN "gross_amount" >= 5000000 THEN 100000
          WHEN "gross_amount" >= 3000000 THEN 60000
          WHEN "gross_amount" >= 2000000 THEN 40000
          WHEN "gross_amount" >= 1000000 THEN 20000
          WHEN "gross_amount" >= 800000 THEN 8000
          WHEN "gross_amount" >= 700000 THEN 7000
          WHEN "gross_amount" >= 650000 THEN 6500
          WHEN "gross_amount" >= 600000 THEN 6000
          WHEN "gross_amount" >= 550000 THEN 5500
          WHEN "gross_amount" >= 500000 THEN 5000
          WHEN "gross_amount" >= 450000 THEN 4500
          WHEN "gross_amount" >= 400000 THEN 4000
          WHEN "gross_amount" >= 350000 THEN 3500
          ELSE 0
        END
        WHERE "product_id" IS NULL AND "coin_amount" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "bonus_coin"`,
    );
    await queryRunner.query(`DROP TABLE "bonus_tiers"`);
  }
}
