'use strict';
/* The membership count behind the 1,000.
 *
 * Written by tools/set-member-count.js, which the weekly refresh runs after
 * reading Arketa's "Active subscriptions" report. Committing it means the
 * number ships with the deployment — no database, no runtime credential, and
 * the history of the count is the git history of this file.
 *
 * Edit it by running the script, not by hand: the script validates the number
 * and stamps the date, so the page can never claim a count it did not take. */
module.exports = {
  active_members: 707,
  member_goal: 1000,
  updated: 'Sep 17, 2026',
  basis: 'Arketa active subscriptions, substatus active + canceling',
};
