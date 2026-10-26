# About Us navigation and editorial pages

The bilingual header dropdown contains **Our Services**, **Tips & News**, **Contact** and **Landlords**. Contact has no separate header button. About Us, Apartments and Feedback use the same root navigation type size and weight on desktop and mobile. The former About Gary Home content has been removed; `/about` permanently redirects to `/services` for old bookmarks and is excluded from the sitemap.

Our Services uses the approved Đặng Thai Mai living-room photo. It is different from the home hero in both URL and image content; changing the homepage hero in Studio no longer changes this page's photo.

Tips & News contains three original bilingual news/explainer articles and the three existing rental guides. News lives in `lib/news-articles.ts`, guides in `lib/rental-guides.ts`, with combined routing, document titles, metadata, Article JSON-LD and sitemap coverage. Unknown slugs return 404. The articles show their actual Gary Home publication date, source links and labelled illustrative Gary Home rental photos. Existing guides remain undated. There are no copied competitor articles, invented bylines or fabricated market prices. This is a public editorial section; an article editor in Studio has not been added.

The news reference was reviewed for its thumbnail/date/excerpt structure: https://hanoirealestate.com.vn/news.html. Primary reading behind the new articles:

- Savills' 15 October 2026 Q3 report: https://www.savills.com/research_articles/255800/239332-1
- Government News' 8 August 2024 metro opening report: https://en.baochinhphu.vn/ha-noi-second-metro-line-starts-commercial-run-11124080816055018.htm
- Hanoi Metro operator information: https://metrohanoi.vn/en/
- Hanoi Department of Culture and Sports: https://sovhtt.hanoi.gov.vn/en/introduction/ha-noi-thu-do-viet-nam/

Landlords uses the dedicated intake described in [landlord-introductions.md](landlord-introductions.md), including private uploads and a Studio review queue. The legacy `/contact?kind=landlord` view renders the same new intake. Public customer controls continue to use generic customer icons rather than private staff profile photos.
