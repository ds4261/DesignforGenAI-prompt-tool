# Design for GenAI admin

Next.js admin application using Supabase and Google sign-in. Every data page and mutation requires a profile with `is_superadmin = true`; database policies enforce admin access as well.

## Setup

1. Install dependencies with `npm ci`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
3. Apply the original application's NYC caption migrations, then run these SQL files in order in the Supabase SQL Editor:
   - `supabase/migrations/202610190001_admin_access.sql`
   - `supabase/migrations/202610250001_assignment_resources.sql`
4. Enable Google authentication in Supabase and configure the app's `/auth/callback` redirect URL.
5. Sign in once to create a profile. A trusted database operator must set that account's `public.profiles.is_superadmin` to `true` using SQL Editor. Ordinary users cannot assign themselves admin privileges.
6. Run `npm run dev` and open `/admin`.

## Prompt chain studio

Open `/chains` or choose **Chain studio** in the admin navigation. Apply `supabase/migrations/202611040001_prompt_chain_tool.sql` after the two migrations above. This migration targets their UUID schema; check existing table types before applying it to a database with other assignment tables.

The studio supports chain and step creation, editing and confirmed deletion, move-up/move-down step reordering, text and image-to-text runs, and per-chain caption/text history with intermediate results and prompt snapshots. All reads, actions, the editor RPC, and run table policies require `profiles.is_superadmin = true`. The editor RPC serializes writes using a chain-row lock and swaps step positions atomically. Deleting a chain deletes its steps, mix entries, and studio runs; existing generation requests are preserved with their chain reference cleared.

Set these additional **server-only** environment variables:

```dotenv
APP_MODE=chains
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=your-enabled-gemini-text-and-vision-model-id
```

`APP_MODE=chains` makes `/` and successful sign-in open the studio, so this codebase can power a separate prompt tool Vercel project while retaining the existing admin deployment's default. API keys must never use a `NEXT_PUBLIC_` prefix. No API calls or charges occur until a superadmin clicks Run. Steps can use the configured default or a model from `llm_models` belonging to an `llm_providers` row named `Google`, `Gemini`, `Google Gemini`, or `Google AI`. Other providers are rejected before creating a run. Use actual API model IDs as model names. Image input requires a public HTTPS URL and a vision-capable model. The runner follows the [official Gemini API documentation](https://ai.google.dev/api/generate-content).

Steps execute in saved order. `{{input}}` inserts the original text; `{{previous}}` inserts the preceding output. When `{{previous}}` is absent, that output is appended. Only the first step receives the optional image. This implementation produces captions and other text, not image/audio/video files. It saves to `prompt_chain_runs` without changing the existing public app's media schema. Runs stop at the first failure and retain earlier outputs. Chains support eight steps, each response is capped at 2,048 output tokens, and runs have a 240-second execution budget within the route's 300-second Vercel limit. An abrupt process termination can leave a run marked running; refresh the history and start a new run if necessary.

Appearance supports light, dark and system mode and remembers the preference in local storage. Chain lists show the latest 200 chains; history shows the latest 30 runs per chain.

### Separate repository and Vercel project

Create a new GitHub repository for the prompt tool and push a clean copy of this source, excluding `.env.local`, `.vercel`, `node_modules`, and `.next`. Import that repository as a **new** Vercel project, retaining the existing admin project. Configure the Supabase variables from Setup plus the three variables above. Add the new deployment's `/auth/callback` URL to Supabase Auth's redirect allowlist.

In the new Vercel project's **Settings → Deployment Protection**, disable Vercel Authentication as required by the assignment. Application-level Google sign-in and superadmin authorization remain required. Test in Incognito: the deployment should load its login screen without a Vercel protection screen; a signed-in non-superadmin must still be denied.

Submit the immutable deployment URL tied to the latest commit for each of the public app, admin app, and new prompt tool. Do not substitute a moving production alias. Repository/project creation, the migration, live generation, and those submission URLs require account access and have not been completed by the local implementation alone.

## Assignment coverage

| Admin section | Operations |
| --- | --- |
| Users (`profiles`) | Read |
| Prompt chains | Read |
| Prompt chain steps | Read |
| Prompt chain mix | Read, update |
| Terms | Create, read, update, delete |
| AI media (`nyc_caption_media`) | Read and view existing photos and generated captions; existing caption management remains available |
| Generation requests | Read |
| AI generation examples | Create, read, update, delete |
| LLM models | Create, read, update, delete |
| LLM providers | Create, read, update, delete |
| LLM responses | Read |
| Allowed signup domains | Create, read, update, delete |
| Whitelisted e-mail addresses | Create, read, update, delete |

The original assignment migration creates baseline UUID tables when absent, preserves existing tables and policies, and adds admin policies for the required operations. Review it against your application's schema before applying, especially foreign-key column types if some tables already exist. It does not seed sample records. The generic admin resource pages retain their original permissions; the separate chain studio described above manages chains and steps through its dedicated RPC.

Resource routes and table names are allowlisted in `app/admin/resources.ts`. The admin-only `admin_resource_columns` RPC supplies actual columns, required fields, types, defaults, and primary keys, so existing table fields appear in both lists and forms, including for empty tables. JSON and array fields accept JSON; booleans use a selector. Primary keys identify updates/deletes and are immutable after creation. Foreign keys accept record IDs from the corresponding section. Lists show 50 records per page. Errors and pending/success messages appear by the form, and deletes require confirmation.

Media previews use signed URLs valid for 15 minutes from the private `nyc-caption-photos` bucket; refresh the page to renew them. This admin references existing storage paths and does not upload images. The supplied assignment's conditional image-upload instruction was incomplete and needs clarification if uploads are required.

Maintaining domain and e-mail lists here does not itself enforce signup restrictions in Supabase Auth. The signup application's existing admission logic must consume those tables.

## Validation

```sh
npm run lint
npx tsc --noEmit
node --test tests/*.test.mjs
npm run build
```

The production build downloads the existing Geist fonts and needs network access to Google Fonts. Live verification also needs a reachable Supabase project with both migrations applied: test each operation as a superadmin, then confirm an ordinary account cannot access admin records or call the metadata RPC.
