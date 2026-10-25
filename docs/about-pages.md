# About Us navigation and rental guides

The header contains a bilingual About Us dropdown with About Gary Home, Our Services, Tips & News, Contact and Landlords. Agent and testimonial menu entries are omitted. The mobile menu uses the same links; Escape and outside interaction close the dropdown, with focus restored to its trigger. Opening Apartments closes About Us and vice versa.

New public routes are `/services`, `/tips-and-news`, `/landlords` and the three `/tips-and-news/[slug]` guide pages. Titles and metadata follow English/Vietnamese, unknown guides return 404, and the sitemap includes the new pages. The guides cover rental-search briefs, property viewings and organising favourites/enquiries. They have no invented dates, staff authors, customer quotes or business-news claims. Guide content lives in `lib/rental-guides.ts`; contact and hero details use the existing CMS settings.

The Landlords form reuses the existing enquiry backend with `kind: landlord`. Consent, request validation, rate limiting and authenticated account linking remain in the existing `/api/enquiries` route. There is no additional database migration. Requests appear in the staff enquiry inbox. Public customer controls no longer display the signed-in staff profile photo.
