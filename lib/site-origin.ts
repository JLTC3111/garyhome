// Match the existing production hostname redirect (apex -> www). Preview and
// deployment environment names must never become indexable canonical URLs.
export const CANONICAL_SITE_ORIGIN = "https://www.garyhome.vn";
export const STAFF_PORTAL_ORIGIN = "https://staff.garyhome.vn";
export const CUSTOMER_ACCOUNT_URL = `${CANONICAL_SITE_ORIGIN}/account`;
