ALTER TABLE "User" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD CONSTRAINT "user_version_positive" CHECK ("version" > 0);
