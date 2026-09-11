# ASPIRANT TEST AI

Version 2 adds:

- Website branding changed to **ASPIRANT TEST AI**.
- Email + password registration/login through Supabase Auth (no OTP login flow).
- Every account starts with **2 free AI test generations**.
- After free tests are used, **1 test credit = 1 new AI test**.
- Sharing/reward system: every **10 unique signed-in students** who complete a creator's shared tests earns that creator **1 test credit**.
- Shared test links reuse the already-generated questions, so OpenAI is not called again for each student.
- Ranking / leaderboard per test. Higher score ranks first; tied scores use lower time.
- Google AdSense placeholders for pre-test and result ads.
- Promotions for ASPIRANT, APNA ASPIRANT, aspirant4u.com and WhatsApp support.
- Removed the public AI/model badge.

## Important Google ads rule

Do not give credits for clicks or views on ordinary AdSense inventory. Standard AdSense ads in this project are monetization only. If you later want "watch an ad and earn a test credit", configure a **rewarded web ad** product such as Google Ad Manager rewarded ads and implement the reward only after the rewarded-ad completion event. `REWARDED_ADS_ENABLED` is only a placeholder flag in this build; it does not grant rewards by itself.

## 1. Supabase setup (required for login/credits/ranking/share persistence)

1. Create a Supabase project.
2. Open **SQL Editor** and run the entire `setup.sql` file.
3. In **Authentication -> Providers -> Email**, keep Email/Password enabled.
4. You may keep email confirmation ON (confirmation link, not OTP) or turn it OFF for immediate account creation.
5. Copy Project URL, anon key and service-role key from your project settings.
6. Add these environment variables in Render:

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Never put the service-role key in browser JavaScript or GitHub.

## 2. OpenAI

Add in Render:

```
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-luna
```

The OpenAI call occurs only when a signed-in user generates a new test. Opening an existing test, sharing it, attempting it, scoring it and viewing rankings do not regenerate the test.

## 3. AdSense

After the website is approved in AdSense, create ad units and add:

```
ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
ADSENSE_SLOT_PRETEST=1234567890
ADSENSE_SLOT_RESULT=1234567891
```

You can also use AdSense Auto ads after approval. Standard AdSense ads must not be incentivized.

## 4. Render

Build command:

```
npm install
```

Start command:

```
npm start
```

After updating GitHub, Render can auto-deploy the latest commit.

## 5. Referral logic

- Creator shares a generated test URL.
- Another student signs in and completes that test.
- That student counts once toward that creator's referral total.
- The same student cannot repeatedly increase the same creator's referral count.
- At 10, 20, 30... unique students, creator receives +1 test credit.
- Ad clicks/views are deliberately not part of this counter.
