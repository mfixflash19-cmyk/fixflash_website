# FixFlasH Full System — Setup Guide

This package upgrades the website frontend to use Supabase for real customer accounts, orders, deposit requests, wallet balance, and an admin review panel. You must connect your own Supabase project before it will work. It does not automatically change the already-published Netlify site until you deploy this folder.

## 1) Create the database/backend
1. Go to https://supabase.com/ and create a project. Save the database password privately.
2. Open **SQL Editor → New query**, paste all of `supabase-schema.sql`, and click **Run**.
3. Open **Project Settings → API** (or **Connect**) and copy the Project URL and public `anon`/publishable key.
4. Edit `config.js` and replace the two `PASTE_...` values. Use only the public anon/publishable key. **Never put the service_role key in website files.**

## 2) Enable accounts
1. In Supabase, open **Authentication → URL Configuration**.
2. Add your Netlify URL (for example `https://fixflash.netlify.app`) to Site URL and Redirect URLs.
3. For email-confirmed sign-up, configure email delivery in Supabase. Until configured, test with the confirmation flow shown in your project.

## 3) Make your account the admin
1. Register through the deployed site and confirm your email if required.
2. In Supabase **Authentication → Users**, copy your user UUID.
3. In SQL Editor, run this query after replacing `YOUR-USER-UUID` with your own UUID:

```sql
update public.profiles set role = 'admin' where id = 'YOUR-USER-UUID';
```

Only do this for your own trusted account. Never let users choose their role during registration.

## 4) Deploy to Netlify
1. Keep `index.html`, `style.css`, `app.js`, `config.js`, `logo.png`, and `logo-round.jpg` together in the same folder.
2. Zip the contents of this folder (not an extra enclosing folder), then upload/deploy that ZIP/folder to your Netlify site. The root of the deployed site must contain `index.html`.
3. Open the site in a private/incognito window, register a test account, login, place a test order, and submit a test deposit request.

## What works after setup
- Email/password register and login/logout using Supabase Auth.
- Per-user orders stored in the database; admin can change status.
- USDT deposit requests stored with unique network + TxID.
- Wallet balance stored server-side; only the admin approval SQL function can credit it.
- Admin role protected by database Row Level Security (RLS).

## Important security/payment notes
- USDT is **manual review** in this version. Admin must independently verify the network, destination address, token, amount and confirmations on a trusted blockchain explorer before entering a credit amount. A TxID alone is not proof of payment. No automatic blockchain verification is implemented.
- Customer checkout currently creates an order but does not deduct wallet funds. Do not advertise it as a paid checkout until you add an atomic wallet-charge function and a clear pricing/payment policy.
- Admin deposit rejection is available via SQL (`select public.admin_reject_deposit('DEPOSIT-UUID');`) only if run as a database owner; do not expose SQL editor credentials.
- Configure email confirmation, rate limits, backups, and monitoring before public launch. Use HTTPS only. Never share Supabase database passwords or private keys.
- This is a production-oriented starter, not an audited payment platform. Test thoroughly before handling real customer funds.
