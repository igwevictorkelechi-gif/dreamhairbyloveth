# Dream Hair by Loveth

Website for **House of Loveth — Dream Hair by Loveth**, built from the design mockups.
It's a static site (plain HTML, no build step) hosted on Vercel.

## Pages

| Area | Pages |
| --- | --- |
| Storefront | `/` · `/shop` · `/product` · `/bag` · `/checkout` · `/order-confirmed` · `/about` · `/help` · `/account` |
| Admin | `/admin/login` · `/admin` · `/admin/orders` · `/admin/products` · `/admin/product-edit` · `/admin/customers` · `/admin/staff` |
| Mobile app (PWA) mockups | `/app/splash` · `/app/install` · `/app/product` · `/app/admin-home` · `/app/admin-order` · `/app/staff-invite` |
| Marketing | `/marketing/instagram` · `/marketing/thank-you-card` · `/marketing/app-icon` |

`/screens` lists every page.

## Still to fill in

Text in square brackets is a placeholder for real details, for example
`[AMOUNT]`, `[CODE]`, `[YOUR EMAIL]`, `[YOUR WHATSAPP NUMBER]`, `[INSTAGRAM HANDLE]`, `[YOUR STORY …]`.
Search the HTML files for `[` to find them all.

This is a front-end only: the bag, checkout, sign-in and admin screens are designed
pages, not yet connected to payments, a product database or real accounts.

## Run locally

```sh
npx serve .
```

## Deploy

Vercel serves the repository root as-is (`vercel.json` turns on clean URLs, so
`/shop` serves `shop.html`).
