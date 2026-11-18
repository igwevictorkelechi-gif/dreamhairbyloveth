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
