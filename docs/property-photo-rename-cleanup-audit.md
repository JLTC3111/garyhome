# Gary Home property photo cleanup audit

**Production read-only check on November 19, 2026.** The rename ledger contains one applied operation, zero in-progress operations, and zero recorded removals. The `property-media` catalogue contains no untracked objects under `properties/renamed/`.

Operation `7f83ff1d-8eb6-4616-8b2f-c350aaa00b1b` concerns draft listing `1de3e346-a4b0-4511-bd53-c911bd4953e4`. It committed on `2026-11-19T07:26:49.427624+00:00`.

| Storage key in `property-media` | Verified status | Proposed action |
| --- | --- | --- |
| `properties/renamed/1de3e346-a4b0-4511-bd53-c911bd4953e4/3-bedroom-apartment-to-ngoc-van-tay-ho-living-room.jpg` | Present. The cover at position 1, the filename map, and the caption and alt-text map use the new URL. | Keep. |
| `properties/8ceb33f3-f0a3-4026-ba39-319e70a0bf0a.jpg` | Present. Zero active references in the saved Home reference inventory. Payload is identical to the replacement. | Eligible for separately approved removal after a fresh reference and digest check. |

Both objects returned HTTP responses with image bytes. The downloaded copies are 209,087 bytes each and both match the ledger SHA-256 `a509ccb75b3e523e2a7fc3396b305045f6af6f2c8ab919005877ba1a3370e96f`. The current filename map retains `3-bedroom-apartment-to-ngoc-van-tay-ho.jpg.jpg` as the historical upload name. That value explains the name shown by the earlier editor.

The inventory covers saved listing images, metadata and filename map keys, listing source URLs, neighbourhood images, the hero image, author portraits, activity images and links, and editorial images and structured source URLs. The tracked scope contained no ambiguous duplicates. Untracked uploads outside the rename prefix, external links, open pages, and cached image derivatives were outside the scope of this check. The listing is a draft. Published rendering remains unverified in production.

Before authorizing removal, review any use of the old URL in shared links or exports. An Admin or Owner can then use **Remove old copy** in the listing’s rename history. The guard rechecks current references and the replacement before calling Storage. Previously saved old URLs can fail afterward. Both files were retained during this audit.
