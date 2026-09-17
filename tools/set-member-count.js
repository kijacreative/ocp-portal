'use strict';
/* Write the membership count that the 1,000 panel shows.
 *
 *     node tools/set-member-count.js 712
 *     node tools/set-member-count.js 712 --goal 1000 --date "Sep 24, 2026"
 *     node tools/set-member-count.js --show
 *
 * Run by the weekly refresh after reading Arketa's "Active subscriptions"
 * report. Exists so that job is a checked, repeatable step rather than an
 * editor open on a source file — it validates the number, refuses a change
 * large enough to look like a mistake, stamps today's date, and says whether
 * anything actually changed so the caller knows whether to commit.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'api', '_members.js');
const current = require(FILE);

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at > -1 ? args[at + 1] : null;
};

if (args.includes('--show') || !args.length) {
  console.log(JSON.stringify(current, null, 2));
  process.exit(args.length ? 0 : 1);
}

const count = Number(args[0]);
const goal = Number(flag('goal') || current.member_goal);
const basis = flag('basis') || current.basis;
const date =
  flag('date') ||
  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

if (!Number.isInteger(count) || count < 1 || count > 100000) {
  console.error(`Not a plausible member count: ${args[0]}`);
  process.exit(1);
}
if (!Number.isInteger(goal) || goal < 1) {
  console.error(`Not a plausible goal: ${goal}`);
  process.exit(1);
}

// A week should not move this by a third. If it has, something is wrong with
// the query rather than the studio, and silently publishing it is the worst
// outcome — so stop and make a human look.
const was = Number(current.active_members) || 0;
const swing = was ? Math.abs(count - was) / was : 0;
if (was && swing > 0.33 && !args.includes('--force')) {
  console.error(
    `Refusing: ${was} → ${count} is a ${(swing * 100).toFixed(0)}% change in one run.\n` +
      `Check the report definition. Pass --force if the number is genuinely right.`
  );
  process.exit(2);
}

if (count === was && goal === current.member_goal && basis === current.basis) {
  console.log(`unchanged — still ${count} of ${goal}`);
  process.exit(0);
}

const body = fs.readFileSync(FILE, 'utf8');
const updated = body
  .replace(/active_members: \d+/, `active_members: ${count}`)
  .replace(/member_goal: \d+/, `member_goal: ${goal}`)
  .replace(/updated: '[^']*'/, `updated: '${date.replace(/'/g, "")}'`)
  .replace(/basis: '[^']*'/, `basis: '${basis.replace(/'/g, "")}'`);

if (updated === body) {
  console.error('Could not rewrite api/_members.js — its shape has changed.');
  process.exit(1);
}
fs.writeFileSync(FILE, updated);
console.log(`${was} → ${count} of ${goal}  (${date})`);
console.log('changed');
