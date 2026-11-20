# Mori

A local, full-stack customer workspace for Facebook Messenger sales: guided intake, Jev decisions, approved knowledge, human handoff, seven-day touchpoints, contact profiles, orders, and first-inquiry cohort reporting.

Built with Next.js, React, TypeScript, PostgreSQL/Supabase Auth, and Cloudinary. The supplied credentials are in **`.env.local`**, which Git ignores. Real credentials are never included in `.env.example` or browser bundles.

## Run locally

Requires Node.js 22+.

```powershell
npm install
npm run doctor
npm run dev
```

Open **http://127.0.0.1:3000**. Signed-out visitors go to `/sign-in`. Email/password, email confirmation, password reset, invitations, and Facebook sign-in use Supabase Auth. New accounts start with no business records and create their own workspace or join an explicit invitation. There is no demo workspace or seeded customer data.

The public app is **https://projectmori.vercel.app**. Enable **Facebook** in Supabase Authentication → Sign In / Providers using the Meta app credentials. In Meta, add `https://qbfizfgytzcuwydjbate.supabase.co/auth/v1/callback` as a Valid OAuth Redirect URI. This login callback is separate from `https://projectmori.vercel.app/api/facebook/callback`, which connects business Pages and ad accounts after signing in. Set Supabase Auth Site URL to `https://projectmori.vercel.app` and allow `https://projectmori.vercel.app/auth/callback` and `https://projectmori.vercel.app/auth/callback?next=/set-password`. The PKCE email link must be opened in the same browser that requested it. Team invitations also accept Supabase’s implicit invitation session. Roles always come from workspace memberships in PostgreSQL, never from login profile metadata.

Run the background worker in a second terminal:

```powershell
npm run worker
```

The worker checks messages and touchpoints every 30 seconds and syncs ads hourly. Closing the worker stops background processing. Production requires an always-running Node worker, or a scheduler calling `POST /api/cron` with `Authorization: Bearer <CRON_SECRET>`. Use one-minute intervals; the database lock prevents concurrent ticks. The worker requires a **session-mode connection on port 5432**, as configured in `DATABASE_URL`.

## Connection status

- PostgreSQL: migrations applied over verified TLS, using the public Supabase root certificate in `config/supabase-ca.crt`.
- Supabase Auth: publishable and server secret keys verified.
- Cloudinary: configured; signed uploads run through the server.
- Facebook: app credentials configured. A Page/account OAuth connection and Meta setup are still required before live messages or ad spend can be accessed.
- Jev: configured through **OpenRouter**, using `typesafe/jev-1.14` at the Decisions API. The server-only `OPENROUTER_API_KEY` is stored in ignored `.env.local`. Direct TypeSafe access remains supported by setting `JEV_PROVIDER=typesafe` with the matching URL/model and `JEV_API_KEY`.
- Optional vector embeddings: set `EMBEDDING_API_KEY` to enable 1536-dimensional hybrid retrieval. Indexed full-text retrieval works without an embedding key.

`supabase init` has been run. `supabase link` was attempted, but the CLI account currently logged in on this computer lacks project permissions. This does **not** block the application or the direct migration runner. To use management commands, sign in to an account with access to the project, then run:

```powershell
npx supabase login
npm run supabase:link
```

A Supabase **personal access token** (`sbp_...`) is different from a project API secret (`sb_secret_...`). Do not substitute the API secret for the CLI token.

## What is implemented

**Jev autofill.** The worker extracts missing contact details and configured intake answers from natural customer messages, including multiple fields in the first message. It also captures a supplied phone/email when the form does not explicitly request them. Jev chooses literal text boundaries and independently verifies each proposed value; code validates email, phone, number, and choice formats. Existing profile values and answers are preserved. Source-message text, timestamp, provider/model, and support score are retained in the profile's Intake answers tab. Required details still missing are asked next; the system never fabricates missing answers or marks orders paid from a message. Automatic autofill is enabled by default and has a separate Settings switch, so it can assist while a human handles the conversation. **Autofill details** in a contact profile processes existing conversation history on demand. Stop/opt-out messages never trigger automatic extraction. The support score is a model judgment, not an empirically validated accuracy percentage. Processing considers up to 240 tokens from the most recent customer messages; older/missing evidence stays unfilled.

