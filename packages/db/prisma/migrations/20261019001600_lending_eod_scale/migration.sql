-- End of day at scale (docs/lending/PERFORMANCE.md).
--
-- The deferred constraint trigger "LendingJournalLine_balanced" sums an
-- entry's lines by "entryId" at commit, once per line inserted. Without an
-- index that is a sequential scan of the whole journal: about 300 ms per line
-- at 7.7 million lines (50,000 loans), which made end of day take about one
-- second per loan. With it, the check is an index lookup.
--
-- Building it locks writes to "LendingJournalLine" for the build (seconds per
-- few million rows); deploy outside end of day.

-- CreateIndex
CREATE INDEX "LendingJournalLine_entryId_idx" ON "LendingJournalLine"("entryId");
