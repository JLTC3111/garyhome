# Studio navigation and publishing

The staff workspace keeps the existing account and role permissions.

- **Rentals & content**: Listings (listing table and Media library views), Introduced properties, Neighbourhoods, People & galleries.
- **People & galleries** has three editors: Our members (public listing profiles), Activities (customer and team photos), and Feedback gallery (feedback screenshots). Public member profiles do not grant staff login access. Written customer feedback is still moderated under Customer care.
- **Customer care**: Enquiries, Customers, Customer feedback.
- **Assistance & publishing**: Assistance attribution, News articles, Rental tips. Assistance attribution remains limited to owners, admins and managers. Active staff can create, edit and publish news and tips. Owners and admins can delete them.
- **Administration**: Site settings and Team access, with the existing peer/lower-role visibility rules.

## News articles and rental tips

Both editors save to `public.editorial_articles` in Supabase. The migration is `supabase/migrations/20261026163743_editorial_articles_and_rental_tips.sql`, applied to `duyiihsmaqfgwezmsnjs`.

Create a draft, choose a URL slug, and fill the English and Vietnamese title, summary and sections. News also needs a cover image and publication date. Paragraphs are separated by blank lines; optional sources have a title and an HTTP/HTTPS URL. Cover uploads use the existing property media bucket and staff upload permissions.

Select Published and save to make the article available under `/tips-and-news/<slug>`. Public indexes, metadata, browser titles, structured data and sitemap entries read published records. Choosing Draft and saving removes the public page. Changing a slug changes its public URL. The publication date is a displayed date; it does not schedule publication.

Unfinished drafts can be saved privately. Required bilingual publication fields are checked in the editor and database. Public reads use an anonymous client and row-level security. Private article drafts are removed from the public snapshot on sign-out.

Language changes and same-account recovery retain the current draft. Edits made during a slow save remain open with the confirmed timestamp for a subsequent save. Concurrent changes from another editor are rejected instead of overwritten. Refresh list keeps the local draft; reopening an item loads its latest saved version.

The six existing articles and rental guides are preserved in the database. `data/editorial.json` supplies their initial values for database setup and browser preview; the old library exports derive from that same data.

## District gallery

Bounce Cards uses the React Bits square fan and original spring model: 200px cards, 85px spread, 160px neighbour push, 10° rotation, 1.06 hover scale and 0.6 bounciness. The stage reserves space for the full hover spread and scales proportionally when needed.

Selection is calculated from resting card positions, with a small boundary tolerance. Moving cards cannot continually trigger each other’s hover handlers. District links remain native links with keyboard focus and left/right navigation. Touch screens and reduced-motion settings use a readable grid. Animation frames stop after settling, pause off-screen or in hidden tabs, and are cancelled with observers and listeners on teardown. Language changes do not restart the gallery.
