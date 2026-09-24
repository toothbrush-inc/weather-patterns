#!/usr/bin/env node
// One-time helper for switching on per-user views (WEATHER_IDENTITY_HEADER) on
// an instance that already has locations: give each listed person a user file
// that follows every location in the pool, with the shared active location as
// theirs, so nobody's dashboard goes blank the day identity lands. Skips anyone
// who already has a file. People added later start empty and get the setup card.
//
//   node scripts/seed-users.mjs alice@example.com bob@example.com
//   (run inside the container with the same WEATHER_SETTINGS the app uses)

import { getConfig } from "../lib/config.mjs";
import { userSlug } from "../lib/identity.mjs";
import { hasUserPrefs, saveUserPrefs, usersDir } from "../lib/users.mjs";

const emails = process.argv.slice(2);
if (emails.length === 0) {
  console.error("usage: node scripts/seed-users.mjs <email> [<email> ...]");
  process.exit(2);
}

const cfg = getConfig();
console.log(`Pool: ${cfg.locations.length} location(s); user files in ${usersDir()}`);
for (const email of emails) {
  const id = userSlug(email);
  if (!id) {
    console.log(`  skip  ${email} (nothing usable in that address)`);
    continue;
  }
  if (hasUserPrefs(id)) {
    console.log(`  keep  ${email} → ${id}.json already exists`);
    continue;
  }
  saveUserPrefs(id, {
    follows: cfg.locations.map((l) => l.id),
    activeLocationId: cfg.activeLocationId,
  });
  console.log(`  wrote ${email} → ${id}.json (follows all ${cfg.locations.length})`);
}
