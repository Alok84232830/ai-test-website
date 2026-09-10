# TestForge AI — Online-ready AI Test Generator

Responsive Node.js website for AI-generated MCQ tests with 5–50 questions, timed attempts, positive/negative marking, server-side scoring, a pre-test web-ad area, and shareable test links.

## Included features

- Topic + exam/category input
- 5–50 questions
- Easy / Moderate / Hard / Mixed difficulty
- English / Hindi / Hinglish
- Time limit and marking scheme
- Pre-test advertisement area
- Question palette and countdown timer
- Correct answers hidden until submission
- Server-side scoring and explanations
- OpenAI Responses API integration
- Share button using Android/iPhone/desktop native sharing when available
- Copy-link fallback
- Shared links reopen the SAME generated test; the AI is not charged again for each student
- Optional Supabase persistence so share links survive server restarts
- Optional AdSense configuration
- Render-compatible `PORT` binding

## Run locally

1. Install Node.js 18+.
2. Open terminal in this folder.
3. Run `npm start`.
4. Open `http://localhost:3000`.

Without an API key the site runs in demo mode.

## Enable OpenAI

Copy `.env.example` to `.env`, then set:

```
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-5.6-luna
```

Keep the API key server-side. Never put it in HTML, CSS, or browser JavaScript.

## Make share links permanent with Supabase

The site works without Supabase while the Node server remains alive, but a real online site should persist tests in a database.

Create a Supabase project, open SQL Editor, and run:

```sql
create table if not exists public.shared_tests (
  id uuid primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.shared_tests enable row level security;
```

Do NOT create a public read/write policy. This project accesses the table only from the Node server using the Supabase service-role key.

Then configure server environment variables:

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SHARED_TEST_EXPIRY_DAYS=30
```

The service-role key is secret. Never put it in `public/` files.

## How sharing works

When a test is generated, the server creates a random UUID and saves the complete test server-side. The browser receives only the questions/options, not the answer key.

A share link looks like:

```
https://yourdomain.com/?test=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

When another student opens it, the server loads that same saved test, shows the pre-test ad/ready screen, starts a fresh timer for that student, and scores the attempt server-side. Generating once and sharing many times avoids repeated AI generation cost for that test.

## Google AdSense setup

After your public site/domain is ready and your AdSense site is approved, configure:

```
ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
ADSENSE_SLOT_PRETEST=1234567890
```

The server inserts the AdSense loader in the HTML head. The pre-test screen renders the configured responsive ad unit.

Important: a normal AdSense ad is not a guaranteed “watch to unlock” ad. Do not require clicks or simulate ad engagement. If you want a voluntary watch-an-ad-to-unlock experience, use a rewarded-web product such as Google Ad Manager rewarded ads and follow its reward/ad policies.

## Deploy to Render

1. Put this folder in a GitHub repository. Do NOT upload `.env`.
2. Render Dashboard → New → Web Service.
3. Connect the GitHub repository.
4. Language: Node.
5. Build command: `npm install`
6. Start command: `npm start`
7. Add Environment Variables in Render:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SHARED_TEST_EXPIRY_DAYS`
   - after AdSense approval: `ADSENSE_CLIENT`, `ADSENSE_SLOT_PRETEST`
8. Deploy. Render will provide an HTTPS `onrender.com` URL.
9. Add your custom domain in Render when ready.

For a real production site, use a paid/always-on hosting plan rather than relying on a sleeping free instance.

## Before applying for AdSense

Add real original site content and clear navigation. Also publish completed About, Contact, Privacy Policy and Terms pages for your business. Do not submit a thin/incomplete demo site for review.

## Recommended next production upgrades

- Student login/signup
- Student test history
- Creator dashboard with “My Tests”
- Attempt counts and leaderboard
- Per-user free usage limits and rate limiting
- Admin panel and abuse controls
- Premium/no-ads plan
- Privacy/consent handling appropriate to countries you serve
- Verified question bank / teacher review workflow
