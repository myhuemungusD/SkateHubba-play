/**
 * Hardcoded LA skate-spot pins for the public marketing landing teaser.
 *
 * IMPORTANT: This is a lead-magnet visualization only — pins are seeded
 * (not pulled from Firestore). Do NOT replace this with a real query;
 * public spot reads with precision reduction is a separate workstream
 * (Option C). See LandingMap.tsx for the locked-interaction UX.
 *
 * Coordinates are deliberately scattered across LA proper (Venice, DTLA,
 * Hollywood, Silver Lake, Long Beach) so the map reads as populated at
 * the default zoom — not clustered into one neighborhood.
 *
 * No gnar / bust-risk fields here: rendering is locked to a pin + CTA, so
 * carrying that data would (a) drift from the real `Spot` schema in
 * `src/types/spot.ts` and (b) bloat the public bundle with values no one
 * reads. Add them back the day they actually surface in the UI.
 */

export interface LandingSpot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export const LANDING_SPOTS: readonly LandingSpot[] = [
  // West LA / Westside
  { id: "ls-01", name: "Stoner Plaza", latitude: 34.0379, longitude: -118.4408 },
  { id: "ls-02", name: "West LA Courthouse", latitude: 34.0473, longitude: -118.4419 },
  { id: "ls-03", name: "Wilshire Ledges", latitude: 34.0635, longitude: -118.4485 },
  { id: "ls-04", name: "Santa Monica Courthouse", latitude: 34.0188, longitude: -118.4912 },
  // Venice
  { id: "ls-05", name: "Venice Skatepark", latitude: 33.9854, longitude: -118.4729 },
  { id: "ls-06", name: "Venice Pavilion Banks", latitude: 33.9869, longitude: -118.4731 },
  // Hollywood
  { id: "ls-07", name: "Hollywood High 16", latitude: 34.0975, longitude: -118.3387 },
  { id: "ls-08", name: "Cherokee Ledges", latitude: 34.1015, longitude: -118.3296 },
  { id: "ls-09", name: "Hollywood Bowl Curbs", latitude: 34.1122, longitude: -118.3394 },
  // Mid-City / Koreatown
  { id: "ls-10", name: "Wilshire Manholes", latitude: 34.0619, longitude: -118.3082 },
  { id: "ls-11", name: "Western Ave Hubba", latitude: 34.0654, longitude: -118.3091 },
  // DTLA
  { id: "ls-12", name: "Pershing Square Ledges", latitude: 34.0489, longitude: -118.2517 },
  { id: "ls-13", name: "LA Live Marble", latitude: 34.0451, longitude: -118.2671 },
  { id: "ls-14", name: "Grand Park Stairs", latitude: 34.0563, longitude: -118.2456 },
  { id: "ls-15", name: "Arts District 9", latitude: 34.0407, longitude: -118.2349 },
  { id: "ls-16", name: "Little Tokyo Banks", latitude: 34.0497, longitude: -118.2398 },
  // Silver Lake / Echo Park
  { id: "ls-17", name: "Silver Lake Triangle", latitude: 34.0869, longitude: -118.2702 },
  { id: "ls-18", name: "Echo Park Manual Pad", latitude: 34.0775, longitude: -118.2606 },
  { id: "ls-19", name: "Sunset Junction Curb", latitude: 34.0908, longitude: -118.2766 },
  // East LA / Boyle Heights
  { id: "ls-20", name: "Hollenbeck Ditch", latitude: 34.0419, longitude: -118.2058 },
  { id: "ls-21", name: "Mariachi Plaza Ledges", latitude: 34.0467, longitude: -118.2103 },
  // South LA
  { id: "ls-22", name: "USC Gateway Gap", latitude: 34.0224, longitude: -118.2851 },
  { id: "ls-23", name: "Expo Park Rails", latitude: 34.0162, longitude: -118.2879 },
  // Culver City / Inglewood
  { id: "ls-24", name: "Culver Steps", latitude: 34.0258, longitude: -118.3965 },
  { id: "ls-25", name: "SoFi Marble", latitude: 33.9535, longitude: -118.3392 },
  // Long Beach
  { id: "ls-26", name: "Cherry Park", latitude: 33.7866, longitude: -118.1735 },
  { id: "ls-27", name: "Belmont Pier Ledges", latitude: 33.7589, longitude: -118.1394 },
  { id: "ls-28", name: "Houghton Park", latitude: 33.8474, longitude: -118.1593 },
  // San Fernando Valley
  { id: "ls-29", name: "Sherman Oaks Bowl", latitude: 34.1511, longitude: -118.4502 },
  { id: "ls-30", name: "NoHo Schoolyard", latitude: 34.1672, longitude: -118.3769 },
];
