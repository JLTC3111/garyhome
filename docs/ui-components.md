# UI component integrations

Selected on 2026-10-22 from the official React Bits, Magic UI and Motion Primitives projects. Components are copied into this application and adapted to Gary Home's existing styles, English/Vietnamese content, and customer/Studio state. The only added runtime dependency is `motion`, pinned to `14.6.0`.

| Library | Component | Where it is used |
| --- | --- | --- |
| [React Bits](https://reactbits.dev/components/spotlight-card) | Spotlight Card | Homepage search surface and the three Gary Way guidance cards |
| [React Bits](https://reactbits.dev/text-animations/tech-text) | Tech Text | CMS-driven English/Vietnamese homepage headline |
| [Base UI](https://base-ui.com/react/components/select) | Select | All 21 active dropdowns in search, customer accounts and Studio |
| [Magic UI](https://magicui.design/docs/components/blur-fade) | Blur Fade | Homepage section introductions and the Gary Way photograph |
| [Magic UI](https://magicui.design/docs/components/number-ticker) | Number Ticker | Actual listing/neighbourhood counts, catalogue results, customer metrics and Studio metrics |
| [Motion Primitives](https://github.com/ibelick/motion-primitives/blob/main/components/core/animated-background.tsx) | Animated Background | Rent/buy selection, homepage categories, mobile browsing navigation, account navigation and Studio navigation |
| [Motion Primitives](https://github.com/ibelick/motion-primitives/blob/main/components/core/disclosure.tsx) | Disclosure | Advanced catalogue filters and the bilingual homepage FAQ |

“primitive-motions” was interpreted as **Motion Primitives**, the React component collection maintained by ibelick.

## Adaptations

- Shared `LazyMotion` features and `MotionConfig` live in `components/interaction-provider.tsx`; motion preferences follow the visitor's device. `use-motion-preference.ts` subscribes directly to media-query changes so toggling the preference during a visit also disables animation. Server rendering and browsers without the preference API default to reduced motion. Components use `m` rather than loading a separate full motion component bundle.
- Blur Fade enhances content after it enters view. Server-rendered content stays visible before hydration and when JavaScript or the Web Animations API is unavailable. Reveals run once and stop on cleanup or a reduced-motion preference change.
- Number Ticker renders the actual count on the server and in a separate screen-reader span. Only the decorative number interpolates on changes. Initial counts are accurate, with no invented business statistics.
- Animated Background takes controlled selection from the existing page. It preserves handlers and stable child identities, never delays a selection, and never wraps page forms in an exiting/remounting transition. Each instance has its own layout ID.
- Disclosure keeps its children mounted so closing advanced filters preserves their values. Closed content is both `inert` and hidden from assistive technology. Native button triggers expose `aria-expanded` and `aria-controls` and support the browser's standard keyboard interaction.
- Tech Text uses the official Canvas 2D component with letter outlines, 4/2 dashes, 15 specks, no intro, click kick, and no guides. Each CMS headline line keeps its serif typography, with an olive italic second line. Technical metric labels and dragging are disabled for the public headline. Hover/click interaction replaces the automatic sweep so there is no animation loop at rest. Real text remains inside the H1 for server rendering, accessibility, reduced motion, canvas failure and wrapped CMS lines. Font sizing follows the responsive headline rather than adding a fixed 480px stage. Vietnamese graphemes stay together. Animation pauses offscreen/in background tabs, remeasures on return, and cleans up listeners, observers and animation frames. Canvas context loss restores readable text until recovery.
- The shared `SelectField` uses the installed Base UI package for keyboard navigation, typeahead, focus and outside dismissal. Option JSX is configuration: it never mounts a native select/option picker. Form names, values, disabled choices and translated labels remain connected to the existing state. The homepage trigger has its own inner border. Popups use a 140ms opacity/translation transition, with no animated blur, dimensions or springs; reduced motion removes the transition. Popup content mounts only as needed and stays inside its enclosing dialog in Studio.
- Spotlight Card uses local pointer coordinates, supports focus-within, and avoids global pointer listeners or a permanent animation loop. Pointer glow is disabled for coarse pointers and reduced motion.
- The mobile browsing bar accounts for the device safe area and reserves footer space. Toasts and comparison controls sit above it. Studio keeps its own existing navigation.
- The homepage neighbourhood grid now exposes all four configured areas. Property actions have larger touch targets, visible comparison controls, and a saving indicator. Buttons and form inputs retain native semantics.
- Rent/buy changes reset incompatible budget options. Catalogue form submissions retain the selected sort order.
- The homepage rent/buy control uses a bordered group with icons, a high-contrast selected state and a checkmark. Each search field has a complete border and a visible keyboard focus state. The shared logo tagline and homepage link label follow English/Vietnamese, and the header's saved-homes heart appears only for a signed-in user.
- Customer and staff login links share the translucent upper header band. Both header rows stay available while scrolling; the mobile menu opens below them. Contact links use the explicit **Contact** label, and the footer uses deep blue, ivory and warm accent colours. The phone number has a larger warm highlight, including on mobile. Login links are visually smaller, with a subdued staff link and separate customer/staff labels.
- The mobile header menu closes on Escape and outside pointer interaction; Escape restores focus to its trigger. Labels follow the selected language.

## Source and licensing

Sources reviewed:

- [React Bits SpotlightCard source](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/Components/SpotlightCard/SpotlightCard.tsx)
- [Base UI Select documentation](https://base-ui.com/react/components/select)
- [React Bits TechText source](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/TextAnimations/TechText/TechText.tsx)
- [React Bits license](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md)
- [Magic UI BlurFade source](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/blur-fade.tsx)
- [Magic UI NumberTicker source](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/number-ticker.tsx)
- [Magic UI license](https://github.com/magicuidesign/magicui/blob/main/LICENSE.md)
- [Motion Primitives source and MIT declaration](https://github.com/ibelick/motion-primitives)
- [Motion reduced-motion documentation](https://motion.dev/docs/react-use-reduced-motion)

Retained license terms and attribution are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). React Bits permits use in a website/product and restricts selling or redistributing the components themselves; this integration is part of the Gary Home application.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build` after changes. Check the homepage, catalogue filters, saved homes, account navigation, and Studio in both languages. Check a narrow mobile viewport, keyboard navigation, device reduced-motion settings, and existing draft/recovery behaviour. Tests and HTTP checks do not replace a real browser visual review.

The current application passes type checking, all 132 tests (including portal separation, customer refresh, reduced-motion and preview identity checks), and both production builds (`npm run build:vercel` and `npm run build`). HTTP checks for `/`, `/homes`, `/saved`, `/account`, and `/admin` passed during the UI update. Additional React checks covered custom select form values, language/draft retention, budget reset, Tech Text idle/context recovery, server-visible homepage content, all four neighbourhoods, FAQ control relationships and language changes, preserved selection handlers and child drafts, and excluding the public mobile navigation from Studio. Browser visual review was unavailable. A dependency audit could not complete because the registry audit endpoint failed DNS resolution; no clean vulnerability result is claimed.
