# Shared Gary apps and services

The directory brings together these three existing sites:

| Site | Address | Services shown |
| --- | --- | --- |
| Gary Home | https://garyhome.vn/ | Hanoi rentals, viewing enquiries and landlord introductions |
| Gary Jobs | https://jobs.garyhome.vn/ | English-teaching roles, recruitment enquiries and travel/local-life information |
| Gary Visa Service | https://visa.garyhome.vn/ | Visa/e-visa, work permit, residence card and document/translation support |

The jobs address was confirmed by the owner. Service descriptions and section anchors were checked against the existing `gary_jobs/gary-agency` and `gary_visa_service/website` source. Travel opens the jobs site's **Life beyond the classroom** section; it does not imply a tour-booking or ticketing service. No prices, reviews, availability guarantees or invented offerings were added.

## Where it appears in Gary Home

- **Gary Apps** in the desktop header opens a services menu.
- On tablets/phones it appears inside the hamburger menu, keeping the hotline/favourites band unchanged.
- Staff Studio has the same apps menu in its top bar.
- The homepage and **About Us → Our Services** show the full directory, with quick links for a home, a job, a visa and exploring Vietnam.

English and Vietnamese follow the current site language. Same-site links use Next navigation; other sites open a new tab with `noopener noreferrer`. The current site is identified in the cards. Escape, outside clicks, focus leaving the menu and following a link close it. Arrow keys, Home and End navigate the disclosure's links. Native details/links remain available in server-rendered HTML.

## Reuse

`shared/gary-apps/catalogue.ts` is the single public catalogue. `shared/gary-apps/gary-apps.tsx` exports `GaryAppsDirectory` and `GaryAppsMenu`; `shared/gary-apps/styles.css` supplies scoped styles and reduced-motion/mobile rules. These files do not import Next.js, Supabase or Gary Home's account context. They use React and the existing `lucide-react` icon library.

```tsx
import { GaryAppsDirectory, GaryAppsMenu } from './shared/gary-apps/gary-apps';
import './shared/gary-apps/styles.css';

<GaryAppsMenu language="en" currentApp="jobs" />
<GaryAppsDirectory language="en" currentApp="jobs" />
```

Set `currentApp` to `home`, `jobs` or `visa`. It controls current-site labels and converts that site's destinations to relative links. `renderLink` optionally supplies a framework-specific anchor renderer. `onOpen` and `onFollow` let an outer navigation close other menus. `components/service-apps.tsx` is the small Gary Home adapter for its language context and Next links.

Only the Gary Home repository was edited. The same shared module can be adopted by the other two websites; their current vanilla marketing pages would need a React mount/bundle (the jobs site already uses React for its gallery). This change does not deploy or change either external site.

The directory performs no API calls, stores no browser state and shares no account credentials between sites. No database migration or environment variable is required.
