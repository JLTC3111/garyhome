# Deploy Gary Home to Vercel

The GitHub repository `JLTC3111/garyhome` contains the app at its root. The local parent folder `Desktop/gary_home_website` is not part of that repository.

## Build settings

1. Import `JLTC3111/garyhome` and deploy the `main` branch.
2. Leave **Root Directory** empty (the repository root).
3. Use the **Next.js** framework preset. The tracked `vercel.json` selects this preset and runs `npm run build:vercel`.
4. Turn off any **Output Directory** override. Next.js owns `.next`; do not select `dist`, `dist/client` or `out`.
5. Use the default dependency installation with the committed `package-lock.json`. No custom install command is needed.
6. Redeploy the latest commit. When replacing an older Vinext build, uncheck **Use existing Build Cache** for this first redeploy.

`build:vercel` runs `next build --webpack`, producing `.next/routes-manifest.json` and the Next.js server and client output. The existing `npm run build` remains the Sites/Vinext build and produces `dist/`. These outputs belong to different hosts; pointing Vercel's Next.js adapter at `dist` causes the missing Routes Manifest error.

The Node server reads environment variables directly. The Sites build selects the Cloudflare bindings adapter through Vite. Pages read CMS content at request time so a published listing edit does not require another deployment. Enquiry rate limits use the host's trusted client IP header.

## Environment variables

In **Project Settings → Environment Variables**, add the values from your ignored local `.env` for each Vercel environment you use:

| Name | Purpose |
| --- | --- |
| `SUPABASE_URL` | Gary Home's project URL: `https://duyiihsmaqfgwezmsnjs.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Public browsing, customer sign-in and RLS-protected requests |
| `SUPABASE_SECRET_KEY` | Server-only staff invitations, after owner/admin authorization |

Do not upload `.env` to GitHub or prefix the secret with `NEXT_PUBLIC_` or `VITE_`. Redeploy after changing environment variables.

## Configure email redirects

In Supabase **Authentication → URL Configuration**, set **Site URL** to your production HTTPS origin. Add these exact production redirect URLs, replacing the example origin with your real Vercel or custom domain:

```text
https://your-project.vercel.app/account
https://your-project.vercel.app/auth/reset
https://your-project.vercel.app/auth/invite
```

Keep local redirect URLs if you also use the local preview. Add only preview origins where you need real email authentication. See [the authentication setup guide](auth-setup.md).

## Verify

```sh
npm run typecheck
npm test
npm run build:vercel
```

The build must finish successfully and create `.next/routes-manifest.json`, `.next/BUILD_ID` and `.next/server/app-paths-manifest.json`. For an optional local Node production server, run `npm run start:vercel` after building.

After Vercel reports **Ready**, check the homepage, published listings, `/account`, `/login`, `/admin`, customer email confirmation/recovery and a staff invitation. `/api/config` should report `configured: true`; it returns only the project URL and publishable key. An unauthenticated request to `/api/admin/team` must return `401`.

References: [Vercel file-based build configuration](https://vercel.com/docs/project-configuration/vercel-json), [Vercel build settings](https://vercel.com/docs/builds/configure-a-build), [Next.js build CLI](https://nextjs.org/docs/app/api-reference/cli/next), [Vercel request headers](https://vercel.com/docs/headers/request-headers).
