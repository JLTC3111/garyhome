# Rental price ranges

The listing editor accepts independent **USD From/To** and **VND From/To** prices. Staff can enter either currency or both, with a fixed price or a range in each. All labels, help text and validation messages support English and Vietnamese. The heading follows the listing's month, week or night price period.

Enter From only for a fixed price, both amounts for a range, or leave both currencies empty for price on request. Each To amount requires a From amount in the same currency and must be at least that From amount. VND uses whole đồng. Equal endpoints display as a fixed price. Existing listing prices are preserved.

`properties.price` and `price_max` remain USD. Nullable `price_vnd` and `price_vnd_max` store independent VND quotes. Database constraints reject upper-only, reversed, negative and nonfinite ranges. Existing staff write permissions and public read policies apply to the new columns. Structured data publishes only entered quotes, including both currencies when supplied, using the [Schema.org price specification range fields](https://schema.org/UnitPriceSpecification).

Visitors choose USD or VND in the header, search form, or property detail page. The preference persists in a cookie and browser storage, syncs across tabs, and remains independent of language and authentication. An entered quote in the chosen currency always takes precedence. If it is absent, the other quote is converted and marked **≈**. If no usable rate is available, the entered currency remains visible and is explicitly identified. Listings without either quote show price on request.

Monthly budget filters match overlapping ranges in the currency saved with the search URL. Changing currency converts the displayed budget bounds with outward rounding; an unavailable conversion keeps their original units. Price sorting uses the starting amount in the selected currency. The Studio always shows entered prices rather than estimates.

Conversions use the [free ExchangeRate-API endpoint](https://www.exchangerate-api.com/docs/free), fetched on the server from the fixed HTTPS URL `https://open.er-api.com/v6/latest/USD`. No visitor information, auth headers, cookies or API keys are sent. Requests reject redirects, have a three-second deadline covering the response body, and accept at most 64 KiB of validated JSON. Validation checks the base currency, finite positive VND rate, expected timestamps, future dates and a maximum rate age of 72 hours. The provider publishes daily updates; its required attribution and the update date appear in the footer.

The framework caches upstream responses for 24 hours, while each server process coalesces requests and schedules refreshes around the provider's next update. Failed refreshes retry at most hourly. A previous valid rate can remain available for up to 72 hours; after that, conversions stop. `/api/exchange-rate` exposes only the sanitized USD/VND rate used by this site, with no configurable upstream URL or cross-origin API access. Open pages refresh hourly and invalidate expired rates during outages. The provider is an estimate source, not a guaranteed settlement quote.

Migration `20261030065219_property_price_range.sql` is applied to project `duyiihsmaqfgwezmsnjs` and included in the fresh-project setup. Verification saved a temporary draft range, rejected reversed and upper-only ranges, checked fixed and on-request prices, then rolled back the probe. The 16 existing records were preserved. Security advisors reported the same findings as before the migration.

Migration `20261030075151_listing_vnd_prices.sql` adds the independent VND columns and is applied to project `duyiihsmaqfgwezmsnjs`. See [editable listing IDs](editable-listing-ids.md) for the separate ID and concurrent-edit migration.

Validation: 436 tests pass. Type checking, production build and lint checks pass (lint has existing image warnings). Desktop and 393 px mobile browser checks verified currency selection, matching budget labels, VND display and provider attribution.