**Workspaces and access.** Each workspace has head, admin, and member roles. Heads create administrators; administrators create members and assign multiple Pages/ad accounts. Members only see assigned resources, contacts, conversations, orders, and corresponding reports. PostgreSQL row-level security applies to browser/API reads as well as server requests. Facebook tokens are encrypted with AES-256-GCM and cannot be selected by browser roles. A Page belongs to one workspace to prevent competing bots from replying.

**Guided conversations.** Configure ordered questions in Settings. Required answers are collected before intake finishes. Supported field types are text, email, phone, number, and choice. Optional qualifying answers on choice fields determine qualification. Jev classifies FAQ intent, objections, and requests for human help. It chooses from approved FAQs/retrieved passages; it does not invent free-form answers. Unsupported/uncertain decisions pause the assistant and hand the contact to the team. An agent reply also pauses the assistant. Intake answers and objections stay in the profile. Opt-outs stop follow-ups, including while a person controls the conversation.

**Knowledge and media.** PDF, DOCX, TXT, Markdown, and CSV uploads are extracted and chunked automatically. PostgreSQL full-text indexes retrieve passages; optional embeddings add vector retrieval with reciprocal-rank fusion. Jev selects an approved FAQ or a verbatim passage, guarded by a separate support check. Scanned PDFs need OCR before upload. Knowledge files are limited to 10 MB / 600,000 extracted characters. Media uploads up to 20 MB use signed Cloudinary requests. Images, videos, audio, and PDFs can be attached to FAQs or manually sent in conversations.

**Contacts and orders.** The three stages are qualified, not qualified, and converted. An intake-in-progress contact starts in not qualified. A paid order automatically marks the contact converted and records the earliest currently paid order as the conversion time. Refunding/cancelling the last paid order reverses the conversion and removes its value from reports. Profiles include first inquiry, first conversion, elapsed conversion time, total paid value, form answers, objections, notes, observed hours, and touchpoints. Full-order refunds are supported; partial refunds and inventory are outside this version.

**Follow-through.** Up to seven touchpoints are planned for the seven calendar days after the inquiry. Candidate hours are ranked from inbound activity in the contact's known timezone (workspace timezone if unknown), counting distinct active days per hour. A message burst does not inflate evidence. The UI shows up to five actually observed hours, with evidence labels: low under 3 days, medium from 3, high from 7. These are observations, **not validated predictions of response probability**. Touchpoints are recalculated as new messages arrive. Elapsed slots are skipped; a worker more than three hours late creates a human task rather than sending a burst.

**Reporting.** The calendar, daily creative breakdowns, monthly reports, CSV export, and form patterns use **first-inquiry cohorts**. A later purchase updates the original inquiry day, even in a later month. Choose a creative to isolate attributable customers. Unattributed customers remain in all-creative totals. Form patterns normalize case/spacing; no unsupported semantic grouping is claimed. Each stage/field percentage uses the number of contacts that answered that field. Calendar colors use cohort profit after ad spend and configured operating expenses.

**Ad controls.** Administrators opt in at the workspace and individual-ad levels. The worker can pause underperformers; it does not create campaigns, raise budgets, redistribute budgets, or automatically reactivate ads. It requires a real paid-order AOV, three complete spend days (today excluded), recent spend syncs, average daily spend reaching `AOV × multiplier`, and unprofitable inquiry cohorts. Ads producing profitable results are retained. Shared ad-set budgets are imported as context, not treated as a separate budget per ad. By default, sync imports 90 days of Meta daily spend. Align ad-account currency/timezone with the workspace before syncing; incompatible accounts are explicitly skipped with a warning. Attribution is based on signed Messenger ad-referral data, not Meta's modeled attribution.

## Reporting definitions

All stored money uses integer minor units (centavos for PHP). The current expense rule applies consistently to the displayed historical orders.

| Metric | Calculation |
| --- | --- |
| Inquiry day | First inbound interaction in the workspace reporting timezone |
| Revenue / gross | Sum of currently paid orders belonging to that inquiry cohort, including later purchases |
| Paying customers | Distinct contacts with at least one currently paid order |
| Conversion rate | Paying customers ÷ inquiries |
| 24h / 3d / 7d conversion | Contacts whose first currently paid order is within that period of inquiry ÷ cohort inquiries |
| CPA | Daily creative spend ÷ paying customers in that creative's inquiry-day cohort |
| ROAS | Cohort revenue ÷ daily spend |
| AOV | Paid revenue ÷ paid order count, including repeat orders |
| Operating expense | Order amount × configured percentage, per paid order meeting the minimum amount |
| Profit | Revenue − ad spend − operating expenses |

