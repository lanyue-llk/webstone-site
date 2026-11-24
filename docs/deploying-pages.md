# Deploying Webstone Site

The public site is a static export on Cloudflare Pages. The project is `lexmount-webstone`, its production branch is `main`, and its default address is https://lexmount-webstone.pages.dev. The custom domain is `webstone.lexmount.io`.

## Release from a tag

Merge reviewed changes into `main`, then tag that commit:

```sh
git switch main
git pull --ff-only origin main
git tag v1.0.0
git push origin v1.0.0
```

Use the next unused `vMAJOR.MINOR.PATCH` tag. Do not move an existing tag. Website release tags are independent of benchmark result editions and the Webstone Python package.

`Publish Pages release` checks that the tag is on main history, installs locked dependencies, runs tests, checks anonymous report access, builds the export and uploads it with Wrangler. It then compares the live release fingerprint with the build and verifies data downloads, redirects and cache headers. A main push alone does not publish the public site. Production deployments run serially.

## One-time GitHub configuration

The `cloudflare-production` GitHub environment needs:

| Setting | Type | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | A Cloudflare API token with Account / Cloudflare Pages / Edit for the deployment account only |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | The account containing `lexmount-webstone` |
| `CLOUDFLARE_PAGES_URL` | Variable | `https://lexmount-webstone.pages.dev` |

Keep the token in GitHub Secrets. Never put it in the repository, a report, chat or client-side environment variables. Local Wrangler OAuth login does not authenticate GitHub Actions.

This project uses Direct Upload from GitHub Actions. It does not depend on Cloudflare's Git integration or its repository-build hooks.

## Local verification and manual recovery

Use the official Wrangler CLI. Interactive authorization is needed once per local connection:

```sh
npx --yes wrangler@4.167.0 login --device --scopes account:read user:read pages:write
npm ci --ignore-scripts
npm test
npm run check:reports
npm run build
npx --yes wrangler@4.167.0 pages deploy web/out --force --branch main
SITE_ORIGIN=https://lexmount-webstone.pages.dev node scripts/verify-public-site.mjs
```

`--force` keeps these commands on the original Pages service; Wrangler 4.167 otherwise delegates Pages commands to the newer Workers flow. It does not bypass account permissions. `wrangler.jsonc` supplies the project name and export directory. Updates deploy to the existing project; they do not recreate it.

The export contains `_headers`, `_redirects` and the cache-reset file. HTML, catalogs, reports and the release manifest are fetched again after a release. Fingerprinted assets keep an immutable cache. `/submit` redirects to the submission instructions in the site repository.

A successful upload is not the final check. Run the verification script against the public address and open the homepage, a benchmark, its report and the downloaded result without signing in. If a release fails, fix it and publish a new tag; use the previous verified Pages deployment for an urgent rollback.

## Custom domain

Add `webstone.lexmount.io` under the Pages project's custom domains before creating the DNS record. The company DNS administrator only needs to add:

| Type | Name | Target | TTL | Proxy |
| --- | --- | --- | --- | --- |
| CNAME | `webstone` | `lexmount-webstone.pages.dev` | Auto | DNS only |

No nameserver change or change to the company's existing records is needed. Wait for Pages to mark the custom domain active and issue HTTPS, then verify that address too. The default Pages address remains usable while DNS is being configured.

Retire the old Rainbond instance only after the public Pages address serves the intended release and its reports and downloads pass verification. Stop the old application; deleting its configuration is unnecessary.
