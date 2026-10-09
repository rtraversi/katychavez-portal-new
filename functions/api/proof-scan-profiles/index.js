// Versioned, server-owned Proof Scan profiles. This registry is deliberately
// inert until a later batch connects it to the API request path.
import dacaRenewalProfile from './daca-renewal.v1.json' with { type: 'json' };

const currentProfiles = new Map([
  [dacaRenewalProfile.profile_id, dacaRenewalProfile],
]);

const versionedProfiles = new Map([
  [`${dacaRenewalProfile.profile_id}@${dacaRenewalProfile.profile_version}`, dacaRenewalProfile],
]);

// Fresh scans omit profileVersion and receive the configured current profile.
// History supplies the recorded version and receives that exact immutable JSON.
export function loadScanProfile(profileId, profileVersion) {
  if (profileVersion === undefined) return currentProfiles.get(profileId) || null;
  return versionedProfiles.get(`${profileId}@${profileVersion}`) || null;
}
