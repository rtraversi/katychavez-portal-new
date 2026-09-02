// Versioned, server-owned Proof Scan profiles. This registry is deliberately
// inert until a later batch connects it to the API request path.
import dacaRenewalProfile from './daca-renewal.v1.json' with { type: 'json' };

const profiles = new Map([
  [dacaRenewalProfile.profile_id, dacaRenewalProfile],
]);

export function loadScanProfile(profileId) {
  return profiles.get(profileId) || null;
}