Unknown ratios display **—**, not fabricated zeroes. Refunds remove entire refunded orders from current revenue/customer counts. Recent cohorts have not finished maturing. Qualification counts are exclusive current-stage counts, so converted contacts do not also count in qualified.

## Meta setup for live use

1. The production URL and `APP_URL` are `https://projectmori.vercel.app`.
   Add that URL to Supabase Auth's Site URL/allowed redirect URLs too. For local email confirmation, allow `http://127.0.0.1:3000`. Use the same hostname as `APP_URL` when opening the app so the OAuth state cookie matches the callback.
2. In the Meta app, configure Facebook Login for business use and register the exact redirect URI: `https://projectmori.vercel.app/api/facebook/callback`.
3. Configure the Messenger webhook: `https://projectmori.vercel.app/api/webhooks/facebook`. Use `FACEBOOK_WEBHOOK_VERIFY_TOKEN` from `.env.local` as the verify token.
4. Configure/review the necessary permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_messaging`, `ads_read`, `ads_management`, and `business_management`. Actual access depends on app mode, business verification, review, and the connecting user's permissions. `HUMAN_AGENT` also requires Meta approval.
5. In Mori, sign in, create a workspace, and choose **Settings → Connect Facebook**. Page subscriptions include `messages`, `messaging_postbacks`, and `messaging_referrals` for messages and acquisition attribution.
6. Assign Pages and ad accounts to members, sync ads, upload approved knowledge, and enable the assistant when ready. Ad automation remains off until explicitly enabled.

Standard automated messages are permitted only inside the supported standard messaging window. The default is **24 hours** after an inbound message. `HUMAN_AGENT` is available only for manually composed support replies within seven days; the worker never uses that tag. Meta can permit an ad-opened seven-day standard window for eligible first messages. The application supports this behind `FACEBOOK_AD_WINDOW_ENABLED=true`; leave it off until eligibility is confirmed for the actual app/Page. A click/referral alone never opens a messaging window. Scheduled messages outside eligibility become human tasks. Marketing-message opt-in/sponsored-message sending is not implemented.

The webhook validates HMAC signatures and stores events before acknowledgement. Message IDs are deduplicated. First acquisition attribution is preserved when a returning contact clicks another ad. Delivery failures that might have reached Meta are marked for review, without automatic replay. The audit trail records configuration and automation actions.

## Database and checks

```powershell
npm run db:migrate
npm test
npm run test:database
npm run test:tenancy:webhook
npm run test:autofill:live
npm run test:browser
npm run typecheck
npm run build
```

`test:database` tests tenant/Page isolation, token protection, write restrictions, and order/refund consistency inside a rolled-back transaction. `test:browser` uses installed Chrome; change the Playwright channel if necessary. Screenshots are saved under ignored `.local/`.

With the application, worker, and public deployment running, `test:tenancy:webhook` checks separate authenticated tenants, head/admin/member permissions, assigned Pages, role escalation rejection, the public webhook challenge and HMAC signature checks, durable queueing, duplicate suppression, processing by the running worker, and the Meta app’s active subscription. Both API and webhook requests use `APP_URL`. It removes all its temporary records and users and sends no customer messages.

With the local server running, `npm run test:integration` verifies real Supabase authentication and API persistence, automatic indexing, Cloudinary upload, and Messenger event ingestion. It creates an email-confirmed ephemeral test user **without sending email**, then removes its user, workspace, data, and uploaded test media.

## Project layout

- `src/components/`: dashboard/calendar, CRM, inbox, knowledge, settings, and team UI.
- `src/lib/domain.ts`: money, cohorts, contact-hour evidence, eligibility, and ad rules.
- `src/server/`: authenticated DB transactions, Jev, retrieval, Meta, sync, and worker.
- `src/app/api/`: tenant APIs, Facebook OAuth, signed webhook, authenticated cron.
- `supabase/migrations/`: versioned schema, RLS/grants, consistency triggers, referral storage.
- `scripts/`: migrations, connection diagnostics, worker, database/API verification.

Provider references: [OpenRouter Decisions API](https://openrouter.ai/docs/guides/features/decisions), [TypeSafe System One API](https://docs.typesafe.ai/api/system-one), [Meta messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy), [Meta Ads Insights](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights), [Cloudinary Upload API](https://cloudinary.com/documentation/image_upload_api_reference), [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).
