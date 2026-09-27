/*
  Warnings:

  - Added the required column `content` to the `raid_rounds` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "raid_rounds" ADD COLUMN     "content" JSONB NOT NULL;
