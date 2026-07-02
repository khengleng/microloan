-- Notification wiring: borrower email for receipts/reminders
ALTER TABLE "Borrower" ADD COLUMN "email" TEXT;
