# Apartment location maps

The apartment detail's Location & Nearby section embeds a lazy-loaded Google map and links to the same destination in Google Maps. English and Vietnamese labels identify whether the destination was supplied by the author or is approximate.

In Studio, authors can enter **Exact map location (optional)** below the public location / street. Enter a full address or `latitude,longitude`. This value is public. Saving trims the value; clearing it restores the approximate view. The database accepts null or a nonblank value of up to 300 characters and retains the existing public-read and staff-write permissions.

Without an exact destination, the map searches the listing's public street / area in Hanoi at a wider zoom. It falls back to the neighbourhood, then Hanoi if location data is unavailable. Existing listings remain approximate until an author adds an exact destination. Text explains how to obtain the exact viewing address from the team.

Migration `20261102065956_property_map_address.sql` adds the optional `properties.map_address` field and is included in fresh setup. It was applied to project `duyiihsmaqfgwezmsnjs` on 2 November 2026. The frontend is implemented locally and has not been deployed.

Verification covers exact-address and coordinate precedence, blank-value fallbacks, URL encoding, translated precision labels and iframe titles, lazy loading, removing a saved exact location, database constraints and staff-only writes. The full suite (481 tests), TypeScript checks, ESLint (existing warnings only), and the Vercel production build pass. A local apartment detail returned HTTP 200 with the approximate map rendered in its server HTML.
