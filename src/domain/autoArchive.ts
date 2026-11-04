/**
 * How long finished work stays on its board before it is filed away: one week, always.
 *
 * It used to be a workspace setting, and that made a product decision configurable: one instance
 * kept finished work for a fortnight and another forever, so a person reading a board could not
 * know which. A week is the answer the product now gives — long enough to see what landed, short
 * enough that a Done column stays a column rather than an attic.
 *
 * Nothing is lost by the filing: the item is **archived**, not deleted, and the Archive restores it.
 * So this is not a deadline anybody has to meet, which is exactly why it does not need to be set.
 *
 * One constant, read by the store's `runAutoArchive`. Not a field on a board, and not part of the
 * workspace's vocabulary.
 */
export const AUTO_ARCHIVE_DAYS = 7
