# Dream Hair by Loveth

Website and store admin for **House of Loveth — Dream Hair by Loveth**.
It's a static site (plain HTML, no build step) hosted on Vercel, with a
[Supabase](https://supabase.com) database for products, orders, messages and
newsletter sign-ups.

The look follows Apple's Human Interface Guidelines: system (San Francisco)
type, sentence case, a white storefront and glass materials, shared in
`assets/apple.css`. All live behaviour is in `assets/site.js`.

## What works live

| Page | What it does |
| --- | --- |
| `/`, `/shop` | Product cards come from the `products` table |
| `/product?p=<slug>` | Product details, length / lace / density choice, add to bag, buy now |
| `/bag` | The bag is kept in the shopper's browser; change quantities or remove items |
| `/checkout` | Places a real order through the `place_order` database function (bank transfer or pay on pick-up; card payments are not connected yet) |
| `/order-confirmed` | Shows the order that was just placed |
| `/help` | Contact form saves to `messages` |
| Homepage "Join the family" | Saves to `subscribers` |
| `/admin/login` | Staff sign in (Supabase Auth, email + password) |
| `/admin` | Revenue, orders, average order, new customers, daily revenue, top products, recent orders, low stock |
| `/admin/orders` | All orders, filters, search, CSV export; change fulfilment and payment status; WhatsApp the customer |
| `/admin/products` | Edit price and stock, publish or hide a product |
| `/admin/customers` | Customers built from orders |

The Staff, Edit product, mobile-app and marketing pages are still design mockups.

## Database (Supabase project `dreamhairbyloveth`)

- `products`: name, slug, price (₦), badge, image, options, stock, active
- `delivery_options`: standard / express / pick-up and their fees
- `orders` + `order_items`: created only by `place_order()`, which reads prices
  and delivery fees from the database and reduces stock
- `messages`, `subscribers`: anyone can add, only staff can read
- `staff`: who can use the admin

Row level security is on for every table. Shoppers can read active products
and delivery options and place orders; only signed-in staff can read orders,
customers, messages and subscribers.

### Add a staff member

1. Supabase dashboard → Authentication → Users → **Add user** (tick *Auto confirm*).
2. SQL editor:
   ```sql
   insert into public.staff (user_id, role)
   select id, 'staff' from auth.users where email = 'their@email.com';
   ```

### Add a product

Admin → Products lets you change price, stock and visibility. To add a new
product, add a row to `products` in the Supabase table editor and put its photo
in `images/`.

## Payments: CheqPay

Shoppers pay by bank transfer into the store's **CheqPay virtual account**. Each
order gets a unique amount (the total plus 1–999 kobo, for example ₦575,000.37),
so the incoming transfer can be matched to its order automatically. When CheqPay
sends `deposit.received`, the `cheqpay-webhook` function checks the signature
(Standard Webhooks, HMAC-SHA256) and `record_cheqpay_deposit()` marks the order
**paid** and moves it to **processing**. The confirmation page updates by itself.
Transfers that match no order show as *Unmatched* in Admin → Dashboard → Payments.

Card numbers never touch this site.

### Connect it (once)

1. In the CheqPay developer dashboard (developers.mycheqpay.com): open a
   virtual account for the store's verified customer, and create a secret API
   key with `virtual_accounts:read`. Start with a `cp_test_` key to try it out.
2. Add a webhook endpoint for **deposit.received** pointing to
   `https://elaoxcotnspbsljrcscb.supabase.co/functions/v1/cheqpay-webhook` and copy
   its signing secret (`whsec_…`).
3. Supabase dashboard → Edge Functions → Secrets: add `CHEQPAY_API_KEY` and
   `CHEQPAY_WEBHOOK_SECRET`.
4. Admin → Dashboard → Payments → **Connect CheqPay**. Checkout switches to
   CheqPay transfers straight away; until then it falls back to manual bank
   transfer.

In test mode, CheqPay's sandbox "simulate deposit" sends a real signed webhook,
so you can pay a test order end to end. Switch to live by replacing the key with
a `cp_live_` one and pressing **Refresh account details**.

Server code lives in `supabase/functions/` (`cheqpay-webhook`, `cheqpay-connect`).

## Order alerts (email + WhatsApp)

| When | You (the store) | The customer |
| --- | --- | --- |
| Order placed | Email + WhatsApp | Email (with CheqPay payment details) + WhatsApp |
| Payment confirmed | Email + WhatsApp | Email + WhatsApp |
| Marked shipped in admin | — | Email + WhatsApp |

How it works: a database trigger on `orders` writes one row per alert into
`notifications` and wakes the `order-alerts` edge function, which sends each
alert once and records the result. Failed sends retry (2, 4, 8… minutes, up to
5 tries) via a 5-minute `pg_cron` job. Admin → Dashboard → **Order alerts** sets
your email and WhatsApp number, can switch customer messages off, sends a test,
and shows the latest alerts with the reason any weren't sent.

### Connect the services

Add these in Supabase → Edge Functions → Secrets:

| Secret | What it is |
| --- | --- |
| `RESEND_API_KEY` | From resend.com → API keys. Sends all email. |
| `ALERT_FROM_EMAIL` | e.g. `Dream Hair by Loveth <orders@houseoflovethhair.com>`. Verify the domain in Resend first. Until then the default `onboarding@resend.dev` sender only delivers to your own Resend account address, so customer emails will fail. |
| `CALLMEBOT_APIKEY` | Your WhatsApp alerts. Save +34 644 59 71 67 (CallMeBot) in your phone, send it "I allow callmebot to send me messages", and it replies with your key. Put the same number in the admin card. |
| `WHATSAPP_TOKEN` | Customer WhatsApp: a permanent access token from your Meta app (WhatsApp → API setup). |
| `WHATSAPP_PHONE_NUMBER_ID` | The phone number ID shown on the same Meta page. |

### WhatsApp templates for customers (create in Meta → WhatsApp Manager → Message templates)

Category **Utility**, language **English (en)**. The names must match exactly.

- `dh_order_received`: *Hi {{1}}, we've received your order {{2}} for {{3}}. See your order and payment details here: {{4}}*
- `dh_payment_received`: *Hi {{1}}, we've received your payment of {{2}} for order {{3}}. We're preparing it now. Thank you for shopping with Dream Hair by Loveth.*
- `dh_order_shipped`: *Hi {{1}}, your order {{2}} is on its way. Reply to this message if you have any questions.*

Different names or language? Set `WA_TEMPLATE_PLACED`, `WA_TEMPLATE_PAID`,
`WA_TEMPLATE_SHIPPED` or `WHATSAPP_TEMPLATE_LANG` as secrets.

## Motion

Sections, cards and containers rise into place as they scroll into view, the
header gains a soft shadow on scroll, and buttons press in on tap. Everything is
switched off when the visitor's device asks for reduced motion.

## Still to fill in

Text in square brackets is a placeholder for real details, for example
`[AMOUNT]`, `[CODE]`, `[YOUR WHATSAPP NUMBER]`, `[INSTAGRAM HANDLE]`,
`[DELIVERY TIME]`, `[YOUR STORY …]`. Delivery fees (₦5,000 / ₦10,000 / free)
are placeholders in `delivery_options`.

## Run locally

```sh
npx serve .
```

## Deploy

Vercel serves the repository root as-is (`vercel.json` turns on clean URLs, so
`/shop` serves `shop.html`). The Supabase URL and public anon key are in
`assets/site.js`; the anon key is safe to publish because row level security
controls what it can do.
