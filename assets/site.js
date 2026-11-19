/* Dream Hair by Loveth — live storefront and admin.
   Talks to Supabase with the public (anon) key; row level security and the
   place_order() database function decide what the browser may read and write. */
(() => {
  'use strict';

  const SUPABASE_URL = 'https://elaoxcotnspbsljrcscb.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVsYW94Y290bnNwYnNsanJjc2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMDIxNDEsImV4cCI6MjExMDU3ODE0MX0.1gvF0Hq6lqKjoWjkFVGfToF1GW1-TZ1silBZZlT5izU';
  const db = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  const page = document.body.dataset.page || '';

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
  const short = (n) => n >= 1e6 ? '₦' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'
    : n >= 1e3 ? '₦' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : naira(n);
  const nairaKobo = (k) => '₦' + (Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const byText = (sel, t, root) => $$(sel, root).find((e) => text(e) === t);
  const startsWith = (sel, t, root) => $$(sel, root).find((e) => text(e).startsWith(t));
  const leaf = (root, re) => $$('span, strong, p, div, a', root).find((e) => !e.children.length && re.test(text(e)));
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtDateTime = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const productUrl = (p) => '/product?p=' + encodeURIComponent(p.slug);
  const waLink = (phone) => 'https://wa.me/' + String(phone || '').replace(/\D/g, '').replace(/^0/, '234');
  const priceFor = (p, length) => (length && p.length_prices && Number(p.length_prices[length]) > 0 ? Number(p.length_prices[length]) : p.price_ngn);
  const minPrice = (p) => Math.min(p.price_ngn, ...Object.values(p.length_prices || {}).map(Number).filter((n) => n > 0));
  const wasPrice = (p, now) => (p.compare_at_ngn && p.compare_at_ngn > now
    ? ` <s style="color:#6E6E73;font-weight:400;font-size:.85em;margin-left:6px">${naira(p.compare_at_ngn)}</s>` : '');
  const stripClick = (el) => { if (el) { el.removeAttribute('onclick'); el.onclick = null; } return el; };

  function toast(msg) {
    let t = $('.dh-toast');
    if (!t) { t = document.createElement('div'); t.className = 'dh-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function showError(anchor, msg) {
    let e = anchor.parentElement.querySelector(':scope > .dh-error');
    if (!e) { e = document.createElement('p'); e.className = 'dh-error'; e.setAttribute('role', 'alert'); anchor.insertAdjacentElement('afterend', e); }
    e.textContent = msg;
    e.hidden = !msg;
  }

  /* ---------- bag (kept in this browser) ---------- */
  const CART_KEY = 'dh-bag-v1';
  const cart = {
    get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } },
    set(items) { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* private mode */ } updateBagBadge(); },
    add(p, options, qty = 1) {
      const items = cart.get();
      const length = (p.lengths || []).find((L) => String(options || '').split(' · ').includes(L)) || null;
      const found = items.find((i) => i.slug === p.slug && i.options === options);
      if (found) found.quantity = Math.min(20, found.quantity + qty);
      else items.push({ slug: p.slug, name: p.name, price: priceFor(p, length), length, image: p.image, position: p.image_position, options, quantity: qty });
      cart.set(items);
    },
    count() { return cart.get().reduce((n, i) => n + i.quantity, 0); },
    total() { return cart.get().reduce((n, i) => n + i.price * i.quantity, 0); },
  };

  function updateBagBadge() {
    const n = cart.count();
    $$('header button[aria-label^="Bag"], header button[aria-label="Cart"]').forEach((b) => {
      b.setAttribute('aria-label', n ? `Bag, ${n} item${n > 1 ? 's' : ''}` : 'Bag, empty');
      b.style.position = 'relative';
      let badge = b.querySelector('.dh-badge') || $$('span', b).find((s) => /^\d+$/.test(text(s)));
      if (!badge) {
        badge = document.createElement('span');
        b.appendChild(badge);
      }
      badge.className = 'dh-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.style.cssText = 'position:absolute;top:4px;right:2px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:980px;background:#6E1A2C;color:#FFFFFF;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center';
      badge.textContent = n;
      badge.style.display = n ? 'flex' : 'none';
    });
  }

  /* ---------- wishlist ("saved looks") ---------- */
  const WL_KEY = 'dh-wishlist-v1';
  const wl = {
    slugs: new Set((() => { try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; } catch { return []; } })()),
    uid: null,
    save() { try { localStorage.setItem(WL_KEY, JSON.stringify([...this.slugs])); } catch { /* private mode */ } },
    has(slug) { return this.slugs.has(slug); },
    async sync() {
      if (!db) return;
      const { data: { session } } = await db.auth.getSession();
      this.uid = session ? session.user.id : null;
      if (!this.uid) return;
      const { data } = await db.from('wishlist').select('product_slug');
      const remote = new Set((data || []).map((r) => r.product_slug));
      const missing = [...this.slugs].filter((x) => !remote.has(x));
      if (missing.length) await db.from('wishlist').insert(missing.map((x) => ({ user_id: this.uid, product_slug: x }))).then(() => {}, () => {});
      remote.forEach((x) => this.slugs.add(x));
      this.save();
    },
    async toggle(slug) {
      const on = !this.slugs.has(slug);
      if (on) this.slugs.add(slug); else this.slugs.delete(slug);
      this.save();
      paintWish();
      if (this.uid) {
        if (on) await db.from('wishlist').insert({ user_id: this.uid, product_slug: slug }).then(() => {}, () => {});
        else await db.from('wishlist').delete().eq('user_id', this.uid).eq('product_slug', slug).then(() => {}, () => {});
      }
      return on;
    },
  };
  function paintWish() {
    $$('[data-wish]').forEach((b) => {
      const on = wl.has(b.dataset.wish);
      const name = b.dataset.name || 'this wig';
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? `Remove ${name} from your wishlist` : `Add ${name} to your wishlist`);
      const svg = $('svg', b);
      if (svg) svg.style.fill = on ? 'currentColor' : 'none';
      b.style.color = on ? '#8A1F35' : '';
    });
    const n = wl.slugs.size;
    $$('header button[aria-label^="Wishlist"], header button[aria-label^="Saved looks"]').forEach((b) => {
      b.setAttribute('aria-label', n ? `Wishlist, ${n}` : 'Wishlist');
      const svg = $('svg', b);
      if (svg) svg.style.fill = n ? 'currentColor' : 'none';
    });
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-wish]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const on = await wl.toggle(b.dataset.wish);
    toast(on ? `${b.dataset.name || 'Saved'} added to your wishlist` : 'Removed from your wishlist');
    if (page === 'account') document.dispatchEvent(new CustomEvent('dh-wishlist-changed'));
  });

  /* ---------- products ---------- */
  let productsPromise;
  function loadProducts() {
    if (!productsPromise) {
      productsPromise = db
        ? db.from('products').select('*').eq('active', true).order('sort').then(({ data, error }) => { if (error) throw error; return data || []; })
        : Promise.resolve([]);
    }
    return productsPromise;
  }
  const defaultOptions = (p) => [p.lengths[Math.floor((p.lengths.length - 1) / 2)], p.laces[0], p.densities[Math.floor((p.densities.length - 1) / 2)]]
    .filter(Boolean).join(' · ');

  /* ---------- storefront menu ---------- */
  function initMenu() {
    const header = $('header.glass-bar-light, header.glass-bar');
    const nav = header && $('nav[aria-label="Main"]', header);
    if (!nav) return;
    const icons = $$('div', header).filter((d) => d.querySelector('button[aria-label="Account"]')).pop();
    const heart = $('button[aria-label="Wishlist"]', header);
    if (heart) { stripClick(heart); heart.addEventListener('click', () => { location.href = '/account#saved'; }); }
    const tmpl = $('a', nav);
    [['Wishlist', '/account#saved'], ['My account', '/account']].forEach(([label, href]) => {
      if ($$('a', nav).some((a) => text(a) === label)) return;
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      if (tmpl) a.setAttribute('style', tmpl.getAttribute('style') || '');
      a.className = 'dh-menu-extra';
      nav.appendChild(a);
    });
    nav.id = 'main-menu';
    nav.classList.add('menu-sheet');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-toggle';
    btn.setAttribute('aria-controls', 'main-menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Menu');
    btn.innerHTML = '<span></span>';
    (icons || header.firstElementChild).appendChild(btn);
    const setOpen = (open) => {
      header.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    };
    btn.addEventListener('click', () => setOpen(!header.classList.contains('menu-open')));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    // a tap outside the menu, including on the dimmed page (the header's backdrop layer), closes it
    document.addEventListener('click', (e) => { if (!header.contains(e.target) || e.target === header) setOpen(false); });
    matchMedia('(min-width: 821px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
  }

  /* ---------- product cards on home, shop and product pages ---------- */
  function fillCard(card, p) {
    const zoom = $('a.zoom', card);
    if (zoom) {
      zoom.href = productUrl(p);
      const img = $('img', zoom);
      if (img) { img.src = p.image; img.alt = p.name; img.style.objectPosition = p.image_position || 'center'; }
      const badge = $$(':scope > span', zoom).find((s) => !s.getAttribute('aria-hidden'));
      if (badge) { if (p.badge) badge.textContent = p.badge; else badge.remove(); }
    }
    const title = $$('a', card).find((a) => !a.classList.contains('zoom'));
    if (title) { title.textContent = p.name; title.href = productUrl(p); }
    const price = leaf(card, /₦|\[PRICE\]/);
    if (price) {
      const lo = minPrice(p);
      price.innerHTML = (lo < p.price_ngn || Object.keys(p.length_prices || {}).length ? 'From ' : '') + naira(lo) + wasPrice(p, lo);
    }
    const sub = leaf(card, /\[LENGTH\]|·/);
    if (sub && sub !== price) sub.textContent = [p.style, p.laces[0]].filter(Boolean).join(' · ');
    const wish = $('button[aria-label^="Save"]', card);
    if (wish) { stripClick(wish); wish.dataset.wish = p.slug; wish.dataset.name = p.name; }
    const add = $$('button', card).find((b) => /add to bag/i.test(text(b)));
    if (add) {
      stripClick(add);
      Object.assign(add.style, { background: 'transparent', color: '#1D1D1F', border: '1px solid rgba(0,0,0,.16)' });
      add.disabled = p.stock <= 0;
      if (p.stock <= 0) add.textContent = 'Sold out';
      add.addEventListener('click', () => { cart.add(p, defaultOptions(p)); toast(`${p.name} added to your bag`); });
    }
  }

  function renderProductGrids(products, exclude) {
    const groups = new Map();
    $$('article').forEach((a) => {
      if (a.querySelector('a.zoom') && a.parentElement) groups.set(a.parentElement, true);
    });
    groups.forEach((_, grid) => {
      const cards = $$(':scope > article', grid);
      const template = cards[0].cloneNode(true);
      const anchor = cards[cards.length - 1].nextElementSibling;
      cards.forEach((c) => c.remove());
      const list = products.filter((p) => p.slug !== exclude);
      list.slice(0, exclude ? 2 : 12).forEach((p) => {
        const card = template.cloneNode(true);
        fillCard(card, p);
        grid.insertBefore(card, anchor);
      });
    });
    const filters = $('aside[aria-label="Filters"]');
    if (filters && !$('.dh-filter-toggle', filters)) {
      const head = filters.firstElementChild;
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'dh-filter-toggle';
      t.setAttribute('aria-expanded', 'false');
      t.textContent = 'Show filters';
      t.addEventListener('click', () => {
        const open = filters.classList.toggle('open');
        t.setAttribute('aria-expanded', String(open));
        t.textContent = open ? 'Hide filters' : 'Show filters';
      });
      head.appendChild(t);
    }
    const count = leaf(document, /^\d+ styles$/);
    if (count) count.textContent = `${products.length} style${products.length === 1 ? '' : 's'}`;
    // the hero "New in" card and other single product links
    const fresh = products.find((p) => p.badge === 'New') || products[0];
    $$('a[href="/product"]').forEach((a) => {
      const named = products.find((p) => text(a).includes(p.name.split(' ')[0]));
      a.href = productUrl(named || fresh);
    });
  }

  /* ---------- content from Admin → Content (fills the [PLACEHOLDERS]) ---------- */
  const TOKENS = {
    'YOUR WHATSAPP NUMBER': 'whatsapp', 'YOUR NUMBER': 'whatsapp', 'YOUR EMAIL': 'email', 'INSTAGRAM HANDLE': 'instagram',
    'YOUR OPENING HOURS': 'hours', 'DELIVERY TIME': 'delivery_time', 'YOUR PICKUP LOCATION': 'pickup', 'PAYMENT METHODS': 'payment_methods',
    'YOUR DELIVERY TIMES AND AREAS': 'delivery_areas', 'YOUR DELIVERY AREAS & TIMES': 'delivery_areas', 'YOUR DELIVERY TIMES, AREAS AND RETURNS POLICY': 'delivery_returns',
    'YOUR RETURNS POLICY': 'returns', 'HAIR TYPE / ORIGIN': 'hair_type', 'LACE DETAILS': 'lace_details', 'CAP SIZES': 'cap_sizes',
    'YOUR WIG CARE TIPS': 'care_tips', 'YOUR WIG CARE TIPS — washing, styling, storing': 'care_tips',
    'YOUR STORY — how Dream Hair by Loveth started, what inspired you and what makes your wigs special.': 'story',
    'A SECOND PARAGRAPH — your promise to your customers.': 'promise',
  };
  async function loadContent() {
    const KEY = 'dh-content-v1';
    try { const c = JSON.parse(sessionStorage.getItem(KEY)); if (c && Date.now() - c.t < 5 * 60 * 1000) return c; } catch { /* ignore */ }
    const [{ data: rows = [] }, { data: promos }] = await Promise.all([db.from('site_content').select('key, value'), db.rpc('store_promos')]);
    const c = { t: Date.now(), v: Object.fromEntries((rows || []).map((r) => [r.key, r.value])), promos: promos || {} };
    try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
    return c;
  }
  async function applyContent() {
    if (!db) return;
    let c;
    try { c = await loadContent(); } catch { return; }
    const v = { ...c.v };
    v.delivery_returns = [v.delivery_areas, v.returns].filter(Boolean).join('\n\n');
    const free = c.promos.free_delivery_over_ngn;
    const feat = c.promos.featured;
    const featLabel = feat ? (feat.kind === 'percent' ? `${feat.value}% off` : `${naira(feat.value)} off`) : '';
    // the announcement bar and other promo lines
    $$('span, p, div, a, strong').filter((e) => !e.children.length && /\[(AMOUNT|CODE)\]/.test(e.textContent)).forEach((e) => {
      const t = e.textContent;
      if (/\[AMOUNT\]/.test(t) && /\[CODE\]/.test(t)) {
        const parts = [];
        if (free != null) parts.push(free ? `Free delivery on orders over ${naira(free)}` : 'Free delivery on every order');
        if (feat) parts.push(`${featLabel} ${feat.first_order_only ? 'your first wig' : 'your order'} with code ${feat.code}`);
        if (parts.length) e.textContent = parts.join(' · ');
        else { const bar = e.closest('div'); (bar && bar.parentElement === document.body.firstElementChild ? bar : e).hidden = true; e.hidden = true; }
        return;
      }
      let out = t;
      if (/\[AMOUNT\]/.test(out)) { if (free == null) { e.hidden = true; return; } out = out.replace(/\[AMOUNT\]/g, naira(free)); }
      if (/\[CODE\]/.test(out)) {
        if (!feat) { e.hidden = true; return; }
        out = out.replace(/\[X\]% off/g, featLabel).replace(/\[X\]%?/g, String(feat.value)).replace(/\[CODE\]/g, feat.code);
      }
      e.textContent = out;
    });
    // text placeholders
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.includes('[') && !n.parentElement.closest('script, style, [data-admin-body]') ? 1 : 3) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const t = n.nodeValue.replace(/\s*\[ADD YOUR PRODUCT DESCRIPTION\]/g, '').replace(/\[([^\]]{2,140})\]/g, (m, tok) => {
        const key = TOKENS[tok.trim()];
        const val = key && (v[key] || '').trim();
        if (!val) return m;
        return key === 'instagram' ? val.replace(/^@/, '') : val;
      });
      if (t !== n.nodeValue) {
        n.nodeValue = t;
        if (t.includes('\n')) n.parentElement.style.whiteSpace = 'pre-line';
      }
    });
    // links
    if (v.whatsapp) $$('a').filter((a) => /^WhatsApp/i.test(text(a)) || /wa\.me\/?$|^#$/.test(a.getAttribute('href') || '') && /WhatsApp/i.test(text(a))).forEach((a) => { if (!/wa\.me\/\d/.test(a.href)) { a.href = waLink(v.whatsapp); a.target = '_blank'; a.rel = 'noopener'; } });
    if (v.instagram) $$('a').filter((a) => /instagram|^Follow @/i.test(text(a))).forEach((a) => { a.href = 'https://instagram.com/' + v.instagram.replace(/^@/, ''); a.target = '_blank'; a.rel = 'noopener'; });
    if (v.tiktok) $$('a').filter((a) => /^TikTok$/i.test(text(a))).forEach((a) => { a.href = 'https://www.tiktok.com/@' + v.tiktok.replace(/^@/, ''); a.target = '_blank'; a.rel = 'noopener'; });
    if (v.email) $$('a').filter((a) => text(a) === v.email).forEach((a) => { a.href = 'mailto:' + v.email; });
  }

  /* ---------- product page ---------- */
  function initProductPage(products) {
    const slug = new URLSearchParams(location.search).get('p');
    const p = products.find((x) => x.slug === slug) || products.find((x) => x.slug === 'ash-brown-body-wave') || products[0];
    if (!p) return;
    document.title = `${p.name} — Dream Hair by Loveth`;
    const h1 = $('h1');
    h1.textContent = p.name;
    const crumb = $('nav[aria-label="Breadcrumb"] [aria-current="page"]');
    if (crumb) crumb.textContent = p.name;
    const info = h1.closest('div').parentElement;
    const eyebrow = h1.previousElementSibling;
    if (eyebrow) {
      const t = p.badge === 'Bestseller' ? 'The bestseller' : p.badge === 'New' ? 'New in' : p.style || '';
      eyebrow.textContent = t;
      eyebrow.hidden = !t;
    }
    const priceRow = h1.nextElementSibling;
    const priceSpan = priceRow && $$('span', priceRow)[0];
    const showPrice = (len) => { if (priceSpan) priceSpan.innerHTML = naira(priceFor(p, len)) + wasPrice(p, priceFor(p, len)); };
    if (priceRow) {
      const spans = $$('span', priceRow);
      showPrice(null);
      if (spans[1]) spans[1].textContent = 'SKU ' + (p.sku || p.slug).toUpperCase();
    }
    const desc = $$('p', info).find((x) => x.closest('div') === h1.closest('div').parentElement || x.parentElement === info);
    if (desc) desc.textContent = p.description || '';
    const photos = [p.image, ...(p.images || [])].filter(Boolean);
    $$('img[src^="/images/"]').filter((i) => !i.closest('article') && !i.closest('header, footer')).forEach((img, i) => {
      img.src = photos[i % photos.length]; img.alt = i ? `${p.name}, photo ${(i % photos.length) + 1}` : p.name;
      img.style.objectPosition = i % photos.length === 0 ? (p.image_position || 'center') : 'center';
    });
    const mainWish = $('button[aria-label="Save to wishlist"]');
    if (mainWish) { stripClick(mainWish); mainWish.dataset.wish = p.slug; mainWish.dataset.name = p.name; }
    const mainBadge = $$('span').find((s) => /^(Bestseller|New)$/.test(text(s)) && !s.closest('article'));
    if (mainBadge) { if (p.badge) mainBadge.textContent = p.badge; else mainBadge.remove(); }

    const selected = {};
    [['Length', p.lengths], ['Lace', p.laces], ['Density', p.densities]].forEach(([label, values]) => {
      const head = $$('span').find((s) => text(s).startsWith(label + ' ·'));
      if (!head) return;
      const group = head.nextElementSibling;
      if (!values.length) { head.parentElement.hidden = true; return; }
      const on = $('button[aria-pressed="true"]', group);
      const off = $('button[aria-pressed="false"]', group) || on;
      const onStyle = on.getAttribute('style');
      const offStyle = off.getAttribute('style');
      const valueEl = $('span', head);
      const current = text(on);
      selected[label] = values.includes(current) ? current : values[Math.floor((values.length - 1) / 2)];
      group.innerHTML = '';
      values.forEach((v) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = v;
        const sync = () => {
          const isOn = selected[label] === v;
          b.setAttribute('aria-pressed', String(isOn));
          b.setAttribute('style', isOn ? onStyle : offStyle);
        };
        b._sync = sync;
        b.addEventListener('click', () => {
          selected[label] = v;
          if (valueEl) valueEl.textContent = v;
          $$('button', group).forEach((x) => x._sync());
          if (label === 'Length') showPrice(v);
        });
        sync();
        group.appendChild(b);
      });
      if (valueEl) valueEl.textContent = selected[label];
      if (label === 'Length') showPrice(selected[label]);
    });
    const options = () => ['Length', 'Lace', 'Density'].map((k) => selected[k]).filter(Boolean).join(' · ');

    let qty = 1;
    const dec = $('button[aria-label="Decrease quantity"]');
    const inc = $('button[aria-label="Increase quantity"]');
    const qtyEl = dec && dec.nextElementSibling;
    const maxQty = Math.max(1, Math.min(5, p.stock));
    const setQty = (n) => { qty = Math.max(1, Math.min(maxQty, n)); if (qtyEl) qtyEl.textContent = qty; };
    if (dec) dec.addEventListener('click', () => setQty(qty - 1));
    if (inc) inc.addEventListener('click', () => setQty(qty + 1));

    const addBtn = $$('button').find((b) => /^add to bag/i.test(text(b)) && !b.closest('article'));
    const buyBtn = $$('button').find((b) => /^buy it now/i.test(text(b)));
    [addBtn, buyBtn].forEach(stripClick);
    const stockEl = $$('p').find((x) => /in stock/i.test(text(x)));
    if (p.stock <= 0) {
      [addBtn, buyBtn].forEach((b) => { if (b) { b.disabled = true; b.classList.add('dh-busy'); } });
      if (stockEl) stockEl.lastChild.textContent = ' Sold out';
    } else if (p.stock <= 3 && stockEl) {
      stockEl.lastChild.textContent = ` Only ${p.stock} left`;
    }
    if (addBtn) addBtn.addEventListener('click', () => { cart.add(p, options(), qty); toast(`${p.name} added to your bag`); });
    if (buyBtn) buyBtn.addEventListener('click', () => { cart.add(p, options(), qty); location.href = '/checkout'; });

    $$('li').forEach((li) => {
      if (/^Colour:/.test(text(li)) && p.colour) li.textContent = 'Colour: ' + p.colour;
      if (/^Texture:/.test(text(li)) && p.style) li.textContent = 'Texture: ' + p.style.toLowerCase();
    });
    renderProductGrids(products, p.slug);
  }

  /* ---------- bag page ---------- */
  function initBagPage(products) {
    const h1 = $('h1');
    const countEl = h1 && h1.nextElementSibling;
    const rows = $$('div.glass-light').filter((d) => d.querySelector('a[href^="/product"] img'));
    if (!rows.length) return;
    const template = rows[0].cloneNode(true);
    const parent = rows[0].parentElement;
    const anchor = rows[rows.length - 1].nextElementSibling;
    rows.forEach((r) => r.remove());
    const freeBar = $('[aria-label="Progress to free delivery"]');
    if (freeBar) freeBar.parentElement.hidden = true;

    const summary = $('aside[aria-label="Order summary"]');
    const subLabel = summary && startsWith('span, div', 'Subtotal', summary);
    const totalLabel = summary && byText('span, div', 'Total', summary);
    const checkout = summary && $('a[href="/checkout"]', summary);

    let empty;
    function render() {
      $$('.dh-bag-row', parent).forEach((r) => r.remove());
      const items = cart.get();
      const n = cart.count();
      if (countEl) countEl.textContent = `${n} item${n === 1 ? '' : 's'}`;
      items.forEach((item, idx) => {
        const row = template.cloneNode(true);
        row.classList.add('dh-bag-row');
        const p = products.find((x) => x.slug === item.slug);
        const url = '/product?p=' + encodeURIComponent(item.slug);
        $$('a[href^="/product"]', row).forEach((a) => { a.href = url; });
        const img = $('img', row);
        if (img) { img.src = item.image; img.alt = item.name; img.style.objectPosition = item.position || 'center'; }
        const name = $$('a', row).find((a) => !a.querySelector('img'));
        if (name) name.textContent = item.name;
        const price = leaf(row, /₦/);
        if (price) price.textContent = naira(item.price * item.quantity);
        const opts = leaf(row, /^Length|·/);
        if (opts && opts !== price) opts.textContent = item.options;
        const stock = leaf(row, /in stock/i);
        if (stock && p && p.stock <= 3) stock.textContent = p.stock > 0 ? `Only ${p.stock} left` : 'Sold out';
        const dec = $('button[aria-label="Decrease quantity"]', row);
        const inc = $('button[aria-label="Increase quantity"]', row);
        const q = dec && dec.nextElementSibling;
        if (q) q.textContent = item.quantity;
        const change = (d) => {
          const all = cart.get();
          all[idx].quantity = Math.max(1, Math.min(20, all[idx].quantity + d));
          cart.set(all); render();
        };
        if (dec) dec.addEventListener('click', () => change(-1));
        if (inc) inc.addEventListener('click', () => change(1));
        const save = byText('button', 'Save for later', row);
        if (save) save.remove();
        const remove = byText('button', 'Remove', row);
        if (remove) remove.addEventListener('click', () => { const all = cart.get(); all.splice(idx, 1); cart.set(all); render(); });
        parent.insertBefore(row, anchor);
      });
      if (!items.length) {
        if (!empty) {
          empty = document.createElement('div');
          empty.className = 'glass-light dh-bag-row';
          empty.style.cssText = 'padding:40px 28px;border-radius:18px;display:flex;flex-direction:column;align-items:flex-start;gap:14px';
          empty.innerHTML = '<p style="margin:0;font-size:22px;font-weight:600">Your bag is empty</p><p style="margin:0;color:#6E6E73">Find a wig you love and it will show up here.</p><a href="/shop" style="display:inline-flex;align-items:center;min-height:44px;padding:0 22px;border-radius:980px;background:#6E1A2C;color:#FFFFFF;text-decoration:none;font-weight:600">Shop wigs</a>';
        }
        parent.insertBefore(empty, anchor);
      }
      const total = cart.total();
      if (subLabel) { subLabel.textContent = `Subtotal (${n} item${n === 1 ? '' : 's'})`; if (subLabel.nextElementSibling) subLabel.nextElementSibling.textContent = naira(total); }
      if (totalLabel && totalLabel.nextElementSibling) totalLabel.nextElementSibling.textContent = naira(total);
      if (checkout) { checkout.style.pointerEvents = n ? '' : 'none'; checkout.style.opacity = n ? '' : '.4'; checkout.setAttribute('aria-disabled', String(!n)); }
    }
    render();

    // "You may also love" upsell
    const upsell = startsWith('div', 'You may also love');
    if (upsell) {
      const box = upsell.closest('div:has(> button)') || upsell.parentElement;
      const btn = box && $('button', box);
      const p = products.find((x) => text(box).includes(x.name) && !cart.get().some((i) => i.slug === x.slug))
        || products.find((x) => !cart.get().some((i) => i.slug === x.slug));
      if (btn && p) {
        stripClick(btn);
        const img = $('img', box); if (img) { img.src = p.image; img.alt = p.name; }
        const nm = leaf(box, new RegExp(products.map((x) => x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')));
        if (nm) nm.textContent = p.name;
        const pr = leaf(box, /₦/); if (pr) pr.textContent = naira(p.price_ngn);
        btn.addEventListener('click', () => { cart.add(p, defaultOptions(p)); toast(`${p.name} added`); render(); box.hidden = true; });
      } else if (box) box.hidden = true;
    }
    $$('button').filter((b) => text(b) === 'Apply').forEach((b) => discountBox(b, () => cart.total(), () => '', (d) => {
      let line = summary && $('.dh-disc-line', summary);
      if (!line && summary && totalLabel) {
        line = document.createElement('div');
        line.className = 'dh-disc-line';
        line.style.cssText = 'display:flex;justify-content:space-between;gap:12px;font-size:15px;color:#1E5B34';
        totalLabel.parentElement.insertAdjacentElement('beforebegin', line);
      }
      if (line) { line.hidden = !d; if (d) line.innerHTML = `<span>Discount (${esc(d.code)})</span><span>−${naira(d.amount_ngn)}</span>`; }
      if (totalLabel && totalLabel.nextElementSibling) totalLabel.nextElementSibling.textContent = naira(cart.total() - (d ? d.amount_ngn : 0));
    }));
  }

  /* ---------- discount code box (bag and checkout) ---------- */
  const DISC_KEY = 'dh-discount-v1';
  function discountBox(btn, subtotal, email, onChange) {
    const row = btn.parentElement;
    const inp = row && $('input', row);
    if (!inp) return null;
    stripClick(btn);
    inp.autocomplete = 'off'; inp.style.textTransform = 'uppercase';
    let current = null;
    const note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.style.cssText = 'margin:6px 0 0;font-size:14px';
    row.insertAdjacentElement('afterend', note);
    const apply = async (code, quiet) => {
      code = String(code || '').trim().toUpperCase();
      if (!code) { current = null; note.textContent = ''; try { sessionStorage.removeItem(DISC_KEY); } catch { /* ignore */ } onChange(null); return; }
      btn.classList.add('dh-busy');
      const { data } = await db.rpc('check_discount', { p_code: code, p_subtotal: subtotal(), p_email: email() || null });
      btn.classList.remove('dh-busy');
      if (!data || !data.ok) {
        current = null; onChange(null);
        if (!quiet) { note.style.color = '#8A1F35'; note.textContent = (data && data.error) || 'That code isn’t valid'; }
        else note.textContent = '';
        try { sessionStorage.removeItem(DISC_KEY); } catch { /* ignore */ }
        return;
      }
      current = data;
      inp.value = data.code;
      note.style.color = '#1E5B34';
      note.textContent = `${data.label} applied — you save ${naira(data.amount_ngn)}`;
      try { sessionStorage.setItem(DISC_KEY, data.code); } catch { /* ignore */ }
      onChange(data);
    };
    btn.addEventListener('click', (e) => { e.preventDefault(); apply(inp.value); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(inp.value); } });
    let saved = null;
    try { saved = sessionStorage.getItem(DISC_KEY); } catch { /* ignore */ }
    if (saved) apply(saved, true);
    return { get: () => current, recheck: () => current && apply(current.code, false) };
  }

  /* ---------- checkout ---------- */
  const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];

  async function initCheckout() {
    const field = (labelStart) => { const l = $$('label').find((x) => text(x).startsWith(labelStart)); return l && $('input, select, textarea', l); };
    const f = {
      email: $('input[type="email"]'), phone: $('input[type="tel"]'), first_name: field('First name'), last_name: field('Last name'),
      address: field('Address'), address2: field('Apartment'), city: field('City'), state: field('State'),
      marketing: $('input[type="checkbox"]'),
    };
    if (f.marketing) f.marketing.checked = false;
    const auto = { email: 'email', phone: 'tel', first_name: 'given-name', last_name: 'family-name', address: 'address-line1', address2: 'address-line2', city: 'address-level2', state: 'address-level1' };
    Object.entries(auto).forEach(([k, a]) => { if (f[k]) { f[k].autocomplete = a; f[k].name = k; if (k !== 'address2') f[k].required = true; } });
    if (f.state) f.state.innerHTML = '<option value="">Select state</option>' + STATES.map((s) => `<option>${s}</option>`).join('');
    const { data: { session } } = await db.auth.getSession();
    let profile = null;
    if (session) {
      ({ data: profile } = await db.from('customer_profiles').select('*').eq('user_id', session.user.id).maybeSingle());
      const fill = { email: session.user.email, phone: profile && profile.phone, first_name: profile && profile.first_name, last_name: profile && profile.last_name,
        address: profile && profile.address, address2: profile && profile.address2, city: profile && profile.city, state: profile && profile.state };
      Object.entries(fill).forEach(([k, v]) => { if (f[k] && v && !f[k].value) f[k].value = v; });
    } else {
      const contact = $$('section.glass-light').find((x) => /Contact/.test(text($('h2', x))));
      if (contact) {
        const hint = document.createElement('p');
        hint.style.cssText = 'margin:0;font-size:14px;color:#6E6E73';
        hint.innerHTML = 'Have an account? <a href="/account?next=/checkout" style="color:#6E1A2C">Sign in</a> to fill this in for you.';
        $('h2', contact).insertAdjacentElement('afterend', hint);
      }
    }

    const items = cart.get();
    const payBtn = stripClick($$('button').find((b) => /^pay/i.test(text(b))));
    const summary = $('aside[aria-label="Order summary"]');

    // delivery options from the database
    const { data: delivery = [] } = db ? await db.from('delivery_options').select('*').eq('active', true).order('sort') : { data: [] };
    const ship = $$('input[type="radio"][name="ship"]');
    ship.forEach((r, i) => {
      const opt = delivery[i];
      const label = r.closest('label');
      if (!opt) { label.hidden = true; return; }
      r.value = opt.code;
      r.checked = i === 0;
      const name = leaf(label, /delivery|pick up/i); if (name) name.textContent = opt.name;
      const detail = name && name.nextElementSibling; if (detail && opt.detail) detail.textContent = opt.detail;
      const fee = leaf(label, /₦|^Free$/); if (fee) fee.textContent = opt.fee_ngn ? naira(opt.fee_ngn) : 'Free';
    });

    // payment: bank transfer through CheqPay (confirmed automatically) or pay on pick-up.
    // Card fields are never shown: card numbers must not pass through this site.
    const { data: payOpts } = await db.rpc('payment_options');
    const cheqpay = !!(payOpts && payOpts.cheqpay);
    const pay = $$('input[type="radio"][name="pay"]');
    const [card, bank, other] = pay;
    if (card) {
      const cardInput = $('input[placeholder^="1234"]');
      if (cardInput) {
        let box = cardInput;
        while (box.parentElement && !box.parentElement.contains(card)) box = box.parentElement;
        if (box.parentElement && box.parentElement.contains(card) && !box.contains(card)) box.hidden = true;
        $$('input', box).forEach((i) => { i.disabled = true; i.required = false; });
      }
      card.disabled = true;
      card.closest('label').hidden = true;
    }
    if (bank) {
      bank.value = 'bank_transfer'; bank.checked = true;
      const bl = bank.closest('label');
      const nm = leaf(bl, /^Bank transfer$/);
      const d = leaf(bl, /\[BANK/);
      if (cheqpay) {
        if (nm) nm.innerHTML = 'Bank transfer <span style="font-size:12px;font-weight:600;color:#6E1A2C;background:#F6E3E1;border-radius:980px;padding:2px 8px;margin-left:6px">CheqPay</span>';
        if (d) d.textContent = 'You get an account number and an exact amount. Your payment is confirmed automatically, usually within a minute.';
      } else if (d) d.textContent = "We'll send our bank details on WhatsApp or email after you order.";
    }
    if (other) {
      other.value = 'pay_on_pickup';
      const d = leaf(other.closest('label'), /\[OTHER/); if (d) d.textContent = 'Pay when you pick up';
    }
    const syncPickup = () => {
      const pickup = (ship.find((r) => r.checked) || {}).value === 'pickup';
      if (other) { other.disabled = !pickup; other.closest('label').style.opacity = pickup ? '' : '.5'; if (!pickup && other.checked) bank.checked = true; }
    };

    // order summary
    const rows = summary ? $$('div', summary).filter((d) => $(':scope > img', d) || $(':scope > span > img', d)) : [];
    if (rows.length) {
      const template = rows[0].cloneNode(true);
      const parent = rows[0].parentElement;
      const anchor = rows[rows.length - 1].nextElementSibling;
      rows.forEach((r) => r.remove());
      items.forEach((item) => {
        const row = template.cloneNode(true);
        const img = $('img', row); if (img) { img.src = item.image; img.alt = ''; img.style.objectPosition = item.position || 'center'; }
        const q = leaf(row, /^\d+$/); if (q) q.textContent = item.quantity;
        const n = leaf(row, /Wave|Body|Ombr|Layered/); if (n) n.textContent = item.name;
        const o = leaf(row, /·/); if (o) o.textContent = item.options;
        const pr = leaf(row, /₦/); if (pr) pr.textContent = naira(item.price * item.quantity);
        parent.insertBefore(row, anchor);
      });
    }
    const value = (label) => { const l = summary && byText('span, div', label, summary); return l && l.nextElementSibling; };
    const subEl = value('Subtotal'), delEl = value('Delivery'), totEl = value('Total');
    const subtotal = cart.total();
    const { data: store } = await db.from('store_settings').select('free_delivery_over_ngn').eq('id', 1).maybeSingle();
    const freeOver = store && store.free_delivery_over_ngn != null ? store.free_delivery_over_ngn : null;
    let disc = null;
    let discLine = null;
    const refresh = () => {
      const opt = delivery.find((d) => d.code === (ship.find((r) => r.checked) || {}).value);
      let fee = opt ? opt.fee_ngn : 0;
      if (opt && opt.code === 'standard' && freeOver != null && subtotal >= freeOver) fee = 0;
      const off = disc ? disc.amount_ngn : 0;
      if (subEl) subEl.textContent = naira(subtotal);
      if (delEl) delEl.textContent = fee ? naira(fee) : 'Free';
      if (totEl) {
        if (!discLine && totEl.parentElement) {
          discLine = document.createElement('div');
          discLine.style.cssText = 'display:flex;justify-content:space-between;gap:12px;font-size:15px;color:#1E5B34';
          totEl.parentElement.insertAdjacentElement('beforebegin', discLine);
        }
        if (discLine) { discLine.hidden = !off; discLine.innerHTML = off ? `<span>Discount (${esc(disc.code)})</span><span>−${naira(off)}</span>` : ''; }
        totEl.textContent = naira(subtotal - off + fee);
      }
      if (payBtn) payBtn.textContent = items.length ? `Place order · ${naira(subtotal - off + fee)}` : 'Your bag is empty';
      syncPickup();
    };
    ship.forEach((r) => r.addEventListener('change', refresh));
    if (freeOver != null) {
      const std = ship.find((r) => r.value === 'standard');
      const fee = std && leaf(std.closest('label'), /₦|^Free$/);
      if (fee && subtotal >= freeOver) fee.textContent = 'Free';
    }
    refresh();
    let discUi = null;
    $$('button').filter((b) => text(b) === 'Apply').forEach((b) => { discUi = discountBox(b, () => subtotal, () => (f.email ? f.email.value : ''), (d) => { disc = d; refresh(); }) || discUi; });
    if (f.email) f.email.addEventListener('change', () => { if (discUi) discUi.recheck(); });

    if (!payBtn) return;
    if (!items.length) { payBtn.disabled = true; payBtn.classList.add('dh-busy'); return; }
    payBtn.addEventListener('click', async () => {
      showError(payBtn, '');
      for (const k of ['email', 'phone', 'first_name', 'last_name', 'address', 'city', 'state']) {
        if (f[k] && !f[k].checkValidity()) { f[k].reportValidity(); f[k].focus(); return; }
      }
      const customer = {
        email: f.email.value, phone: f.phone.value, first_name: f.first_name.value, last_name: f.last_name.value,
        address: f.address.value, address2: f.address2 ? f.address2.value : '', city: f.city.value, state: f.state.value,
        delivery_code: (ship.find((r) => r.checked) || {}).value,
        payment_method: (pay.find((r) => r.checked && !r.disabled) || bank).value,
        marketing_opt_in: !!(f.marketing && f.marketing.checked),
        discount_code: disc ? disc.code : null,
      };
      payBtn.classList.add('dh-busy');
      const label = payBtn.textContent;
      payBtn.textContent = 'Placing your order…';
      const { data, error } = await db.rpc('place_order', {
        customer, items: cart.get().map((i) => ({ slug: i.slug, quantity: i.quantity, options: i.options, length: i.length || null })),
      });
      payBtn.classList.remove('dh-busy');
      if (error) {
        payBtn.textContent = label;
        showError(payBtn, (error.message || 'Something went wrong.') + ' Please try again.');
        return;
      }
      try { sessionStorage.setItem('dh-last-order', JSON.stringify(data)); } catch { /* ignore */ }
      if (session && (!profile || !profile.address)) {
        await db.from('customer_profiles').upsert({
          user_id: session.user.id, first_name: customer.first_name, last_name: customer.last_name, phone: customer.phone,
          address: customer.address, address2: customer.address2 || null, city: customer.city, state: customer.state, updated_at: new Date().toISOString(),
        }).then(() => {}, () => {});
      }
      cart.set([]);
      try { sessionStorage.removeItem(DISC_KEY); } catch { /* ignore */ }
      location.href = '/order-confirmed?order=' + encodeURIComponent(data.number) + '&t=' + encodeURIComponent(data.token);
    });
  }

  /* ---------- order confirmed ---------- */
  async function initConfirmed() {
    let o = null;
    try { o = JSON.parse(sessionStorage.getItem('dh-last-order')); } catch { /* ignore */ }
    const qs = new URLSearchParams(location.search);
    const number = qs.get('order') || (o && o.number);
    const token = qs.get('t') || (o && o.token);
    if (o && number && o.number !== number) o = null;
    let live = null;
    if (db && number && token) {
      const { data } = await db.rpc('order_payment_status', { p_number: number, p_token: token });
      live = data;
    }
    if (live && o) Object.assign(o, { payment_status: live.payment_status, bank: live.bank || o.bank, pay_amount_kobo: live.pay_amount_kobo });
    if (!o && db && number) {
      const { data: row } = await db.from('orders').select('*, order_items(*), delivery_options(name)').eq('number', number).maybeSingle();
      if (row) {
        o = {
          number: row.number, token: row.access_token, first_name: row.first_name, email: row.email,
          address: [row.address, row.address2, row.city, row.state].filter(Boolean).join(', '),
          delivery: (row.delivery_options && row.delivery_options.name) || row.delivery_code, delivery_fee_ngn: row.delivery_fee_ngn,
          payment_method: row.payment_method, payment_provider: row.payment_provider, payment_status: row.payment_status,
          pay_amount_kobo: row.pay_amount_kobo, bank: live && live.bank, subtotal_ngn: row.subtotal_ngn, total_ngn: row.total_ngn,
          discount_code: row.discount_code, discount_ngn: row.discount_ngn,
          created_at: row.created_at, items: row.order_items,
        };
      }
    }
    const thanks = startsWith('span', 'Thank you');
    const h1 = $('h1');
    if (!o) {
      if (thanks) thanks.textContent = 'Thank you';
      if (h1) h1.textContent = 'No recent order on this device';
      const section = h1 && h1.closest('section');
      if (section) $$(':scope > div > :not(:first-child):not(:nth-child(2))', section).forEach((e) => { e.hidden = true; });
      const p = h1 && h1.nextElementSibling;
      if (p) p.innerHTML = 'If you placed an order, we have it. Questions? <a href="/help">Contact us</a>.';
      return;
    }
    if (thanks) thanks.textContent = `Thank you, ${o.first_name}`;
    const line = h1 && h1.nextElementSibling;
    if (line) line.innerHTML = `Order <strong style="font-weight:600">#${esc(o.number)}</strong> · We’ll confirm on WhatsApp or by email at ${esc(o.email)}`;
    const placed = leaf(document, /^\d{1,2} \w{3}, \d{2}:\d{2}$/);
    if (placed) placed.textContent = fmtDateTime(o.created_at);
    const delivering = startsWith('span', 'Delivering to');
    if (delivering) {
      const box = delivering.parentElement;
      const nm = delivering.nextElementSibling; if (nm) nm.textContent = o.first_name;
      const addr = nm && nm.nextElementSibling; if (addr) addr.innerHTML = `${esc(o.address)}<br>${esc(o.delivery)}`;
      void box;
    }
    const payment = byText('span', 'Payment');
    if (payment) {
      const t = payment.nextElementSibling;
      const pm = o.payment_method === 'pay_on_pickup' ? 'Pay on pick-up' : 'Bank transfer';
      if (t) t.textContent = pm;
      const d = t && t.nextElementSibling;
      if (d) d.innerHTML = `Total ${naira(o.total_ngn)}<br>${o.payment_method === 'pay_on_pickup' ? 'Pay when you collect your order' : 'We’ll send our bank details shortly'}`;
    }
    const itemRows = $$('div').filter((d) => d.children.length === 3 && $(':scope > span > img', d));
    if (itemRows.length) {
      const template = itemRows[0].cloneNode(true);
      const parent = itemRows[0].parentElement;
      const anchor = itemRows[itemRows.length - 1].nextElementSibling;
      itemRows.forEach((r) => r.remove());
      o.items.forEach((it) => {
        const row = template.cloneNode(true);
        const img = $('img', row); if (img) { img.src = it.image || ''; img.alt = ''; }
        const q = leaf(row, /^\d+$/); if (q) q.textContent = it.quantity;
        const spans = $$(':scope > span:nth-child(2) > span', row);
        if (spans[0]) spans[0].textContent = it.name;
        if (spans[1]) spans[1].textContent = it.options || '';
        const pr = $(':scope > span:last-child', row); if (pr) pr.textContent = naira(it.unit_price_ngn * it.quantity);
        parent.insertBefore(row, anchor);
      });
    }
    const totalPaid = byText('span', 'Total paid');
    if (totalPaid) {
      const extras = [o.delivery_fee_ngn ? `${naira(o.delivery_fee_ngn)} delivery` : '', o.discount_ngn ? `${naira(o.discount_ngn)} off with ${o.discount_code}` : ''].filter(Boolean);
      totalPaid.textContent = extras.length ? `Total (incl. ${extras.join(', ')})` : 'Total';
      if (totalPaid.nextElementSibling) totalPaid.nextElementSibling.textContent = naira(o.total_ngn);
    }
    $$('a').filter((a) => /track my order/i.test(text(a))).forEach((a) => { a.href = '/help'; a.firstChild.textContent = 'Questions about your order? '; });
    if (o.payment_provider === 'cheqpay') renderCheqpayPanel(o, number, token);
  }

  function renderCheqpayPanel(o, number, token) {
    const anchor = $('h1') && $('h1').nextElementSibling;
    if (!anchor || !o.bank) return;
    const panel = document.createElement('section');
    panel.className = 'glass-light';
    panel.setAttribute('aria-labelledby', 'pay-title');
    panel.style.cssText = 'width:100%;box-sizing:border-box;border-radius:20px;padding:28px;text-align:left;display:flex;flex-direction:column;gap:18px';
    const row = (label, value, copy) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid rgba(0,0,0,.06)">
        <span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;color:#6E6E73">${label}</span><span style="font-size:20px;font-weight:600;letter-spacing:-0.01em">${esc(value)}</span></span>
        ${copy ? `<button type="button" class="dh-copy" data-copy="${esc(copy)}" aria-label="Copy ${label.toLowerCase()}">Copy</button>` : ''}</div>`;
    const amountPlain = (Number(o.pay_amount_kobo) / 100).toFixed(2);
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div><h2 id="pay-title" style="margin:0;font-size:24px;font-weight:700;letter-spacing:-0.02em">Pay by bank transfer</h2>
        <p style="margin:6px 0 0;color:#6E6E73;font-size:15px;line-height:1.5">Send the exact amount, kobo included, so your payment is matched to order #${esc(o.number)} automatically.</p></div>
        <span style="font-size:12px;font-weight:600;color:#6E1A2C;background:#F6E3E1;border-radius:980px;padding:4px 10px">Secured by CheqPay</span>
      </div>
      <div>${row('Amount', nairaKobo(o.pay_amount_kobo), amountPlain)}${row('Account number', o.bank.account_number, o.bank.account_number)}${row('Bank', o.bank.bank_name)}${row('Account name', o.bank.account_name)}</div>
      <div data-pay-status role="status" aria-live="polite" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:#FFF7EA;font-size:15px">
        <span class="dh-pulse"></span><span>Waiting for your transfer… this page updates by itself.</span></div>`;
    anchor.insertAdjacentElement('afterend', panel);
    $$('[data-copy]', panel).forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { toast('Copy failed — please copy it manually'); }
    }));
    const statusEl = $('[data-pay-status]', panel);
    const paid = () => {
      statusEl.style.background = '#E3F1E7';
      statusEl.innerHTML = '<span class="dh-pulse done"></span><span><strong>Payment received.</strong> Thank you — we’re preparing your order.</span>';
      const pm = byText('span', 'Payment');
      const d = pm && pm.nextElementSibling && pm.nextElementSibling.nextElementSibling;
      if (d) d.innerHTML = `Paid ${nairaKobo(o.pay_amount_kobo)}<br>Confirmed by CheqPay`;
    };
    if (o.payment_status === 'paid') return paid();
    if (!number || !token) return;
    const started = Date.now();
    const poll = async () => {
      if (Date.now() - started > 45 * 60 * 1000) return;
      const { data } = await db.rpc('order_payment_status', { p_number: number, p_token: token });
      if (data && data.payment_status === 'paid') { paid(); return; }
      setTimeout(poll, document.hidden ? 15000 : 5000);
    };
    setTimeout(poll, 5000);
  }

  /* ---------- customer account ---------- */
  const F = 'width:100%;box-sizing:border-box;min-height:48px;padding:0 14px;border-radius:12px;border:1px solid rgba(0,0,0,.14);background:#FFFFFF;font:inherit;font-size:16px;color:#1D1D1F';
  const L = 'display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:500;color:#1D1D1F';
  const BTN = 'min-height:48px;padding:0 24px;border-radius:980px;border:none;background:#6E1A2C;color:#FFFFFF;font:inherit;font-size:16px;font-weight:600;cursor:pointer';
  const BTN2 = 'min-height:48px;padding:0 22px;border-radius:980px;border:1px solid rgba(0,0,0,.14);background:#FFFFFF;color:#1D1D1F;font:inherit;font-size:16px;font-weight:600;cursor:pointer';
  const CARD = 'border-radius:20px;padding:28px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px';
  const input = (name, label, type = 'text', extra = '') => `<label style="${L}">${label}<input name="${name}" type="${type}" ${extra} style="${F}"></label>`;

  function accountShell() {
    const header = $('header');
    const root = header && header.parentElement;
    const footer = root && $(':scope > footer', root);
    if (!root || !footer) return null;
    let n = header.nextElementSibling;
    while (n && n !== footer) { const next = n.nextElementSibling; n.remove(); n = next; }
    const sec = document.createElement('section');
    sec.innerHTML = `<div style="max-width: 1200px; margin: 0 auto; padding: 40px 40px 96px; display: flex; flex-direction: column; gap: 28px">
      <nav aria-label="Breadcrumb" style="display:flex;gap:10px;font-size:15px;color:#6E6E73"><a href="/" style="text-decoration:none;color:#6E6E73">Home</a><span aria-hidden="true">/</span><span aria-current="page" style="color:#1D1D1F">My account</span></nav>
      <div data-account></div></div>`;
    footer.insertAdjacentElement('beforebegin', sec);
    return $('[data-account]', sec);
  }

  async function initAccountPage() {
    const box = accountShell();
    if (!box) return;
    const { data: { session } } = await db.auth.getSession();
    if (session) renderSignedIn(box, session); else renderSignedOut(box, new URLSearchParams(location.search).get('mode') === 'create' ? 'create' : 'signin');
  }

  function renderSignedOut(box, mode) {
    const seg = (m, label) => `<button type="button" role="tab" aria-selected="${mode === m}" data-mode="${m}" style="flex:1;min-height:40px;border:none;border-radius:980px;font:inherit;font-size:15px;font-weight:600;cursor:pointer;${mode === m ? 'background:#FFFFFF;color:#1D1D1F;box-shadow:0 1px 3px rgba(0,0,0,.12)' : 'background:transparent;color:#6E6E73'}">${label}</button>`;
    box.innerHTML = `
      <div style="max-width:520px;display:flex;flex-direction:column;gap:22px">
        <div><p style="margin:0;font-size:17px;font-weight:600;color:#8A1F35">${mode === 'create' ? 'Join the family' : 'Welcome back'}</p>
        <h1 style="margin:6px 0 0;font-size:48px;line-height:1.08;font-weight:700;letter-spacing:-0.025em">${mode === 'create' ? 'Create your account' : 'Sign in'}</h1>
        <p style="margin:10px 0 0;color:#6E6E73;font-size:17px;line-height:1.5">${mode === 'create' ? 'Save your details for faster checkout and see all your orders in one place.' : 'See your orders and check out faster with your saved details.'}</p></div>
        <div role="tablist" aria-label="Account" style="display:flex;gap:4px;padding:4px;border-radius:980px;background:rgba(0,0,0,.05)">${seg('signin', 'Sign in')}${seg('create', 'Create account')}</div>
        <form class="glass-light" data-form novalidate style="${CARD}">
          ${mode === 'create' ? `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:14px">
              ${input('first_name', 'First name', 'text', 'autocomplete="given-name" required')}
              ${input('last_name', 'Last name', 'text', 'autocomplete="family-name" required')}
            </div>
            ${input('email', 'Email', 'email', 'autocomplete="email" required')}
            ${input('phone', 'Phone (WhatsApp) <span style="color:#6E6E73;font-weight:400">optional</span>', 'tel', 'autocomplete="tel" placeholder="+234 …"')}
            ${input('password', 'Password <span style="color:#6E6E73;font-weight:400">at least 8 characters</span>', 'password', 'autocomplete="new-password" minlength="8" required')}
            <label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;line-height:1.4;cursor:pointer"><input type="checkbox" name="marketing_opt_in" style="accent-color:#6E1A2C;width:18px;height:18px;margin-top:2px">Email me first looks at new wigs and family-only offers</label>
            <button type="submit" style="${BTN}">Create account</button>`
          : `
            ${input('email', 'Email', 'email', 'autocomplete="email" required')}
            ${input('password', 'Password', 'password', 'autocomplete="current-password" required')}
            <button type="submit" style="${BTN}">Sign in</button>
            <p style="margin:0;font-size:14px;color:#6E6E73">Forgot your password? <a href="/help" style="color:#6E1A2C">Message us</a> and we'll reset it for you.</p>`}
        </form>
      </div>`;
    $$('[data-mode]', box).forEach((b) => b.addEventListener('click', () => renderSignedOut(box, b.dataset.mode)));
    const savedSec = document.createElement('section');
    savedSec.id = 'saved';
    savedSec.className = 'glass-light';
    savedSec.setAttribute('aria-labelledby', 'saved-h');
    savedSec.setAttribute('style', CARD + ';margin-top:28px');
    box.appendChild(savedSec);
    renderSaved(savedSec, false).then(afterAccountRender);
    const form = $('[data-form]', box);
    const submit = $('button[type=submit]', form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError(submit, '');
      for (const el of $$('input[required]', form)) if (!el.checkValidity()) { el.reportValidity(); return; }
      const fd = Object.fromEntries(new FormData(form));
      submit.classList.add('dh-busy');
      const label = submit.textContent;
      submit.textContent = mode === 'create' ? 'Creating your account…' : 'Signing in…';
      try {
        if (mode === 'create') {
          const { error } = await db.functions.invoke('customer-signup', { body: { ...fd, marketing_opt_in: fd.marketing_opt_in === 'on' } });
          if (error) { let m = 'We couldn’t create your account. Please try again.'; try { m = (await error.context.json()).error || m; } catch { /* keep */ } throw new Error(m); }
        }
        const { data, error } = await db.auth.signInWithPassword({ email: String(fd.email).trim(), password: String(fd.password) });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message);
        const next = new URLSearchParams(location.search).get('next');
        if (next && next.startsWith('/') && !next.startsWith('//')) { location.href = next; return; }
        toast(mode === 'create' ? 'Welcome to the family' : 'Signed in');
        await wl.sync();
        renderSignedIn(box, data.session);
      } catch (err) {
        submit.classList.remove('dh-busy');
        submit.textContent = label;
        showError(submit, err.message);
      }
    });
  }

  async function renderSignedIn(box, session) {
    const uid = session.user.id;
    const [{ data: profile }, { data: orders = [] }] = await Promise.all([
      db.from('customer_profiles').select('*').eq('user_id', uid).maybeSingle(),
      db.from('orders').select('number, created_at, total_ngn, pay_amount_kobo, payment_provider, payment_status, status, access_token, order_items(name, quantity, image)').eq('user_id', uid).order('created_at', { ascending: false }).limit(50),
    ]);
    const p = profile || {};
    const first = p.first_name || (session.user.user_metadata || {}).first_name || '';
    const states = STATES.map((st) => `<option${st === p.state ? ' selected' : ''}>${st}</option>`).join('');
    const orderRow = (o) => {
      const img = o.order_items && o.order_items[0] && o.order_items[0].image;
      const count = (o.order_items || []).reduce((n, i) => n + i.quantity, 0);
      return `<a href="/order-confirmed?order=${encodeURIComponent(o.number)}&t=${encodeURIComponent(o.access_token)}" class="dh-hover" style="display:flex;gap:14px;align-items:center;padding:14px;border-radius:16px;background:rgba(255,255,255,.7);border:1px solid rgba(0,0,0,.06);text-decoration:none;color:#1D1D1F">
        ${img ? `<img src="${esc(img)}" alt="" style="width:56px;height:68px;border-radius:10px;object-fit:cover;flex:none">` : ''}
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px"><span style="font-weight:600">#${esc(o.number)} · ${naira(o.total_ngn)}</span>
        <span style="font-size:13px;color:#6E6E73">${fmtDate(o.created_at)} · ${count} item${count === 1 ? '' : 's'}</span>
        <span style="display:flex;gap:6px;flex-wrap:wrap">${pill(o.payment_status)}${pill(o.status)}</span></span>
        <span aria-hidden="true" style="color:#6E6E73">›</span></a>`;
    };
    const ico = (d) => `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const ICONS = {
      orders: '<path d="M5 8h14l-1.5 12h-11z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path>',
      saved: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path>',
      address: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle>',
      details: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"></path>',
      password: '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
      signout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"></path><path d="M10 16l-4-4 4-4"></path><path d="M6 12h10"></path>',
    };
    const tile = (key, label, href) => `<${href ? `a href="${href}"` : 'button type="button" data-signout-tile'} class="dh-seg" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 14px;border:none;border-radius:980px;background:transparent;text-decoration:none;color:#1D1D1F;font:inherit;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap">${ico(ICONS[key])}<span>${label}</span></${href ? 'a' : 'button'}>`;
    box.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <p style="margin:0;font-size:17px;font-weight:600;color:#8A1F35">My account</p>
        <h1 style="margin:0;font-size:48px;line-height:1.08;font-weight:700;letter-spacing:-0.025em">${first ? 'Hi, ' + esc(first) : 'Welcome'}</h1>
        <p style="margin:4px 0 0;color:#6E6E73;font-size:16px;overflow-wrap:anywhere">${esc(session.user.email)}</p>
      </div>
      <nav aria-label="Account sections" class="dh-icon-row" style="display:flex;gap:4px;padding:5px;border-radius:980px;background:rgba(0,0,0,.05);max-width:760px">
        ${tile('orders', 'Orders', '#account-orders')}${tile('saved', 'Wishlist', '#saved')}${tile('address', 'Address', '#account-address')}${tile('details', 'Details', '#account-details')}${tile('signout', 'Sign out')}
      </nav>
        <section id="account-orders" class="glass-light" aria-labelledby="orders-h" style="${CARD}">
          <h2 id="orders-h" style="margin:0;font-size:26px;font-weight:600;letter-spacing:-0.015em">Your orders</h2>
          ${orders.length ? orders.map(orderRow).join('') : `<p style="margin:0;color:#6E6E73;font-size:16px;line-height:1.5">No orders yet. Orders you place while signed in show up here.</p>
            <a href="/shop" style="align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;padding:0 22px;border-radius:980px;background:#6E1A2C;color:#FFFFFF;text-decoration:none;font-weight:600">Shop wigs</a>`}
        </section>
      <section id="saved" class="glass-light" aria-labelledby="saved-h" style="${CARD}"></section>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:24px;align-items:start">
          <form id="account-address" class="glass-light" data-profile aria-labelledby="addr-h" style="${CARD}">
            <h2 id="addr-h" style="margin:0;font-size:26px;font-weight:600;letter-spacing:-0.015em">Delivery address</h2>
            <p style="margin:-6px 0 0;color:#6E6E73;font-size:15px">${p.address ? 'Where we send your orders. Checkout fills this in for you.' : 'No address yet. Add one and checkout fills it in for you.'}</p>
            ${input('address', 'Street address', 'text', `autocomplete="address-line1" value="${esc(p.address || '')}"`)}
            ${input('address2', 'Apartment, suite (optional)', 'text', `autocomplete="address-line2" value="${esc(p.address2 || '')}"`)}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:14px">
              ${input('city', 'City', 'text', `autocomplete="address-level2" value="${esc(p.city || '')}"`)}
              <label style="${L}">State<select name="state" autocomplete="address-level1" style="${F}"><option value="">Select state</option>${states}</select></label>
            </div>
            <button type="submit" style="${BTN}">Save address</button>
          </form>
          <div style="display:flex;flex-direction:column;gap:24px">
          <form id="account-details" class="glass-light" data-profile aria-labelledby="details-h" style="${CARD}">
            <h2 id="details-h" style="margin:0;font-size:26px;font-weight:600;letter-spacing:-0.015em">Your details</h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:14px">
              ${input('first_name', 'First name', 'text', `autocomplete="given-name" required value="${esc(p.first_name || '')}"`)}
              ${input('last_name', 'Last name', 'text', `autocomplete="family-name" required value="${esc(p.last_name || '')}"`)}
            </div>
            ${input('phone', 'Phone (WhatsApp)', 'tel', `autocomplete="tel" value="${esc(p.phone || '')}"`)}
            <label style="display:flex;gap:10px;align-items:center;font-size:15px;cursor:pointer"><input type="checkbox" name="marketing_opt_in" ${p.marketing_opt_in ? 'checked' : ''} style="accent-color:#6E1A2C;width:18px;height:18px">Email me first looks and offers</label>
            <button type="submit" style="${BTN}">Save details</button>
          </form>
          <form id="account-password" class="glass-light" data-password aria-labelledby="pw-h" style="${CARD}">
            <h2 id="pw-h" style="margin:0;font-size:26px;font-weight:600;letter-spacing:-0.015em">Password</h2>
            ${input('password', 'New password <span style="color:#6E6E73;font-weight:400">at least 8 characters</span>', 'password', 'autocomplete="new-password" minlength="8" required')}
            <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="submit" style="${BTN2}">Change password</button><button type="button" data-signout style="${BTN2}">Sign out</button></div>
          </form>
          </div>
      </div>`;
    const forms = $$('[data-profile]', box);
    const val = (n) => { const el = $(`[name="${n}"]`, box); return el ? el.value.trim() : ''; };
    forms.forEach((pf) => pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', pf);
      showError(btn, '');
      for (const el of forms.flatMap((f) => $$('input[required]', f))) if (!el.checkValidity()) { el.reportValidity(); return; }
      const row = {
        user_id: uid, first_name: val('first_name'), last_name: val('last_name'), phone: val('phone') || null,
        address: val('address') || null, address2: val('address2') || null, city: val('city') || null, state: val('state') || null,
        marketing_opt_in: !!$('[name="marketing_opt_in"]', box).checked, updated_at: new Date().toISOString(),
      };
      btn.classList.add('dh-busy');
      const { error } = await db.from('customer_profiles').upsert(row);
      btn.classList.remove('dh-busy');
      if (error) { showError(btn, 'Couldn’t save. Please try again.'); return; }
      toast(pf.id === 'account-address' ? 'Your delivery address is saved' : 'Your details are saved');
      const h = $('h1', box); if (h) h.textContent = 'Hi, ' + row.first_name;
    }));
    const pw = $('[data-password]', box);
    pw.addEventListener('submit', async (e) => {
      e.preventDefault();
      const field = $('input[name=password]', pw);
      const btn = $('button[type=submit]', pw);
      showError(btn.parentElement, '');
      if (!field.checkValidity()) { field.reportValidity(); return; }
      const { error } = await db.auth.updateUser({ password: field.value });
      if (error) { showError(btn.parentElement, error.message); return; }
      field.value = '';
      toast('Password changed');
    });
    const signOut = async () => { await db.auth.signOut(); wl.uid = null; toast('Signed out'); renderSignedOut(box, 'signin'); };
    $('[data-signout]', box).addEventListener('click', signOut);
    $('[data-signout-tile]', box).addEventListener('click', signOut);
    await renderSaved($('#saved', box), true);
    afterAccountRender();
  }

  async function renderSaved(sec, signedIn) {
    if (!sec) return;
    const products = await loadProducts();
    const draw = () => {
      const saved = products.filter((x) => wl.has(x.slug));
      if (!signedIn && !saved.length) { sec.hidden = true; return; }
      sec.hidden = false;
      sec.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">
          <h2 id="saved-h" style="margin:0;font-size:26px;font-weight:600;letter-spacing:-0.015em">Wishlist</h2>
          <span style="color:#6E6E73;font-size:15px">${saved.length} ${saved.length === 1 ? 'item' : 'items'}</span></div>
        ${signedIn ? '' : '<p style="margin:-6px 0 0;color:#6E6E73;font-size:15px">Saved on this device. Sign in or create an account to keep them everywhere.</p>'}
        ${saved.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:16px">${saved.map((x) => `
          <article class="lift" style="position:relative;display:flex;flex-direction:column;gap:12px">
            <a href="${productUrl(x)}" class="zoom" style="display:block;aspect-ratio:3/4;border-radius:14px;overflow:hidden;border:1px solid rgba(0,0,0,.08)"><img src="${esc(x.image)}" alt="${esc(x.name)}" style="display:block;width:100%;height:100%;object-fit:cover;object-position:${esc(x.image_position || 'center')}"></a>
            <button type="button" class="glass-chip-light" data-wish="${esc(x.slug)}" data-name="${esc(x.name)}" style="position:absolute;top:10px;right:10px;width:44px;height:44px;border-radius:980px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"></path></svg></button>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
              <a href="${productUrl(x)}" style="font-size:19px;font-weight:600;letter-spacing:-0.012em;text-decoration:none;color:#1D1D1F">${esc(x.name)}</a>
              <span style="font-size:17px;color:#8A1F35;white-space:nowrap">${naira(x.price_ngn)}</span></div>
            <button type="button" data-addsaved="${esc(x.slug)}" ${x.stock <= 0 ? 'disabled' : ''} class="press" style="min-height:50px;border-radius:980px;background:transparent;color:#1D1D1F;border:1px solid rgba(0,0,0,.16);font:inherit;font-size:15px;font-weight:600;cursor:pointer">${x.stock <= 0 ? 'Sold out' : 'Add to bag'}</button>
          </article>`).join('')}</div>`
        : '<p style="margin:0;color:#6E6E73;font-size:16px;line-height:1.5">Your wishlist is empty. Tap the heart on any wig to add it here.</p><a href="/shop" style="align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;padding:0 22px;border-radius:980px;background:#6E1A2C;color:#FFFFFF;text-decoration:none;font-weight:600">Browse wigs</a>'}`;
      $$('[data-addsaved]', sec).forEach((b) => b.addEventListener('click', () => {
        const x = products.find((y) => y.slug === b.dataset.addsaved);
        if (x) { cart.add(x, defaultOptions(x)); toast(`${x.name} added to your bag`); }
      }));
      paintWish();
    };
    draw();
    if (!sec._listening) { document.addEventListener('dh-wishlist-changed', draw); sec._listening = true; }
  }

  function afterAccountRender() {
    if (location.hash) {
      const t = document.getElementById(location.hash.slice(1));
      if (t && !t.hidden) setTimeout(() => t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 60);
    }
  }

  /* ---------- newsletter + contact ---------- */
  function initForms() {
    $$('form').forEach((form) => {
      form.removeAttribute('onsubmit');
      form.onsubmit = null;
    });
    const join = $$('button').find((b) => /join the family/i.test(text(b)));
    if (join) {
      const form = join.closest('form');
      const email = $('input[type="email"]', form);
      const submit = async (e) => {
        e && e.preventDefault();
        showError(join, '');
        if (!email.checkValidity() || !email.value) { email.required = true; email.reportValidity(); return; }
        join.classList.add('dh-busy');
        const { error } = await db.from('subscribers').insert({ email: email.value.trim().toLowerCase() });
        join.classList.remove('dh-busy');
        if (error && error.code !== '23505') { showError(join, 'We couldn’t add you just now. Please try again.'); return; }
        form.reset();
        toast('Welcome to the family. Look out for our first email.');
      };
      join.addEventListener('click', submit);
      form.addEventListener('submit', submit);
    }
    const send = $$('button').find((b) => /send message/i.test(text(b)));
    if (send) {
      const form = send.closest('form');
      const name = $('input[type="text"]', form);
      const email = $('input[type="email"]', form);
      const order = $('input[placeholder^="#DHL"]', form);
      const body = $('textarea', form);
      [email, body].forEach((x) => { if (x) x.required = true; });
      const submit = async (e) => {
        e && e.preventDefault();
        showError(send, '');
        for (const x of [email, body]) if (x && !x.checkValidity()) { x.reportValidity(); return; }
        send.classList.add('dh-busy');
        const { error } = await db.from('messages').insert({
          name: name ? name.value.trim() : null, email: email.value.trim(), topic: order && order.value ? 'Order ' + order.value.trim() : null, body: body.value.trim(),
        });
        send.classList.remove('dh-busy');
        if (error) { showError(send, 'Your message didn’t send. Please try again or message us on WhatsApp.'); return; }
        form.reset();
        toast('Thank you. We’ll reply soon.');
      };
      send.addEventListener('click', submit);
      form.addEventListener('submit', submit);
    }
  }

  /* ======================= ADMIN ======================= */
  const PILL = {
    unfulfilled: ['Unfulfilled', '#EFEFF1', '#3A3A3C'], processing: ['Processing', '#FBEBD9', '#8A4B0F'],
    shipped: ['Shipped', '#E3ECF8', '#1F4A7A'], delivered: ['Delivered', '#E3F1E7', '#1E5B34'], cancelled: ['Cancelled', '#FBE3E6', '#8A1F35'],
    paid: ['Paid', '#E3F1E7', '#1E5B34'], unpaid: ['Awaiting payment', '#FBEBD9', '#8A4B0F'], refunded: ['Refunded', '#FBE3E6', '#8A1F35'],
    active: ['Active', '#E3F1E7', '#1E5B34'], draft: ['Draft', '#EFEFF1', '#3A3A3C'], out: ['Out of stock', '#FBE3E6', '#8A1F35'],
  };
  const pill = (key) => {
    const [label, bg, fg] = PILL[key] || [key, '#EFEFF1', '#3A3A3C'];
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:980px;background:${bg};color:${fg};font-size:12px;font-weight:500;white-space:nowrap"><span aria-hidden="true" style="width:6px;height:6px;border-radius:980px;background:${fg}"></span>${label}</span>`;
  };
  const initials = (a, b) => ((a || '?')[0] + ((b || '')[0] || '')).toUpperCase();
  const avatar = (o) => `<span aria-hidden="true" style="flex:none;width:30px;height:30px;border-radius:980px;background:#F6E3E1;color:#6E1A2C;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600">${esc(initials(o.first_name, o.last_name))}</span>`;
  const wa = (phone) => 'https://wa.me/' + String(phone || '').replace(/\D/g, '').replace(/^0/, '234');

  function fillTable(table, rowsCells, emptyText) {
    const tbody = table.tBodies[0];
    const tmpl = tbody.rows[1] || tbody.rows[0];
    const styles = tmpl ? Array.from(tmpl.cells).map((c) => c.getAttribute('style') || '') : [];
    const cls = tmpl ? tmpl.className : '';
    const cols = table.tHead ? table.tHead.rows[0].cells.length : styles.length;
    if (!rowsCells.length) {
      tbody.innerHTML = `<tr><td colspan="${cols}" style="padding:36px 10px;text-align:center;color:#6E6E73">${emptyText}</td></tr>`;
      return [];
    }
    tbody.innerHTML = rowsCells.map((cells) => `<tr class="${cls}">${cells.map((c, i) => `<td style="${styles[i] || styles[styles.length - 1] || ''}">${c}</td>`).join('')}</tr>`).join('');
    return Array.from(tbody.rows);
  }

  function hideDemoBits() {
    $$('span, div').filter((e) => text(e) === 'Demo data' && !e.children.length).forEach((e) => { e.hidden = true; });
  }

  async function requireStaff() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) { location.replace('/admin/login?next=' + encodeURIComponent(location.pathname)); return null; }
    const { data: staff } = await db.from('staff').select('role, access, status, full_name, email').eq('user_id', session.user.id).maybeSingle();
    if (!staff || staff.status !== 'active') {
      await db.auth.signOut();
      location.replace('/admin/login?denied=1');
      return null;
    }
    ME = staff;
    db.rpc('touch_staff').then(() => {}, () => {});
    return { session, staff };
  }

  function initAdminChrome(user) {
    const aside = $('aside');
    if (aside && !$('.admin-menu-toggle')) {
      const h1 = $('main h1');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-menu-toggle';
      btn.setAttribute('aria-label', 'Open menu');
      btn.innerHTML = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>';
      const block = h1 && h1.parentElement;
      if (block && block.parentElement) block.parentElement.insertBefore(btn, block);
      btn.addEventListener('click', (e) => { e.stopPropagation(); document.body.classList.toggle('admin-menu-open'); });
      document.addEventListener('click', (e) => { if (document.body.classList.contains('admin-menu-open') && !aside.contains(e.target)) document.body.classList.remove('admin-menu-open'); });
    }
    let signOut = $$('a, button').find((a) => /sign out/i.test(text(a)));
    if (!signOut && aside) {
      const owner = $$('span, div', aside).find((e) => !e.children.length && /^(Owner|Manager|Staff)$/.test(text(e)));
      const cardEl = owner ? owner.closest('div:has(> span), a, div') : null;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:16px;padding:4px 6px 0;font-size:13px';
      signOut = document.createElement('button');
      signOut.type = 'button';
      signOut.textContent = 'Sign out';
      signOut.style.cssText = 'background:none;border:none;padding:6px 0;color:inherit;opacity:.8;font:inherit;font-size:13px;cursor:pointer;min-height:32px';
      row.appendChild(signOut);
      let host = cardEl;
      while (host && host.parentElement !== aside) host = host.parentElement;
      if (host) host.insertAdjacentElement('afterend', row); else aside.appendChild(row);
    }
    if (signOut) {
      signOut.addEventListener('click', async (e) => { e.preventDefault(); await db.auth.signOut(); location.href = '/admin/login'; });
      if (!$('.dh-change-pass')) {
        const cp = document.createElement('button');
        cp.type = 'button';
        cp.className = 'dh-change-pass';
        cp.textContent = 'Change password';
        cp.style.cssText = 'background:none;border:none;padding:6px 0;color:inherit;opacity:.8;font:inherit;font-size:13px;cursor:pointer;text-align:left;min-height:32px';
        cp.addEventListener('click', async () => {
          const pw = prompt('New password (at least 10 characters):');
          if (!pw) return;
          if (pw.length < 10) { alert('Please use at least 10 characters.'); return; }
          const { error } = await db.auth.updateUser({ password: pw });
          toast(error ? 'Couldn’t change it: ' + error.message : 'Password changed');
        });
        signOut.insertAdjacentElement('afterend', cp);
      }
    }
    const who = user && (user.staff.full_name || (user.session.user.email || '').split('@')[0]);
    if (who) {
      const nameEl = leaf(aside || document, /^Loveth( Okafor)?$/);
      if (nameEl) {
        nameEl.textContent = who;
        const roleEl = nameEl.nextElementSibling && !nameEl.nextElementSibling.children.length ? nameEl.nextElementSibling : leaf(nameEl.parentElement, /^(Owner|Manager|Staff)$/);
        if (roleEl) roleEl.textContent = ROLE_NAMES[user.staff.access] || 'Staff';
        const av = nameEl.closest('div') && nameEl.closest('div').parentElement && $$('span, div', nameEl.closest('div').parentElement).find((e) => !e.children.length && /^[A-Z]{1,2}$/.test(text(e)));
        if (av) av.textContent = initials(who.split(' ')[0], who.split(' ')[1] || '');
      }
    }
    $$('aside a[href^="/admin"]').forEach((a) => {
      const area = NAV_AREA[a.getAttribute('href')];
      if (area && !canDo(area, false)) a.hidden = true;
    });
    $$('a[href="/admin/product-edit"]').forEach((a) => { if (!canDo('products')) a.hidden = true; });
    const pageArea = PAGE_AREA[page];
    if (pageArea && !canDo(pageArea, false)) {
      const body = adminBody() || $('main > div:last-child');
      if (body) body.innerHTML = noAccess();
      document.body.dataset.denied = '1';
    }
    initInstallPrompt();
    const greet = byText('span, p', 'Good morning');
    if (greet) { const h = new Date().getHours(); greet.textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
    hideDemoBits();
  }

  async function loadOrders(limit = 500) {
    const { data, error } = await db.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(limit);
    if (error) { toast('Couldn’t load orders: ' + error.message); return []; }
    return data || [];
  }

  function setUnfulfilledBadge(orders) {
    const n = orders.filter((o) => o.status === 'unfulfilled' || o.status === 'processing').length;
    const link = $$('aside a').find((a) => text(a).startsWith('Orders'));
    const b = link && $$('span', link).find((s) => /^\d+$/.test(text(s)));
    if (b) { b.textContent = n; b.hidden = !n; }
  }

  /* --- login --- */
  function initAdminLogin() {
    const btn = $$('button').find((b) => text(b) === 'Sign in');
    const email = $('input[type="email"]');
    const pass = $('input[type="password"]');
    if (!btn || !email || !pass) return;
    email.autocomplete = 'username'; pass.autocomplete = 'current-password'; email.required = pass.required = true;
    const note = leaf(document, /2-step verification/);
    if (note) note.parentElement.hidden = true;
    const forgot = byText('a', 'Forgot password?');
    if (forgot) forgot.addEventListener('click', (e) => { e.preventDefault(); toast('Ask the store owner to reset your password'); });
    const show = $('button[aria-label="Show password"]');
    if (show) show.addEventListener('click', () => { pass.type = pass.type === 'password' ? 'text' : 'password'; show.setAttribute('aria-label', pass.type === 'password' ? 'Show password' : 'Hide password'); });
    const params = new URLSearchParams(location.search);
    if (params.get('denied')) showError(btn, 'That account isn’t on the staff list.');
    db.auth.getSession().then(({ data: { session } }) => { if (session) location.replace(params.get('next') || '/admin'); });
    const submit = async (e) => {
      e && e.preventDefault();
      showError(btn, '');
      if (!email.checkValidity() || !pass.value) { (email.checkValidity() ? pass : email).reportValidity(); return; }
      btn.classList.add('dh-busy');
      btn.textContent = 'Signing in…';
      const { error } = await db.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      btn.classList.remove('dh-busy');
      btn.textContent = 'Sign in';
      if (error) { showError(btn, error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message); return; }
      const next = params.get('next');
      location.href = next && next.startsWith('/admin') ? next : '/admin';
    };
    stripClick(btn);
    btn.addEventListener('click', submit);
    const form = btn.closest('form');
    if (form) { form.removeAttribute('onsubmit'); form.onsubmit = null; form.addEventListener('submit', submit); }
    [email, pass].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(e); }));
  }

  /* --- orders --- */
  async function initAdminOrders() {
    const table = $('main table');
    const panel = $('main aside');
    let orders = await loadOrders();
    setUnfulfilledBadge(orders);
    let filter = 'all';
    let selected = orders[0] && orders[0].id;
    const tabs = $$('button[aria-pressed]').filter((b) => /^(All|Unfulfilled|Processing|Shipped|Delivered)/.test(text(b)));
    const search = $('input[placeholder^="Search by order"]');
    const paySel = $$('select').find((s) => /Any payment/.test(text(s)));
    if (paySel) paySel.innerHTML = '<option value="">Any payment</option><option value="paid">Paid</option><option value="unpaid">Awaiting payment</option><option value="refunded">Refunded</option>';
    const tabOn = tabs.find((t) => t.getAttribute('aria-pressed') === 'true');
    const tabOff = tabs.find((t) => t.getAttribute('aria-pressed') === 'false');
    const onStyle = tabOn && tabOn.getAttribute('style');
    const offStyle = tabOff && tabOff.getAttribute('style');
    tabs.forEach((t) => {
      const key = text(t).replace(/\d+/g, '').trim().toLowerCase();
      t.dataset.key = key;
      t.addEventListener('click', () => { filter = key; render(); });
    });

    function visible() {
      const q = (search && search.value || '').trim().toLowerCase();
      const ps = paySel && paySel.value;
      return orders.filter((o) => (filter === 'all' || o.status === filter)
        && (!ps || o.payment_status === ps)
        && (!q || [o.number, o.first_name, o.last_name, o.phone, o.email].join(' ').toLowerCase().includes(q)));
    }

    function render() {
      tabs.forEach((t) => {
        const key = t.dataset.key;
        const n = key === 'all' ? orders.length : orders.filter((o) => o.status === key).length;
        const c = $$('span', t).find((s) => /^\d+$/.test(text(s)));
        if (c) c.textContent = n;
        const on = key === filter;
        t.setAttribute('aria-pressed', String(on));
        if (onStyle && offStyle) t.setAttribute('style', on ? onStyle : offStyle);
      });
      const list = visible();
      const trs = fillTable(table, list.map((o) => [
        `<input type="checkbox" aria-label="Select #${esc(o.number)}" style="accent-color:#6E1A2C;width:16px;height:16px">`,
        `<a href="#${esc(o.number)}" data-id="${o.id}" style="text-decoration:none;font-weight:600">#${esc(o.number)}</a>`,
        fmtDate(o.created_at),
        `<span style="display:flex;align-items:center;gap:10px;white-space:nowrap">${avatar(o)}<span style="display:flex;flex-direction:column;gap:1px">${esc(o.first_name + ' ' + o.last_name)}<span style="font-size:12px;color:#6E6E73">${o.order_items.reduce((n, i) => n + i.quantity, 0)} item(s)</span></span></span>`,
        naira(o.total_ngn), pill(o.payment_status), pill(o.status),
      ]), orders.length ? 'No orders match these filters.' : 'No orders yet. Place a test order from the shop and it will appear here.');
      trs.forEach((tr, i) => {
        const o = list[i];
        tr.style.cursor = 'pointer';
        if (o.id === selected) $$('td', tr).forEach((td) => { td.style.background = '#FBF1EF'; });
        tr.addEventListener('click', (e) => { if (e.target.type === 'checkbox') return; e.preventDefault(); selected = o.id; render(); if (panel && matchMedia('(max-width: 960px)').matches) panel.scrollIntoView({ behavior: 'smooth' }); });
      });
      renderPanel(orders.find((o) => o.id === selected));
      const pager = leaf(document, /^Showing/);
      if (pager) pager.textContent = `Showing ${list.length} of ${orders.length}`;
    }

    function renderPanel(o) {
      if (!panel) return;
      panel.hidden = false;
      if (!o) { panel.innerHTML = '<div style="padding:28px;color:#6E6E73">Select an order to see its details.</div>'; return; }
      const items = o.order_items.map((i) => `<li style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)">
          ${i.image ? `<img src="${esc(i.image)}" alt="" style="width:44px;height:56px;object-fit:cover;border-radius:8px">` : ''}
          <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-weight:600">${esc(i.name)}</span><span style="font-size:13px;color:#6E6E73">${esc(i.options || '')} · Qty ${i.quantity}</span></span>
          <span>${naira(i.unit_price_ngn * i.quantity)}</span></li>`).join('');
      const opt = (val, list) => list.map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('');
      const sel = 'min-height:44px;padding:0 12px;border-radius:12px;border:1px solid rgba(0,0,0,.12);background:#FFFFFF;font:inherit;font-size:15px;color:#1D1D1F';
      panel.innerHTML = `
        <div style="padding:24px;display:flex;flex-direction:column;gap:18px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
            <div><div style="font-size:24px;font-weight:700;letter-spacing:-0.02em">#${esc(o.number)}</div>
            <div style="font-size:13px;color:#6E6E73">${fmtDateTime(o.created_at)}</div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${pill(o.payment_status)}${pill(o.status)}</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#6E6E73">Fulfilment
              <select data-f="status" style="${sel}">${opt(o.status, [['unfulfilled', 'Unfulfilled'], ['processing', 'Processing'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']])}</select></label>
            <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#6E6E73">Payment
              <select data-f="payment_status" style="${sel}">${opt(o.payment_status, [['unpaid', 'Awaiting payment'], ['paid', 'Paid'], ['refunded', 'Refunded']])}</select></label>
          </div>
          <button type="button" data-save style="min-height:44px;border-radius:980px;border:none;background:#6E1A2C;color:#FFFFFF;font:inherit;font-weight:600;cursor:pointer">Save changes</button>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="font-size:13px;font-weight:600;color:#6E6E73">Customer</div>
            <div style="font-weight:600">${esc(o.first_name + ' ' + o.last_name)}</div>
            <a href="mailto:${esc(o.email)}" style="color:#6E1A2C">${esc(o.email)}</a>
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><a href="tel:${esc(o.phone)}" style="color:#6E1A2C">${esc(o.phone)}</a>
            <a href="${wa(o.phone)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;min-height:32px;padding:0 12px;border-radius:980px;background:#E3F1E7;color:#1E5B34;text-decoration:none;font-size:13px;font-weight:600">WhatsApp</a></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="font-size:13px;font-weight:600;color:#6E6E73">Delivery · ${esc(o.delivery_code)}</div>
            <div>${esc([o.address, o.address2, o.city, o.state].filter(Boolean).join(', '))}</div>
            <div style="font-size:13px;color:#6E6E73">Payment method: ${o.payment_method === 'pay_on_pickup' ? 'Pay on pick-up' : o.payment_provider === 'cheqpay' ? 'Bank transfer via CheqPay' : 'Bank transfer (manual)'}${o.marketing_opt_in ? ' · Subscribed to emails' : ''}</div>
            ${o.payment_provider === 'cheqpay' ? `<div style="font-size:13px;color:#6E6E73">Expected transfer: <strong style="color:#1D1D1F">${nairaKobo(o.pay_amount_kobo)}</strong>${o.paid_at ? ` · paid ${fmtDateTime(o.paid_at)}` : ''}${o.payer && o.payer.name ? ` · from ${esc(o.payer.name)}${o.payer.bank_name ? ' (' + esc(o.payer.bank_name) + ')' : ''}` : ''}${o.payment_ref ? ` · ref ${esc(o.payment_ref)}` : ''}</div>` : ''}
          </div>
          <ul style="list-style:none;margin:0;padding:0">${items}</ul>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:15px">
            <div style="display:flex;justify-content:space-between"><span style="color:#6E6E73">Subtotal</span><span>${naira(o.subtotal_ngn)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#6E6E73">Delivery</span><span>${o.delivery_fee_ngn ? naira(o.delivery_fee_ngn) : 'Free'}</span></div>
            <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:700"><span>Total</span><span>${naira(o.total_ngn)}</span></div>
          </div>
        </div>`;
      const save = $('[data-save]', panel);
      save.addEventListener('click', async () => {
        const patch = { status: $('[data-f="status"]', panel).value, payment_status: $('[data-f="payment_status"]', panel).value };
        save.classList.add('dh-busy');
        const { error } = await db.from('orders').update(patch).eq('id', o.id);
        save.classList.remove('dh-busy');
        if (error) { toast('Couldn’t save: ' + error.message); return; }
        Object.assign(o, patch);
        setUnfulfilledBadge(orders);
        toast(`Order #${o.number} updated`);
        render();
      });
    }

    if (search) search.addEventListener('input', render);
    if (paySel) paySel.addEventListener('change', render);
    const exp = $$('button').find((b) => text(b) === 'Export');
    if (exp) exp.addEventListener('click', () => {
      const head = ['Order', 'Date', 'First name', 'Last name', 'Email', 'Phone', 'Address', 'City', 'State', 'Delivery', 'Payment', 'Payment status', 'Status', 'Total'];
      const rows = visible().map((o) => [o.number, o.created_at, o.first_name, o.last_name, o.email, o.phone, [o.address, o.address2].filter(Boolean).join(', '), o.city, o.state, o.delivery_code, o.payment_method, o.payment_status, o.status, o.total_ngn]);
      const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'dream-hair-orders.csv';
      a.click();
    });
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash) { const o = orders.find((x) => x.number === hash || '#' + x.number === hash); if (o) selected = o.id; }
    render();
  }

  /* --- dashboard --- */
  async function initAdminDashboard() {
    const [orders, { data: products = [] }] = await Promise.all([loadOrders(), db.from('products').select('*').order('sort')]);
    setUnfulfilledBadge(orders);
    const since = Date.now() - 30 * 864e5;
    const recent = orders.filter((o) => new Date(o.created_at).getTime() >= since && o.status !== 'cancelled');
    const counted = recent.filter((o) => o.payment_status !== 'refunded');
    const revenue = counted.reduce((n, o) => n + o.total_ngn, 0);
    const firstSeen = {};
    orders.slice().reverse().forEach((o) => { if (!firstSeen[o.email]) firstSeen[o.email] = new Date(o.created_at).getTime(); });
    const newCustomers = Object.values(firstSeen).filter((t) => t >= since).length;
    const kpi = { Revenue: short(revenue), Orders: String(recent.length), 'Average order': counted.length ? short(revenue / counted.length) : '₦0', 'New customers': String(newCustomers) };
    Object.entries(kpi).forEach(([label, v]) => {
      const l = $$('span, div, p').find((e) => !e.children.length && text(e) === label && !e.closest('table, h2'));
      if (!l) return;
      const num = l.nextElementSibling;
      if (num) num.textContent = v;
      let card = l.parentElement;
      while (card && !/vs previous/.test(card.textContent) && card !== document.body) card = card.parentElement;
      if (!card || card === document.body) return;
      $$('svg', card).forEach((s) => { s.style.display = 'none'; });
      $$('span, div, p').filter((e) => card.contains(e) && !e.children.length && /^[+−-]\s?[\d.]+%?$/.test(text(e))).forEach((e) => { e.hidden = true; });
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (/vs previous 30 days/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace('vs previous 30 days', 'Last 30 days');
      }
    });

    const kpiLabel = $$('span, div, p').find((e) => !e.children.length && text(e) === 'New customers' && !e.closest('table, h2'));
    let kpiGrid = kpiLabel;
    while (kpiGrid && kpiGrid.parentElement && getComputedStyle(kpiGrid.parentElement).display !== 'grid') kpiGrid = kpiGrid.parentElement;
    if (kpiGrid && kpiGrid.parentElement) kpiGrid.parentElement.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    if (canDo('settings', false)) {
      await renderPaymentsCard();
      await renderAlertsCard();
    }

    // revenue chart: one bar per day, last 30 days
    const revH = $$('h2').find((h) => text(h) === 'Revenue');
    if (revH) {
      const card = revH.closest('.glass-light');
      const sub = revH.nextElementSibling;
      if (sub) sub.textContent = `Last 30 days · ${naira(revenue)} total`;
      const days = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 864e5); return d.toISOString().slice(0, 10); });
      const byDay = Object.fromEntries(days.map((d) => [d, 0]));
      counted.forEach((o) => { const d = o.created_at.slice(0, 10); if (d in byDay) byDay[d] += o.total_ngn; });
      const max = Math.max(1, ...Object.values(byDay));
      const chart = document.createElement('div');
      chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', `Daily revenue for the last 30 days, ${naira(revenue)} in total`);
      chart.style.cssText = 'display:flex;align-items:flex-end;gap:4px;height:220px;padding-top:16px';
      chart.innerHTML = days.map((d) => `<div title="${fmtDate(d)}: ${naira(byDay[d])}" style="flex:1;min-width:3px;height:${Math.max(2, (byDay[d] / max) * 100)}%;border-radius:4px 4px 2px 2px;background:${byDay[d] ? '#6E1A2C' : 'rgba(0,0,0,.08)'}"></div>`).join('');
      const old = $$('svg', card).filter((s) => s.getBoundingClientRect().width > 200)[0];
      let holder = old;
      while (holder && holder.parentElement !== card && !holder.parentElement.contains(revH)) holder = holder.parentElement;
      if (holder && !holder.contains(revH)) holder.replaceWith(chart);
      else card.appendChild(chart);
      const axis = document.createElement('div');
      axis.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;color:#6E6E73;padding-top:8px';
      axis.innerHTML = `<span>${fmtDate(days[0])}</span><span>Today</span>`;
      chart.insertAdjacentElement('afterend', axis);
    }

    // top products
    const topH = $$('h2').find((h) => text(h) === 'Top products');
    if (topH) {
      const card = topH.closest('.glass-light');
      const head = topH.parentElement;
      $$(':scope > *', card).filter((e) => e !== head).forEach((e) => e.remove());
      const viewAll = $('a', head); if (viewAll) viewAll.href = '/admin/products';
      const sales = {};
      counted.forEach((o) => o.order_items.forEach((i) => { const s = sales[i.name] || (sales[i.name] = { name: i.name, image: i.image, qty: 0, total: 0 }); s.qty += i.quantity; s.total += i.unit_price_ngn * i.quantity; }));
      const list = Object.values(sales).sort((a, b) => b.total - a.total).slice(0, 5);
      const max = Math.max(1, ...list.map((s) => s.total));
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:16px;padding-top:16px';
      box.innerHTML = list.length ? list.map((s) => `<div style="display:flex;gap:14px;align-items:center">
          ${s.image ? `<img src="${esc(s.image)}" alt="" style="width:52px;height:52px;border-radius:12px;object-fit:cover">` : ''}
          <div style="flex:1;display:flex;flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between;gap:8px;font-weight:600"><span>${esc(s.name)}</span><span>${short(s.total)}</span></div>
          <div style="height:6px;border-radius:980px;background:#F6E3E1"><div style="height:100%;width:${(s.total / max) * 100}%;border-radius:980px;background:#6E1A2C"></div></div>
          <span style="font-size:13px;color:#6E6E73">${s.qty} sold</span></div></div>`).join('')
        : '<p style="margin:0;color:#6E6E73">Sales will show here after your first order.</p>';
      card.appendChild(box);
    }

    // recent orders
    const recentH = $$('h2').find((h) => text(h) === 'Recent orders');
    const table = recentH && recentH.closest('.glass-light').querySelector('table');
    if (table) {
      const trs = fillTable(table, orders.slice(0, 6).map((o) => [
        `<a href="/admin/orders#${esc(o.number)}" style="text-decoration:none;font-weight:600">#${esc(o.number)}</a>`,
        `<span style="display:flex;align-items:center;gap:10px;white-space:nowrap">${avatar(o)}${esc(o.first_name + ' ' + o.last_name)}</span>`,
        fmtDate(o.created_at), naira(o.total_ngn), pill(o.payment_status), pill(o.status),
      ]), 'No orders yet. Your first order will appear here.');
      trs.forEach((tr, i) => { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => { location.href = '/admin/orders#' + orders[i].number; }); });
      const all = $('a[href="/admin/orders"]', recentH.closest('.glass-light'));
      if (all) all.href = '/admin/orders';
    }

    // low stock
    const lowH = $$('h2, span, div').find((h) => !h.children.length && text(h) === 'Low stock');
    if (lowH) {
      const card = lowH.closest('.glass-light');
      const head = lowH.parentElement;
      const low = products.filter((p) => p.stock <= 3);
      const count = head && $$('span', head).find((s) => /variant/.test(text(s)));
      if (count) count.textContent = `${low.length} product${low.length === 1 ? '' : 's'}`;
      $$(':scope > *', card).filter((e) => e !== head && !e.contains(head)).forEach((e) => e.remove());
      const box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding-top:14px';
      box.innerHTML = low.length ? low.map((p) => `<a href="/admin/products" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.7);text-decoration:none;color:#1D1D1F">
          <span style="font-weight:600">${esc(p.name)}</span>${pill(p.stock <= 0 ? 'out' : 'unpaid').replace('Awaiting payment', `${p.stock} left`)}</a>`).join('')
        : '<p style="margin:0;color:#6E6E73">Everything is well stocked.</p>';
      card.appendChild(box);
    }
  }

  async function renderPaymentsCard(host) {
    const revH = $$('h2').find((h) => text(h) === 'Revenue');
    const ref = revH && revH.closest('.glass-light');
    if (!ref && !host) return;
    const card = document.createElement('section');
    card.className = 'glass-light';
    card.setAttribute('style', host ? UI.card : ref.getAttribute('style') || '');
    card.setAttribute('aria-labelledby', 'payments-title');
    if (host) host.appendChild(card); else ref.insertAdjacentElement('beforebegin', card);
    const render = async (status, err) => {
      const { data: recent = [] } = await db.from('payments').select('*, orders(number)').order('created_at', { ascending: false }).limit(5);
      const s = status && status.settings;
      const connected = s && s.account_number;
      const check = (ok, label) => `<li style="display:flex;gap:10px;align-items:flex-start;padding:6px 0"><span aria-hidden="true" style="flex:none;width:20px;height:20px;border-radius:980px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;${ok ? 'background:#E3F1E7;color:#1E5B34">✓' : 'background:#EFEFF1;color:#6E6E73">•'}</span><span>${label}</span></li>`;
      const btn = 'min-height:44px;padding:0 20px;border-radius:980px;border:none;background:#6E1A2C;color:#FFFFFF;font:inherit;font-weight:600;cursor:pointer';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <h2 id="payments-title" style="margin:0;font-size:22px;font-weight:600;letter-spacing:-0.015em">Payments</h2>
          ${connected ? pill('paid').replace('Paid', `CheqPay · ${s.mode === 'live' ? 'Live' : 'Test mode'}`) : pill('unfulfilled').replace('Unfulfilled', 'CheqPay not connected')}
        </div>
        ${connected ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;padding-top:16px">
            <div><div style="font-size:13px;color:#6E6E73">Customers pay into</div><div style="font-size:20px;font-weight:600">${esc(s.account_number)}</div></div>
            <div><div style="font-size:13px;color:#6E6E73">Bank</div><div style="font-weight:600">${esc(s.bank_name)}</div></div>
            <div><div style="font-size:13px;color:#6E6E73">Account name</div><div style="font-weight:600">${esc(s.account_name)}</div></div>
          </div>` : `<ol style="list-style:none;margin:14px 0 0;padding:0;font-size:15px;line-height:1.5">
            ${check(false, 'In your CheqPay developer dashboard (developers.mycheqpay.com), open a virtual account for the store and create a secret API key.')}
            ${check(status && status.webhook_secret_set, `Add a webhook for <strong>deposit.received</strong> pointing to <code style="font-size:13px;word-break:break-all">${esc(status ? status.webhook_url : '')}</code> and copy its signing secret.`)}
            ${check(status && status.api_key_set && status.webhook_secret_set, 'In Supabase → Edge Functions → Secrets, add <code>CHEQPAY_API_KEY</code> and <code>CHEQPAY_WEBHOOK_SECRET</code>.')}
            ${check(false, 'Press Connect CheqPay below.')}
          </ol>`}
        ${err ? `<p class="dh-error" role="alert" style="margin:12px 0 0">${esc(err)}</p>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;padding-top:16px">
          <button type="button" data-connect style="${btn}">${connected ? 'Refresh account details' : 'Connect CheqPay'}</button>
        </div>
        <div style="padding-top:18px">
          <div style="font-size:13px;font-weight:600;color:#6E6E73;padding-bottom:6px">Latest transfers</div>
          ${recent.length ? recent.map((p) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid rgba(0,0,0,.06);font-size:15px">
              <span>${nairaKobo(p.amount_kobo)} <span style="color:#6E6E73">· ${esc((p.payer && p.payer.name) || 'Unknown sender')} · ${fmtDateTime(p.created_at)}</span></span>
              ${p.status === 'matched' && p.orders ? `<a href="/admin/orders#${esc(p.orders.number)}" style="color:#1E5B34;font-weight:600;text-decoration:none">#${esc(p.orders.number)}</a>` : pill(p.status === 'ignored' ? 'draft' : 'unpaid').replace(/Draft|Awaiting payment/, p.status === 'ignored' ? 'Ignored' : 'Unmatched')}
            </div>`).join('') : '<p style="margin:0;color:#6E6E73;font-size:15px">No transfers yet.</p>'}
        </div>`;
      const b = $('[data-connect]', card);
      b.addEventListener('click', async () => {
        b.classList.add('dh-busy'); b.textContent = 'Connecting…';
        const { data, error } = await db.functions.invoke('cheqpay-connect', { body: { action: 'connect' } });
        let msg = null;
        if (error) { try { msg = (await error.context.json()).error; } catch { msg = error.message; } }
        await render(data || status, msg);
        if (!msg) toast('CheqPay connected');
      });
    };
    const { data } = await db.functions.invoke('cheqpay-connect', { body: { action: 'status' } });
    await render(data, data ? null : 'Couldn’t reach the payments service.');
  }

  async function renderAlertsCard(host) {
    const pay = $('#payments-title');
    const ref = pay && pay.closest('section');
    if (!ref && !host) return;
    const card = document.createElement('section');
    card.className = 'glass-light';
    card.setAttribute('style', host ? UI.card : ref.getAttribute('style') || '');
    card.setAttribute('aria-labelledby', 'alerts-title');
    if (host) host.appendChild(card); else ref.insertAdjacentElement('afterend', card);
    const field = 'width:100%;box-sizing:border-box;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid rgba(0,0,0,.14);background:#FFFFFF;font:inherit;font-size:15px;color:#1D1D1F';
    const btn = (primary) => `min-height:44px;padding:0 20px;border-radius:980px;font:inherit;font-weight:600;cursor:pointer;${primary ? 'border:none;background:#6E1A2C;color:#FFFFFF' : 'border:1px solid rgba(0,0,0,.14);background:#FFFFFF;color:#1D1D1F'}`;
    const chip = (ok, label) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:980px;font-size:12px;font-weight:600;${ok ? 'background:#E3F1E7;color:#1E5B34' : 'background:#EFEFF1;color:#6E6E73'}">${ok ? '✓' : '•'} ${label}</span>`;
    const LABEL = { placed: 'New order', paid: 'Payment', shipped: 'Shipped', test: 'Test' };
    const render = async (note) => {
      const [{ data: settings }, { data: recent = [] }, st] = await Promise.all([
        db.from('alert_settings').select('*').eq('id', 1).single(),
        db.from('notifications').select('*, orders(number)').order('created_at', { ascending: false }).limit(8),
        db.functions.invoke('order-alerts', { body: { action: 'status' } }),
      ]);
      const s0 = settings || {};
      const status = st.data || {};
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <h2 id="alerts-title" style="margin:0;font-size:22px;font-weight:600;letter-spacing:-0.015em">Order alerts</h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${chip(status.email, 'Email')}${chip(status.store_whatsapp, 'Your WhatsApp')}${chip(status.customer_whatsapp, 'Customer WhatsApp')}</div>
        </div>
        <p style="margin:8px 0 0;color:#6E6E73;font-size:15px;line-height:1.5">You get an email and a WhatsApp message for every new order and payment. Customers get their confirmation, payment receipt and shipping update.</p>
        <form data-alerts style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px;padding-top:16px">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#6E6E73">Send store alerts to (email)
            <input type="email" name="owner_email" autocomplete="email" value="${esc(s0.owner_email || '')}" placeholder="you@email.com" style="${field}"></label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#6E6E73">Your WhatsApp number
            <input type="tel" name="owner_whatsapp" autocomplete="tel" value="${esc(s0.owner_whatsapp || '')}" placeholder="+234 803 123 4567" style="${field}"></label>
          <label style="display:flex;align-items:center;gap:10px;font-size:15px;min-height:44px;grid-column:1/-1;cursor:pointer">
            <input type="checkbox" name="notify_customers" ${s0.notify_customers !== false ? 'checked' : ''} style="accent-color:#6E1A2C;width:18px;height:18px">Send customers email and WhatsApp updates</label>
          <div style="display:flex;gap:10px;flex-wrap:wrap;grid-column:1/-1">
            <button type="submit" style="${btn(true)}">Save</button>
            <button type="button" data-test style="${btn(false)}">Send test alert</button>
          </div>
        </form>
        ${note ? `<div role="status" style="margin-top:12px;font-size:15px;line-height:1.5">${note}</div>` : ''}
        <div style="padding-top:18px">
          <div style="font-size:13px;font-weight:600;color:#6E6E73;padding-bottom:6px">Latest alerts</div>
          ${recent.length ? recent.map((n) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid rgba(0,0,0,.06);font-size:14px">
              <span>${LABEL[n.event] || n.event}${n.orders ? ' · #' + esc(n.orders.number) : ''} · ${n.audience === 'owner' ? 'You' : 'Customer'} by ${n.channel === 'email' ? 'email' : 'WhatsApp'}<br><span style="color:#6E6E73;font-size:13px">${fmtDateTime(n.created_at)}${n.error ? ' · ' + esc(n.error) : ''}</span></span>
              ${pill({ sent: 'paid', failed: 'refunded', skipped: 'draft', pending: 'unpaid', sending: 'unpaid' }[n.status]).replace(/Paid|Refunded|Draft|Awaiting payment/, { sent: 'Sent', failed: 'Failed', skipped: 'Not sent', pending: 'Queued', sending: 'Sending' }[n.status])}
            </div>`).join('') : '<p style="margin:0;color:#6E6E73;font-size:15px">No alerts yet.</p>'}
        </div>`;
      const form = $('[data-alerts]', card);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const patch = {
          owner_email: String(fd.get('owner_email') || '').trim() || null,
          owner_whatsapp: String(fd.get('owner_whatsapp') || '').trim() || null,
          notify_customers: fd.get('notify_customers') === 'on',
          updated_at: new Date().toISOString(),
        };
        const { error } = await db.from('alert_settings').update(patch).eq('id', 1);
        await render(error ? `<span class="dh-error">Couldn’t save: ${esc(error.message)}</span>` : 'Saved.');
      });
      $('[data-test]', card).addEventListener('click', async (e) => {
        e.target.classList.add('dh-busy'); e.target.textContent = 'Sending…';
        const { data, error } = await db.functions.invoke('order-alerts', { body: { action: 'test' } });
        const lines = error ? [`<span class="dh-error">The test couldn’t run.</span>`] : (data.results || []).map((r) =>
          `${r.channel === 'email' ? 'Email' : 'WhatsApp'}: ${r.status === 'sent' ? '<strong style="color:#1E5B34">sent</strong>' : `<strong>${r.status === 'skipped' ? 'not sent' : 'failed'}</strong> — ${esc(r.error || '')}`}`);
        await render(lines.join('<br>'));
      });
    };
    await render();
  }

  /* --- motion --- */
  function initMotion() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('motion');
    const header = $('header.glass-bar-light');
    if (header) {
      const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
      addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    const picks = $$('main h1, section h1, section h2, article, .glass-light, .glass, section .zoom, main table, footer > div, section p, section ol, section ul')
      .filter((el) => !el.closest('header, aside, .dh-toast') && el.offsetParent !== null);
    const chosen = [];
    picks.forEach((el) => { if (!chosen.some((c) => c.contains(el))) chosen.push(el); });
    const counts = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    chosen.forEach((el) => {
      const n = counts.get(el.parentElement) || 0;
      counts.set(el.parentElement, n + 1);
      el.style.setProperty('--i', String(Math.min(n, 6)));
      el.classList.add('reveal');
      el.addEventListener('transitionend', function done(ev) {
        if (ev.target !== el || ev.propertyName !== 'transform') return;
        el.classList.remove('reveal', 'in');
        el.style.removeProperty('--i');
        el.removeEventListener('transitionend', done);
      });
      io.observe(el);
    });
  }

  /* --- products --- */
  async function initAdminProducts() {
    const table = $('main table');
    const [{ data: products = [] }, orders] = await Promise.all([db.from('products').select('*').order('sort'), loadOrders()]);
    setUnfulfilledBadge(orders);
    const since = Date.now() - 30 * 864e5;
    const sold = {};
    orders.filter((o) => new Date(o.created_at).getTime() >= since && o.status !== 'cancelled')
      .forEach((o) => o.order_items.forEach((i) => { sold[i.product_id] = (sold[i.product_id] || 0) + i.quantity; }));
    let filter = 'all';
    const tabs = $$('button[aria-pressed]').filter((b) => /^(All|Active|Draft|Out of stock)/.test(text(b)));
    const onStyle = (tabs.find((t) => t.getAttribute('aria-pressed') === 'true') || {}).getAttribute?.('style');
    const offStyle = (tabs.find((t) => t.getAttribute('aria-pressed') === 'false') || {}).getAttribute?.('style');
    const keyOf = (t) => text(t).replace(/\(\d+\)/, '').trim().toLowerCase();
    tabs.forEach((t) => t.addEventListener('click', () => { filter = keyOf(t); render(); }));
    const search = $('input[placeholder="Search products"]');
    if (search) search.addEventListener('input', () => render());
    const input = 'width:110px;min-height:40px;padding:0 10px;border-radius:10px;border:1px solid rgba(0,0,0,.12);background:#FFFFFF;font:inherit;font-size:15px;color:#1D1D1F';

    function render() {
      const counts = { all: products.length, active: products.filter((p) => p.active).length, draft: products.filter((p) => !p.active).length, 'out of stock': products.filter((p) => p.stock <= 0).length };
      tabs.forEach((t) => {
        const k = keyOf(t);
        t.textContent = `${t.textContent.replace(/\s*\(\d+\)\s*/, '').trim()} (${counts[k] ?? 0})`;
        t.setAttribute('aria-pressed', String(k === filter));
        if (onStyle && offStyle) t.setAttribute('style', k === filter ? onStyle : offStyle);
      });
      const q = (search && search.value || '').toLowerCase();
      const list = products.filter((p) => (filter === 'all' || (filter === 'active' && p.active) || (filter === 'draft' && !p.active) || (filter === 'out of stock' && p.stock <= 0))
        && (!q || p.name.toLowerCase().includes(q)));
      const trs = fillTable(table, list.map((p) => [
        `<input type="checkbox" aria-label="Select ${esc(p.name)}" style="accent-color:#6E1A2C;width:16px;height:16px">`,
        `<span style="display:flex;align-items:center;gap:12px"><img src="${esc(p.image)}" alt="" style="width:44px;height:52px;border-radius:10px;object-fit:cover;object-position:${esc(p.image_position || 'center')}"><span style="display:flex;flex-direction:column;gap:2px"><a href="/admin/product-edit?id=${p.id}" style="font-weight:600;text-decoration:none;color:#1D1D1F">${esc(p.name)}</a><span style="font-size:12px;color:#6E6E73">${esc(p.category || 'Wigs')} · <a href="${productUrl(p)}" target="_blank" rel="noopener" style="color:#6E6E73">view in shop</a></span></span></span>`,
        `<label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''} style="accent-color:#6E1A2C;width:18px;height:18px">${pill(p.stock <= 0 ? 'out' : p.active ? 'active' : 'draft')}</label>`,
        `<input type="number" min="0" step="1" data-f="stock" value="${p.stock}" aria-label="Stock for ${esc(p.name)}" style="${input}">`,
        `<input type="number" min="0" step="1000" data-f="price_ngn" value="${p.price_ngn}" aria-label="Price in naira for ${esc(p.name)}" style="${input};width:130px">`,
        esc(p.style || 'Wigs'), String(sold[p.id] || 0),
        `<button type="button" data-save style="min-height:40px;padding:0 16px;border-radius:980px;border:none;background:#6E1A2C;color:#FFFFFF;font:inherit;font-weight:600;cursor:pointer">Save</button>`,
      ]), 'No products here yet.');
      trs.forEach((tr, i) => {
        const p = list[i];
        const btn = $('[data-save]', tr);
        btn.addEventListener('click', async () => {
          const patch = { stock: Math.max(0, parseInt($('[data-f="stock"]', tr).value, 10) || 0), price_ngn: Math.max(0, parseInt($('[data-f="price_ngn"]', tr).value, 10) || 0), active: $('[data-f="active"]', tr).checked };
          btn.classList.add('dh-busy');
          const { error } = await db.from('products').update(patch).eq('id', p.id);
          btn.classList.remove('dh-busy');
          if (error) { toast('Couldn’t save: ' + error.message); return; }
          Object.assign(p, patch);
          toast(`${p.name} saved — the shop updates right away`);
          render();
        });
      });
    }
    render();
  }

  /* --- customers --- */
  async function initAdminCustomers() {
    const table = $('main table');
    const orders = await loadOrders();
    setUnfulfilledBadge(orders);
    const map = new Map();
    orders.forEach((o) => {
      const c = map.get(o.email) || { ...o, count: 0, spent: 0, last: o.created_at };
      c.count += 1;
      if (o.status !== 'cancelled' && o.payment_status !== 'refunded') c.spent += o.total_ngn;
      if (o.created_at > c.last) c.last = o.created_at;
      map.set(o.email, c);
    });
    const customers = Array.from(map.values()).sort((a, b) => b.last.localeCompare(a.last));
    const search = $$('input[type="search"]').find((i) => !/orders, products/.test(i.placeholder));
    const render = () => {
      const q = (search && search.value || '').toLowerCase();
      const list = customers.filter((c) => !q || [c.first_name, c.last_name, c.email, c.phone].join(' ').toLowerCase().includes(q));
      fillTable(table, list.map((c) => [
        `<input type="checkbox" aria-label="Select ${esc(c.first_name)}" style="accent-color:#6E1A2C;width:16px;height:16px">`,
        `<span style="display:flex;align-items:center;gap:10px">${avatar(c)}<span style="display:flex;flex-direction:column;gap:1px"><span style="font-weight:600">${esc(c.first_name + ' ' + c.last_name)}</span><span style="font-size:12px;color:#6E6E73">${esc(c.email)} · ${esc(c.phone)}</span></span></span>`,
        String(c.count), naira(c.spent), fmtDate(c.last),
        c.count > 1 ? pill('paid').replace('Paid', 'Returning') : pill('unfulfilled').replace('Unfulfilled', 'New'),
        `<a href="${wa(c.phone)}" target="_blank" rel="noopener" aria-label="Message ${esc(c.first_name)} on WhatsApp" style="display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:980px;background:#E3F1E7;color:#1E5B34;text-decoration:none;font-size:13px;font-weight:600">WhatsApp</a>`,
      ]), 'No customers yet. They appear here after their first order.');
    };
    if (search) search.addEventListener('input', render);
    render();
  }

  /* ======================= marketing tools ======================= */
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function downloadPng(node, name, pixelRatio = 1) {
    if (!window.htmlToImage) await loadScript('/assets/vendor/html-to-image-1.11.11.js');
    const zoomed = node.closest('.frame');
    const z = zoomed && zoomed.style.zoom;
    if (zoomed) zoomed.style.zoom = 1;
    try {
      const url = await window.htmlToImage.toPng(node, { pixelRatio, cacheBust: true });
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    } finally { if (zoomed) zoomed.style.zoom = z; }
  }
  function toolPanel(html) {
    document.body.style.flexDirection = 'column';
    document.body.style.alignItems = 'center';
    document.body.style.gap = '24px';
    const panel = document.createElement('section');
    panel.className = 'dh-tool glass';
    panel.style.cssText = 'width:min(1080px,100%);box-sizing:border-box;border-radius:22px;padding:22px;display:flex;flex-direction:column;gap:16px;color:#F5F5F7';
    panel.innerHTML = html;
    $('.frame').insertAdjacentElement('beforebegin', panel);
    return panel;
  }
  const TF = 'width:100%;box-sizing:border-box;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#F5F5F7;font:inherit;font-size:15px';
  const TL = 'display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#E3CFCC;min-width:0';
  const TB = 'display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:980px;border:none;background:#F5F5F7;color:#1A0609;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap';
  const TB2 = 'display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:980px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#F5F5F7;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap';
  const toolHead = (title, sub) => `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:-0.015em">${title}</h1><p style="margin:4px 0 0;font-size:14px;color:#C9B5B2">${sub}</p></div><a href="/admin/content" style="${TB2}">Back to admin</a></div>`;

  async function initMarketing() {
    const art = $('.frame') && $('.frame').firstElementChild;
    if (!art) return;
    let c = { v: {}, promos: {} };
    try { c = await loadContent(); } catch { /* ignore */ }
    const handle = (c.v.instagram || '').replace(/^@/, '');

    if (page === 'marketing-instagram') {
      const products = await loadProducts();
      const spans = $$('span', art);
      const photoBox = spans.find((s) => text(s) === '[MODEL PHOTO]').parentElement;
      const [eyebrow, headline] = spans.filter((s) => /New arrival|Body Wave Collection/.test(text(s)));
      const tagline = spans.find((s) => /little dream/.test(text(s)));
      const cta = spans.find((s) => text(s) === 'Shop now');
      const site = spans.find((s) => text(s) === 'houseoflovethhair.com');
      const panel = toolPanel(`${toolHead('Instagram post maker', 'Pick a wig, edit the words, then download a 1080 × 1080 image ready to post.')}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          <label style="${TL}">Wig<select data-k="product" style="${TF}">${products.map((p) => `<option value="${esc(p.slug)}">${esc(p.name)}</option>`).join('')}</select></label>
          <label style="${TL}">Label<input data-k="eyebrow" value="${esc(text(eyebrow))}" maxlength="30" style="${TF}"></label>
          <label style="${TL}">Headline<input data-k="headline" value="${esc(text(headline))}" maxlength="50" style="${TF}"></label>
          <label style="${TL}">Line under it<input data-k="tagline" value="${esc(text(tagline))}" maxlength="80" style="${TF}"></label>
          <label style="${TL}">Button<input data-k="cta" value="${esc(text(cta))}" maxlength="24" style="${TF}"></label>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-dl style="${TB}">Download image</button><button type="button" data-useprod style="${TB2}">Use wig name as headline</button></div>`);
      photoBox.style.position = 'relative'; photoBox.style.overflow = 'hidden';
      const img = document.createElement('img');
      img.alt = ''; img.crossOrigin = 'anonymous';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
      photoBox.innerHTML = ''; photoBox.appendChild(img);
      const sync = () => {
        const p = products.find((x) => x.slug === $('[data-k="product"]', panel).value) || products[0];
        if (p) { img.src = p.image; img.style.objectPosition = p.image_position || 'center'; }
        eyebrow.textContent = $('[data-k="eyebrow"]', panel).value;
        headline.textContent = $('[data-k="headline"]', panel).value;
        tagline.textContent = $('[data-k="tagline"]', panel).value;
        cta.textContent = $('[data-k="cta"]', panel).value;
        if (site && handle) site.textContent = '@' + handle + ' · houseoflovethhair.com';
      };
      panel.addEventListener('input', sync); panel.addEventListener('change', sync); sync();
      $('[data-useprod]', panel).addEventListener('click', () => { const s = $('[data-k="product"]', panel); $('[data-k="headline"]', panel).value = s.options[s.selectedIndex].text; sync(); });
      $('[data-dl]', panel).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('dh-busy');
        try { await downloadPng(art, `loveth-post-${$('[data-k="product"]', panel).value}.png`); } catch { toast('Couldn’t make the image. Please try again.'); }
        btn.classList.remove('dh-busy');
      });
    }

    if (page === 'marketing-thank-you-card') {
      const para = $('p', art);
      const tagline = $$('span', art).find((s) => /INSTAGRAM HANDLE/.test(text(s)));
      const feat = c.promos.featured;
      const panel = toolPanel(`${toolHead('Thank-you card', 'A card to slip into every order. Print it, or download it for a print shop.')}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
          <label style="${TL}">Discount for their next order<input data-k="off" value="${feat && feat.kind === 'percent' ? feat.value + '%' : feat ? naira(feat.value) : '10%'}" maxlength="12" style="${TF}"></label>
          <label style="${TL}">Code<input data-k="code" value="${esc(feat ? feat.code : 'FAMILY10')}" maxlength="24" style="${TF};text-transform:uppercase"></label>
          <label style="${TL}">Instagram handle<input data-k="ig" value="${esc(handle)}" placeholder="without the @" maxlength="40" style="${TF}"></label>
        </div>
        <p style="margin:0;font-size:13px;color:#C9B5B2">Make sure the code exists in Admin → Discounts so it works at checkout.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-print style="${TB}">Print</button><button type="button" data-dl style="${TB2}">Download for printing</button></div>`);
      const sync = () => {
        const off = $('[data-k="off"]', panel).value.trim() || '10%';
        const code = $('[data-k="code"]', panel).value.trim().toUpperCase() || 'FAMILY10';
        const ig = $('[data-k="ig"]', panel).value.trim().replace(/^@/, '');
        para.textContent = `You're more than a customer — you're family. Tag us in your new look and enjoy ${off} off your next order with code ${code}.`;
        tagline.textContent = (ig ? '@' + ig + ' · ' : '') + 'houseoflovethhair.com';
      };
      panel.addEventListener('input', sync); sync();
      $('[data-print]', panel).addEventListener('click', () => window.print());
      $('[data-dl]', panel).addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.classList.add('dh-busy');
        try { await downloadPng(art, 'loveth-thank-you-card.png', 3); } catch { toast('Couldn’t make the image. Please try again.'); }
        btn.classList.remove('dh-busy');
      });
    }

    if (page === 'marketing-app-icon') {
      const panel = toolPanel(`${toolHead('App icon & logo', 'Download the HL icon for profile pictures, WhatsApp Business and printing.')}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button type="button" data-size="1024" style="${TB}">Download 1024 px</button>
          <button type="button" data-size="512" style="${TB2}">512 px</button>
          <button type="button" data-size="192" style="${TB2}">192 px</button>
        </div>`);
      $$('[data-size]', panel).forEach((b) => b.addEventListener('click', async () => {
        b.classList.add('dh-busy');
        const n = +b.dataset.size;
        try { await downloadPng(art, `loveth-icon-${n}.png`, n / 512); } catch { toast('Couldn’t make the image. Please try again.'); }
        b.classList.remove('dh-busy');
      }));
    }
  }

  /* ======================= install page (/app/install) ======================= */
  function initInstallPage() {
    const forAdmin = new URLSearchParams(location.search).get('app') === 'admin';
    if (forAdmin) { const m = $('link[rel="manifest"]'); if (m) m.href = '/admin/manifest.webmanifest'; }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const root = $('[data-install]');
    if (!root) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const copy = forAdmin
      ? { name: 'Loveth Admin', url: 'Store admin', title: 'Run the store from your home screen.', points: [['bag', 'New orders at a glance, one tap away'], ['bell', 'Update orders and stock on the go'], ['wifi', 'Opens straight to your dashboard']], back: '/admin' }
      : { name: 'Dream Hair by Loveth', url: 'houseoflovethhair.com', title: 'Add us to your home screen for a little dream, one tap away.', points: [['bag', 'Shop faster, straight from your home screen'], ['bell', 'Your bag and wishlist, ready when you are'], ['wifi', 'Keeps working on a weak connection']], back: '/' };
    const ICON = {
      bag: '<path d="M5 8h14l-1.5 12h-11z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path>',
      bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"></path><path d="M10 21h4"></path>',
      wifi: '<path d="M2 9a15 15 0 0 1 20 0"></path><path d="M5 12.5a10 10 0 0 1 14 0"></path><path d="M8.5 16a5 5 0 0 1 7 0"></path><circle cx="12" cy="19.5" r="1"></circle>',
    };
    const render = () => {
      const installed = isInstalled();
      root.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px">
          <img src="/icons/icon-192.png" alt="" width="72" height="72" style="border-radius:18px;box-shadow:0 8px 24px rgba(0,0,0,.35)">
          <div><div style="font-size:22px;font-weight:600;letter-spacing:-0.015em">${copy.name}</div><div style="font-size:14px;color:#C9B5B2">${copy.url}</div></div>
        </div>
        <h1 style="margin:0;font-size:clamp(24px,5vw,30px);line-height:1.2;font-weight:600;letter-spacing:-0.02em">${installed ? 'You’re all set.' : copy.title}</h1>
        <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px">${copy.points.map(([i, t]) => `<li style="display:flex;align-items:center;gap:14px;font-size:16px"><span style="flex:none;width:40px;height:40px;border-radius:980px;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[i]}</svg></span>${t}</li>`).join('')}</ul>
        <div data-how></div>
        ${installed ? `<a href="${copy.back}" style="${TB};min-height:54px">Open ${copy.name}</a>` : `<button type="button" data-go style="${TB};min-height:54px">Install app</button>`}
        <a href="${copy.back}" style="align-self:center;color:#C9B5B2;text-decoration:none;font-size:16px;padding:8px">Not now</a>`;
      const go = $('[data-go]', root);
      if (go) go.addEventListener('click', async () => {
        if (await promptInstall()) return render();
        $('[data-how]', root).innerHTML = `<div class="glass" style="border-radius:16px;padding:16px;font-size:15px;line-height:1.55">${ios
          ? 'On iPhone or iPad: tap the <strong>Share</strong> button <span aria-hidden="true">(□↑)</span> at the bottom of Safari, then <strong>Add to Home Screen</strong>.'
          : 'Open your browser’s menu <span aria-hidden="true">(⋮)</span> and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.'}</div>`;
      });
    };
    render();
    document.addEventListener('dh-can-install', render);
    window.addEventListener('appinstalled', render);
  }

  /* ======================= admin app install ======================= */
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; document.dispatchEvent(new Event('dh-can-install')); });
  const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  async function promptInstall() {
    if (!installEvent) return false;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null;
    if (outcome === 'accepted') toast('Installed — find “Loveth Admin” on your home screen');
    return true;
  }
  function initInstallPrompt() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const btn = $$('aside button, aside a').find((b) => text(b) === 'Install');
    if (!btn) return;
    const box = btn.parentElement;
    if (isInstalled()) { if (box) box.hidden = true; return; }
    stripClick(btn);
    btn.addEventListener('click', async (e) => { e.preventDefault(); if (!(await promptInstall())) location.href = '/app/install?app=admin'; });
  }

  /* ======================= ADMIN: roles, shared UI ======================= */
  const ROLE_NAMES = { owner: 'Owner', manager: 'Manager', sales: 'Sales & customer care', inventory: 'Inventory' };
  const ROLE_INFO = {
    owner: 'Everything, including staff accounts and payment settings.',
    manager: 'Runs the store day to day. Can see settings and payments but not change them, and has no access to staff accounts.',
    sales: 'Handles orders, customers and WhatsApp enquiries.',
    inventory: 'Adds products and keeps stock levels up to date.',
  };
  const AREAS = [['dashboard', 'Dashboard & reports'], ['orders', 'Orders'], ['products', 'Products & stock'], ['customers', 'Customers'],
    ['discounts', 'Discounts'], ['content', 'Content & homepage'], ['settings', 'Settings & payments'], ['staff', 'Staff accounts']];
  // keep in step with public.role_access() in the database, which is what actually enforces this
  function roleAccess(role, area) {
    if (role === 'owner') return 'full';
    if (role === 'manager') return area === 'staff' ? 'none' : area === 'settings' ? 'view' : 'full';
    if (role === 'sales') return ({ orders: 'full', customers: 'full', dashboard: 'view', products: 'view', discounts: 'view' })[area] || 'none';
    if (role === 'inventory') return ({ products: 'full', dashboard: 'view', orders: 'view' })[area] || 'none';
    return 'none';
  }
  let ME = null;
  const canDo = (area, write = true) => { const a = roleAccess(ME && ME.access, area); return a === 'full' || (!write && a === 'view'); };
  const PAGE_AREA = {
    'admin-dashboard': 'dashboard', 'admin-orders': 'orders', 'admin-products': 'products', 'admin-product-edit': 'products',
    'admin-customers': 'customers', 'admin-discounts': 'discounts', 'admin-content': 'content', 'admin-settings': 'settings', 'admin-staff': 'staff',
  };
  const NAV_AREA = {
    '/admin': 'dashboard', '/admin/orders': 'orders', '/admin/products': 'products', '/admin/customers': 'customers',
    '/admin/discounts': 'discounts', '/admin/content': 'content', '/admin/settings': 'settings', '/admin/staff': 'staff',
  };

  const UI = {
    card: 'border-radius:20px;padding:24px;display:flex;flex-direction:column;gap:16px;min-width:0',
    h2: 'margin:0;font-size:20px;font-weight:600;letter-spacing:-0.015em',
    label: 'display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:#1D1D1F;min-width:0',
    field: 'width:100%;box-sizing:border-box;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid rgba(0,0,0,.14);background:#FFFFFF;font:inherit;font-size:15px;font-weight:400;color:#1D1D1F',
    area: 'width:100%;box-sizing:border-box;min-height:120px;padding:12px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.14);background:#FFFFFF;font:inherit;font-size:15px;font-weight:400;line-height:1.5;color:#1D1D1F;resize:vertical',
    hint: 'font-size:13px;font-weight:400;color:#6E6E73;line-height:1.45',
    btn: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:980px;border:none;background:#6E1A2C;color:#FFFFFF;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap',
    btn2: 'display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border-radius:980px;border:1px solid rgba(0,0,0,.14);background:#FFFFFF;color:#1D1D1F;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap',
    danger: 'display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:980px;border:1px solid rgba(138,31,53,.3);background:#FFFFFF;color:#8A1F35;font:inherit;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap',
    small: 'display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 14px;border-radius:980px;border:1px solid rgba(0,0,0,.14);background:#FFFFFF;color:#1D1D1F;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none',
    th: 'text-align:left;padding:10px 12px;font-size:12px;font-weight:600;color:#6E6E73;border-bottom:1px solid rgba(0,0,0,.08);white-space:nowrap',
    td: 'padding:12px;border-bottom:1px solid rgba(0,0,0,.06);vertical-align:middle;font-size:15px',
  };
  const card = (inner, extra = '') => `<section class="glass-light" style="${UI.card};${extra}">${inner}</section>`;
  const fieldHtml = (name, label, value, attrs = '', hint = '') => `<label style="${UI.label}">${label}${hint ? `<span style="${UI.hint}">${hint}</span>` : ''}<input name="${name}" value="${esc(value ?? '')}" ${attrs} style="${UI.field}"></label>`;
  const adminBody = () => $('[data-admin-body]');
  const setTitle = (h, crumb) => {
    const h1 = $('main h1'); if (h1) h1.textContent = h;
    const c = h1 && h1.previousElementSibling;
    if (c && crumb) c.innerHTML = 'Admin <span aria-hidden="true">/</span> ' + crumb;
    document.title = 'Admin — ' + h;
  };
  const fnError = async (error, data) => {
    if (data && data.error) return data.error;
    if (!error) return null;
    try { return (await error.context.json()).error || error.message; } catch { return error.message; }
  };
  const ago = (d) => {
    if (!d) return 'Never';
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 300) return 'Online now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hour${s < 7200 ? '' : 's'} ago`;
    if (s < 172800) return 'Yesterday';
    if (s < 30 * 86400) return `${Math.round(s / 86400)} days ago`;
    return fmtDate(d);
  };
  function dialog(html, { wide = false } = {}) {
    const d = document.createElement('dialog');
    d.className = 'dh-dialog glass-light';
    d.style.cssText = `width:min(${wide ? 640 : 520}px,calc(100vw - 32px));max-height:calc(100dvh - 48px);overflow:auto;box-sizing:border-box;padding:28px;border:none;border-radius:24px;color:#1D1D1F`;
    d.innerHTML = html;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close()));
    d.showModal();
    return d;
  }
  const noAccess = (msg) => card(`<h2 style="${UI.h2}">You don’t have access to this page</h2><p style="margin:0;${UI.hint};font-size:15px">${msg || 'Ask the store owner if you need it.'}</p><a href="/admin" style="${UI.btn2};align-self:flex-start">Back to the dashboard</a>`);
  const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  /* --- resize a photo in the browser before upload (keeps pages fast) --- */
  async function shrinkImage(file, max = 1800) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.86));
    } catch { return file; }
  }

  /* ======================= ADMIN: add / edit product ======================= */
  async function initAdminProductEdit() {
    const body = adminBody();
    const id = new URLSearchParams(location.search).get('id');
    const canEdit = canDo('products');
    let p;
    if (id) {
      const { data } = await db.from('products').select('*').eq('id', id).maybeSingle();
      if (!data) { body.innerHTML = card(`<h2 style="${UI.h2}">Product not found</h2><a href="/admin/products" style="${UI.btn2};align-self:flex-start">Back to products</a>`); return; }
      p = data;
    } else {
      if (!canEdit) { body.innerHTML = noAccess('You can view products but not add them.'); return; }
      p = { name: '', slug: '', description: '', price_ngn: 0, compare_at_ngn: null, stock: 0, sku: '', badge: null, active: false, category: 'Wigs',
        style: '', colour: '', lengths: ['14″', '16″', '18″', '20″', '22″', '24″'], laces: ['13×4 frontal', '5×5 closure'], densities: ['150%', '180%', '200%'],
        image: '', images: [], image_position: 'center 35%', length_prices: {} };
    }
    const st = JSON.parse(JSON.stringify(p));
    st.photos = [p.image, ...(p.images || [])].filter(Boolean);
    let dirty = false;
    const focusPct = () => parseInt(String(st.image_position || '').split(' ')[1], 10) || 35;
    setTitle(p.name || 'New product', `Products <span aria-hidden="true">/</span> ${id ? 'Edit' : 'Add'}`);

    body.innerHTML = `
      <div class="dh-savebar glass-light" style="position:sticky;top:12px;z-index:5;border-radius:980px;padding:8px 8px 8px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span data-status style="flex:1;min-width:140px;font-size:15px;color:#6E6E73">${canEdit ? (id ? 'All changes saved' : 'New product — not saved yet') : 'View only — your role can’t change products'}</span>
        ${id ? `<a href="/product?p=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener" style="${UI.btn2}">View in shop</a>` : ''}
        ${canEdit ? `<button type="button" data-discard style="${UI.btn2}" hidden>Discard</button><button type="button" data-save style="${UI.btn}">${id ? 'Save' : 'Save product'}</button>` : ''}
      </div>
      <div class="dh-edit-grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,360px);gap:24px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:24px;min-width:0">
          ${card(`<h2 style="${UI.h2}">Title & description</h2>
            ${fieldHtml('name', 'Title', st.name, 'required maxlength="120" placeholder="e.g. Honey Blonde Body Wave"')}
            <label style="${UI.label}">Description<span style="${UI.hint}">What it looks like, how it’s styled and what makes it special. Shown on the product page.</span><textarea name="description" maxlength="2000" style="${UI.area}">${esc(st.description || '')}</textarea></label>`)}
          ${card(`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap"><h2 style="${UI.h2}">Photos</h2><span style="${UI.hint}">The first photo is the cover. JPG, PNG or WebP.</span></div>
            <div data-photos style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px"></div>
            <label style="${UI.label}">Cover photo focus<span style="${UI.hint}">Slide to keep the face in view when the photo is cropped.</span>
              <input type="range" name="focus" min="0" max="100" step="5" value="${focusPct()}" style="accent-color:#6E1A2C;width:100%"></label>`)}
          ${card(`<h2 style="${UI.h2}">Options</h2><p style="margin:-8px 0 0;${UI.hint}">Shoppers pick one of each. Leave a list empty to hide that choice.</p>
            <div data-opts style="display:flex;flex-direction:column;gap:18px"></div>`)}
          ${card(`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap"><h2 style="${UI.h2}">Price by length</h2><span style="${UI.hint}">Leave blank to use the main price.</span></div>
            <div data-lengthprices style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px"></div>`)}
          ${card(`<h2 style="${UI.h2}">Search engine preview</h2><div data-seo style="display:flex;flex-direction:column;gap:4px;padding:14px 16px;border-radius:14px;background:#FFFFFF;border:1px solid rgba(0,0,0,.06)"></div>`)}
        </div>
        <div style="display:flex;flex-direction:column;gap:24px;min-width:0">
          ${card(`<h2 style="${UI.h2}">Status</h2>
            <div role="radiogroup" aria-label="Status" style="display:flex;gap:4px;padding:4px;border-radius:980px;background:rgba(0,0,0,.05)">
              <label class="dh-seg" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;border-radius:980px;cursor:pointer;font-weight:600;font-size:15px"><input type="radio" name="active" value="1" ${st.active ? 'checked' : ''} style="accent-color:#6E1A2C">Active</label>
              <label class="dh-seg" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;border-radius:980px;cursor:pointer;font-weight:600;font-size:15px"><input type="radio" name="active" value="0" ${st.active ? '' : 'checked'} style="accent-color:#6E1A2C">Draft</label>
            </div>
            <p data-activehint style="margin:0;${UI.hint}"></p>
            <label style="${UI.label}">Badge<select name="badge" style="${UI.field}"><option value="">None</option>${['New', 'Bestseller', 'Sale'].map((b) => `<option ${st.badge === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>`)}
          ${card(`<h2 style="${UI.h2}">Pricing</h2>
            ${fieldHtml('price_ngn', 'Price (₦)', st.price_ngn || '', 'type="number" min="0" step="500" inputmode="numeric" required')}
            ${fieldHtml('compare_at_ngn', 'Compare-at price (₦)', st.compare_at_ngn || '', 'type="number" min="0" step="500" inputmode="numeric"', 'Optional. Shown crossed out when it’s higher than the price.')}`)}
          ${card(`<h2 style="${UI.h2}">Inventory</h2>
            ${fieldHtml('stock', 'In stock', st.stock, 'type="number" min="0" step="1" inputmode="numeric"', 'Shoppers can’t order more than this. It goes down with every order.')}
            ${fieldHtml('sku', 'SKU', st.sku || '', 'maxlength="40" placeholder="Optional"')}`)}
          ${card(`<h2 style="${UI.h2}">Organisation</h2>
            <label style="${UI.label}">Category<select name="category" style="${UI.field}">${['Wigs', 'Bundles', 'Hair care'].map((c) => `<option ${st.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            ${fieldHtml('style', 'Style', st.style || '', 'maxlength="60" placeholder="e.g. Body wave"', 'Shown on product cards and used for “Wavy” and other shop filters.')}
            ${fieldHtml('colour', 'Colour', st.colour || '', 'maxlength="60" placeholder="e.g. Ash brown"')}
            ${id ? `<p style="margin:0;${UI.hint}">Web address: /product?p=${esc(p.slug)}</p>` : ''}`)}
          ${id && canEdit ? card(`<h2 style="${UI.h2}">Delete product</h2><p style="margin:0;${UI.hint}">Past orders keep their details. To take it off the shop for now, set it to Draft instead.</p><button type="button" data-delete style="${UI.danger};align-self:flex-start">Delete product</button>`) : ''}
        </div>
      </div>`;

    const form = body;
    const statusEl = $('[data-status]', body);
    const saveBtn = $('[data-save]', body);
    const discardBtn = $('[data-discard]', body);
    const markDirty = () => {
      if (!canEdit) return;
      dirty = true;
      statusEl.textContent = 'Unsaved changes'; statusEl.style.color = '#8A4B0F';
      if (discardBtn) discardBtn.hidden = false;
    };
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    const val = (n) => { const el = $(`[name="${n}"]`, form); return el ? el.value.trim() : ''; };
    const activeHint = () => {
      const on = $('[name="active"][value="1"]', form).checked;
      $('[data-activehint]', form).textContent = on ? 'Visible in your online shop.' : 'Hidden from shoppers. Only staff can see it.';
    };

    function renderPhotos() {
      const box = $('[data-photos]', form);
      const pos = st.image_position || 'center';
      box.innerHTML = st.photos.map((src, i) => `
        <figure style="margin:0;position:relative;display:flex;flex-direction:column;gap:6px">
          <img src="${esc(src)}" alt="" style="width:100%;aspect-ratio:3/4;object-fit:cover;object-position:${i === 0 ? esc(pos) : 'center'};border-radius:14px;border:1px solid rgba(0,0,0,.08);background:#F5F5F7">
          ${i === 0 ? '<span style="position:absolute;top:8px;left:8px;padding:3px 10px;border-radius:980px;background:rgba(255,255,255,.92);font-size:12px;font-weight:600">Cover</span>' : ''}
          ${canEdit ? `<span style="display:flex;gap:6px;flex-wrap:wrap">${i ? `<button type="button" data-cover="${i}" style="${UI.small}">Make cover</button>` : ''}<button type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}" style="${UI.small}">Remove</button></span>` : ''}
        </figure>`).join('') + (canEdit ? `
        <label style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;aspect-ratio:3/4;border-radius:14px;border:1.5px dashed rgba(110,26,44,.35);background:rgba(255,255,255,.6);cursor:pointer;color:#6E1A2C;font-weight:600;font-size:14px;text-align:center;padding:8px">
          <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"></path></svg>
          <span data-uploadlabel>Add photos</span><input type="file" data-upload accept="image/jpeg,image/png,image/webp" multiple style="position:absolute;width:1px;height:1px;opacity:0"></label>` : '');
      $$('[data-cover]', box).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.cover; st.photos.unshift(st.photos.splice(i, 1)[0]); markDirty(); renderPhotos(); renderSeo(); }));
      $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { st.photos.splice(+b.dataset.rm, 1); markDirty(); renderPhotos(); renderSeo(); }));
      const up = $('[data-upload]', box);
      if (up) up.addEventListener('change', async () => {
        const files = Array.from(up.files || []).slice(0, 10);
        if (!files.length) return;
        const label = $('[data-uploadlabel]', box);
        const folder = slugify(val('name')) || 'product';
        let done = 0;
        for (const f of files) {
          label.textContent = `Uploading ${done + 1} of ${files.length}…`;
          const blob = await shrinkImage(f);
          const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
          const { error } = await db.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
          if (error) { toast('Couldn’t upload ' + f.name + ': ' + error.message); continue; }
          st.photos.push(db.storage.from('product-images').getPublicUrl(path).data.publicUrl);
          done++;
        }
        if (done) { markDirty(); toast(`${done} photo${done > 1 ? 's' : ''} added — press Save to keep ${done > 1 ? 'them' : 'it'}`); }
        renderPhotos(); renderSeo();
      });
    }

    const OPTS = [['lengths', 'Lengths', 'e.g. 18″'], ['laces', 'Lace', 'e.g. 13×4 frontal'], ['densities', 'Density', 'e.g. 180%']];
    function renderOpts() {
      const box = $('[data-opts]', form);
      box.innerHTML = OPTS.map(([k, label, ph]) => `
        <div style="display:flex;flex-direction:column;gap:8px">
          <span style="font-size:14px;font-weight:600">${label}</span>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            ${(st[k] || []).map((v, i) => `<span style="display:inline-flex;align-items:center;gap:4px;min-height:36px;padding:0 6px 0 14px;border-radius:980px;background:#FFFFFF;border:1px solid rgba(0,0,0,.12);font-size:14px">${esc(v)}${canEdit ? `<button type="button" data-chiprm="${k}:${i}" aria-label="Remove ${esc(v)}" style="width:28px;height:28px;border:none;border-radius:980px;background:transparent;cursor:pointer;color:#6E6E73;font-size:16px;line-height:1">×</button>` : '&nbsp;'}</span>`).join('')}
            ${canEdit ? `<span style="display:inline-flex;gap:6px"><input data-chipin="${k}" placeholder="${ph}" aria-label="Add ${label.toLowerCase()}" maxlength="30" style="${UI.field};width:150px;min-height:36px"><button type="button" data-chipadd="${k}" style="${UI.small}">Add</button></span>` : ''}
          </div>
        </div>`).join('');
      $$('[data-chiprm]', box).forEach((b) => b.addEventListener('click', () => { const [k, i] = b.dataset.chiprm.split(':'); st[k].splice(+i, 1); markDirty(); renderOpts(); renderLengthPrices(); }));
      const add = (k) => {
        const inp = $(`[data-chipin="${k}"]`, box);
        let v = inp.value.trim();
        if (k === 'lengths' && /^\d+$/.test(v)) v += '″';
        if (k === 'densities' && /^\d+$/.test(v)) v += '%';
        if (!v || st[k].includes(v)) { inp.value = ''; return; }
        st[k].push(v);
        if (k === 'lengths') st[k].sort((a, b) => parseFloat(a) - parseFloat(b));
        markDirty(); renderOpts(); renderLengthPrices();
        $(`[data-chipin="${k}"]`, form).focus();
      };
      $$('[data-chipadd]', box).forEach((b) => b.addEventListener('click', () => add(b.dataset.chipadd)));
      $$('[data-chipin]', box).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(i.dataset.chipin); } }));
    }

    function renderLengthPrices() {
      const box = $('[data-lengthprices]', form);
      const base = val('price_ngn');
      box.innerHTML = (st.lengths || []).length ? st.lengths.map((L) => `<label style="${UI.label}">${esc(L)}<input type="number" min="0" step="500" inputmode="numeric" data-lp="${esc(L)}" value="${st.length_prices[L] ?? ''}" placeholder="${base ? '₦' + Number(base).toLocaleString('en-NG') : 'Main price'}" ${canEdit ? '' : 'disabled'} style="${UI.field}"></label>`).join('')
        : `<p style="margin:0;${UI.hint}">Add lengths above to price them separately.</p>`;
      $$('[data-lp]', box).forEach((i) => i.addEventListener('input', () => {
        const n = parseInt(i.value, 10);
        if (n > 0) st.length_prices[i.dataset.lp] = n; else delete st.length_prices[i.dataset.lp];
        markDirty();
      }));
    }

    function renderSeo() {
      const name = val('name') || 'Product title';
      const desc = (val('description') || 'Add a description to show here.').slice(0, 155);
      $('[data-seo]', form).innerHTML = `<span style="font-size:13px;color:#1E5B34">houseoflovethhair.com › product › ${esc(id ? p.slug : slugify(name) || 'new-product')}</span>
        <span style="font-size:18px;color:#1F4A7A">${esc(name)} | House of Loveth Hair</span><span style="font-size:14px;color:#3A3A3C;line-height:1.45">${esc(desc)}</span>`;
    }

    renderPhotos(); renderOpts(); renderLengthPrices(); renderSeo(); activeHint();
    if (!canEdit) $$('input, textarea, select', form).forEach((el) => { el.disabled = true; });
    form.addEventListener('input', (e) => {
      if (e.target.matches('[data-chipin], [data-upload], [data-lp]')) return;
      if (e.target.name === 'focus') { st.image_position = `center ${e.target.value}%`; const img = $('[data-photos] img', form); if (img) img.style.objectPosition = st.image_position; }
      if (e.target.name === 'price_ngn') renderLengthPrices();
      if (e.target.name === 'active') activeHint();
      if (['name', 'description'].includes(e.target.name)) renderSeo();
      markDirty();
    });
    form.addEventListener('change', (e) => { if (e.target.name === 'active') { activeHint(); markDirty(); } if (e.target.tagName === 'SELECT') markDirty(); });
    if (discardBtn) discardBtn.addEventListener('click', () => { dirty = false; location.reload(); });

    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const name = val('name');
      const price = parseInt(val('price_ngn'), 10);
      const active = $('[name="active"][value="1"]', form).checked;
      if (!name) { $('[name="name"]', form).focus(); toast('Please add a title'); return; }
      if (!(price > 0)) { $('[name="price_ngn"]', form).focus(); toast('Please add a price'); return; }
      if (active && !st.photos.length) { toast('Add at least one photo before making it active'); return; }
      const compare = parseInt(val('compare_at_ngn'), 10);
      const lp = {};
      (st.lengths || []).forEach((L) => { if (st.length_prices[L] > 0 && st.length_prices[L] !== price) lp[L] = st.length_prices[L]; });
      const row = {
        name, description: val('description') || null, price_ngn: price, compare_at_ngn: compare > 0 ? compare : null,
        stock: Math.max(0, parseInt(val('stock'), 10) || 0), sku: val('sku') || null, badge: val('badge') || null, active,
        category: val('category') || 'Wigs', style: val('style') || null, colour: val('colour') || null,
        lengths: st.lengths, laces: st.laces, densities: st.densities, length_prices: lp,
        image: st.photos[0] || null, images: st.photos.slice(1), image_position: st.image_position || 'center 35%',
      };
      saveBtn.classList.add('dh-busy');
      let res;
      if (id) res = await db.from('products').update(row).eq('id', id).select().maybeSingle();
      else {
        let slug = slugify(name) || 'product';
        const { data: taken } = await db.from('products').select('slug').like('slug', slug + '%');
        if ((taken || []).some((t) => t.slug === slug)) { let n = 2; while ((taken || []).some((t) => t.slug === `${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
        const { data: last } = await db.from('products').select('sort').order('sort', { ascending: false }).limit(1);
        res = await db.from('products').insert({ ...row, slug, sort: ((last && last[0] && last[0].sort) || 0) + 1 }).select().maybeSingle();
      }
      saveBtn.classList.remove('dh-busy');
      if (res.error || !res.data) { toast('Couldn’t save: ' + ((res.error && res.error.message) || 'please try again')); return; }
      dirty = false;
      toast(id ? `${name} saved — the shop updates right away` : `${name} added`);
      if (!id) { location.replace('/admin/product-edit?id=' + res.data.id); return; }
      statusEl.textContent = 'All changes saved'; statusEl.style.color = '#1E5B34';
      if (discardBtn) discardBtn.hidden = true;
      setTitle(name, 'Products <span aria-hidden="true">/</span> Edit');
    });

    const del = $('[data-delete]', body);
    if (del) del.addEventListener('click', async () => {
      if (!confirm(`Delete ${p.name}? This can’t be undone. Past orders keep their details.`)) return;
      del.classList.add('dh-busy');
      const { error } = await db.from('products').delete().eq('id', id);
      del.classList.remove('dh-busy');
      if (error) { toast('Couldn’t delete: ' + error.message); return; }
      dirty = false;
      toast(`${p.name} deleted`);
      location.replace('/admin/products');
    });
  }

  /* ======================= ADMIN: staff ======================= */
  async function initAdminStaff() {
    const body = adminBody();
    if (!canDo('staff')) { body.innerHTML = noAccess('Only the owner can manage staff accounts.'); return; }
    const call = async (payload) => {
      const { data, error } = await db.functions.invoke('staff-admin', { body: payload });
      const msg = await fnError(error, data);
      if (msg) { toast(msg); return null; }
      return data;
    };
    const inviteMsg = (s, link) => `Hi ${String(s.full_name || '').split(' ')[0] || 'there'}, you’ve been added to the Dream Hair by Loveth store admin as ${ROLE_NAMES[s.access]}. Set your password here (the link works once and expires in 48 hours): ${link}`;
    function showLink(s, res) {
      const d = dialog(`
        <h2 style="${UI.h2};font-size:24px">Invite ready</h2>
        <p style="margin:8px 0 0;font-size:15px;line-height:1.5">${res.emailed ? `We’ve emailed the invite to <strong>${esc(s.email)}</strong>. You can also send it on WhatsApp.` : `Send this link to <strong>${esc(s.full_name)}</strong>. ${res.email_ready ? 'The email didn’t go through, so share it yourself.' : 'Email isn’t connected yet, so share it on WhatsApp or copy it.'}`}</p>
        <div style="display:flex;gap:8px;margin-top:16px"><input readonly value="${esc(res.link)}" aria-label="Invite link" style="${UI.field};font-size:13px" data-linkfield><button type="button" data-copy style="${UI.btn2}">Copy</button></div>
        <p style="margin:10px 0 0;${UI.hint}">It works once and expires in 48 hours. They choose their own password; you never see it.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:20px">
          ${s.phone ? `<a href="${wa(s.phone)}?text=${encodeURIComponent(inviteMsg(s, res.link))}" target="_blank" rel="noopener" style="${UI.btn}">Send on WhatsApp</a>` : `<a href="https://wa.me/?text=${encodeURIComponent(inviteMsg(s, res.link))}" target="_blank" rel="noopener" style="${UI.btn}">Share on WhatsApp</a>`}
          <button type="button" data-close style="${UI.btn2}">Done</button>
        </div>`);
      $('[data-copy]', d).addEventListener('click', async () => {
        const f = $('[data-linkfield]', d);
        try { await navigator.clipboard.writeText(f.value); toast('Link copied'); } catch { f.select(); document.execCommand('copy'); toast('Link copied'); }
      });
    }

    async function render() {
      const [{ data: staff = [] }, { data: activity = [] }] = await Promise.all([
        db.from('staff').select('*').order('created_at'),
        db.from('staff_activity').select('*').order('created_at', { ascending: false }).limit(25),
      ]);
      const n = (s) => staff.filter((x) => x.status === s).length;
      const recent = staff.filter((x) => x.last_seen_at && Date.now() - new Date(x.last_seen_at).getTime() < 7 * 864e5).length;
      const stat = (label, value, sub) => `<div class="glass-light" style="border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:6px"><span style="font-size:14px;color:#6E6E73;font-weight:600">${label}</span><span style="font-size:32px;font-weight:600;letter-spacing:-0.02em">${value}</span><span style="${UI.hint}">${sub}</span></div>`;
      const me = (db.auth && (await db.auth.getUser()).data.user) || {};
      const statusPill = (x) => x.status === 'active' ? pill('active') : x.status === 'invited' ? pill('unpaid').replace('Awaiting payment', 'Invited') : pill('cancelled').replace('Cancelled', 'Suspended');
      body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <p style="margin:0;${UI.hint};font-size:15px;max-width:620px">Give each person their own login with only the access they need. Invites are links they open to set their own password.</p>
          <button type="button" data-add style="${UI.btn}">Add staff</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:16px">
          ${stat('Staff accounts', staff.length, `${n('active')} active · ${n('invited')} invited · ${n('suspended')} suspended`)}
          ${stat('Active this week', recent, 'Signed in to the admin in the last 7 days')}
          ${stat('Waiting to join', n('invited'), n('invited') ? 'Invite links expire after 48 hours' : 'No pending invites')}
        </div>
        ${card(`<h2 style="${UI.h2}">Team</h2>
          <div style="overflow-x:auto;margin:0 -8px"><table class="dh-stack" style="width:100%;border-collapse:collapse;min-width:680px">
            <thead><tr><th style="${UI.th}">Staff member</th><th style="${UI.th}">Role</th><th style="${UI.th}">Status</th><th style="${UI.th}">Last seen</th><th style="${UI.th};text-align:right">Actions</th></tr></thead>
            <tbody>${staff.map((x) => {
              const self = x.user_id === me.id;
              const nm = x.full_name || (x.email || '').split('@')[0];
              return `<tr data-uid="${x.user_id}">
                <td style="${UI.td}"><span style="display:flex;align-items:center;gap:10px">${avatar({ first_name: nm.split(' ')[0], last_name: nm.split(' ')[1] || '' })}<span style="display:flex;flex-direction:column;gap:1px;min-width:0"><span style="font-weight:600">${esc(nm)}${self ? ' <span style="font-weight:400;color:#6E6E73">(you)</span>' : ''}</span><span style="font-size:13px;color:#6E6E73;overflow-wrap:anywhere">${esc(x.email || '')}${x.phone ? ' · ' + esc(x.phone) : ''}</span></span></span></td>
                <td style="${UI.td}">${self ? esc(ROLE_NAMES[x.access]) : `<select data-role aria-label="Role for ${esc(nm)}" style="${UI.field};min-height:38px;width:auto">${Object.keys(ROLE_NAMES).map((r) => `<option value="${r}" ${x.access === r ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`).join('')}</select>`}</td>
                <td style="${UI.td}">${statusPill(x)}</td>
                <td style="${UI.td};color:#6E6E73;font-size:14px;white-space:nowrap">${x.status === 'invited' ? 'Invited ' + ago(x.invited_at).toLowerCase().replace('online now', 'just now') : ago(x.last_seen_at)}</td>
                <td style="${UI.td};text-align:right"><span style="display:inline-flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${self ? '' : [
                  x.status === 'invited' ? `<button type="button" data-act="resend" style="${UI.small}">New invite link</button>` : '',
                  x.status === 'active' ? `<button type="button" data-act="suspend" style="${UI.small}">Suspend</button>` : '',
                  x.status === 'suspended' ? `<button type="button" data-act="reactivate" style="${UI.small}">Reactivate</button>` : '',
                  `<button type="button" data-act="remove" style="${UI.small};color:#8A1F35">Remove</button>`].join('')}</span></td></tr>`;
            }).join('')}</tbody></table></div>`)}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,560px),1fr));gap:24px;align-items:start">
          ${card(`<h2 style="${UI.h2}">Roles & permissions</h2>
            <div style="overflow-x:auto;margin:0 -8px"><table style="width:100%;border-collapse:collapse;min-width:520px">
              <thead><tr><th style="${UI.th}">Area</th>${Object.values(ROLE_NAMES).map((r) => `<th style="${UI.th}">${r.replace(' & customer care', '')}</th>`).join('')}</tr></thead>
              <tbody>${AREAS.map(([k, label]) => `<tr><td style="${UI.td};font-size:14px">${label}</td>${Object.keys(ROLE_NAMES).map((r) => {
                const a = roleAccess(r, k);
                return `<td style="${UI.td};font-size:13px;white-space:nowrap">${a === 'full' ? '<span style="color:#1E5B34;font-weight:600">● Full</span>' : a === 'view' ? '<span style="color:#8A4B0F">◐ View</span>' : '<span style="color:#A1A1A6">○ None</span>'}</td>`;
              }).join('')}</tr>`).join('')}</tbody></table></div>
            <p style="margin:0;${UI.hint}">The database enforces these, so a role can’t get around them.</p>`)}
          ${card(`<h2 style="${UI.h2}">Staff activity</h2>
            ${activity.length ? `<ol style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column">${activity.map((a) => `<li style="padding:10px 0;border-top:1px solid rgba(0,0,0,.06);font-size:15px;line-height:1.45"><strong>${esc(a.actor || 'Someone')}</strong> ${esc(a.action)} ${a.target_url ? `<a href="${esc(a.target_url)}" style="color:#6E1A2C;font-weight:600;text-decoration:none">${esc(a.target || '')}</a>` : `<strong>${esc(a.target || '')}</strong>`}<div style="${UI.hint}">${fmtDateTime(a.created_at)}</div></li>`).join('')}</ol>`
              : `<p style="margin:0;${UI.hint};font-size:15px">Order, product and staff changes appear here.</p>`}`)}
        </div>`;

      $('[data-add]', body).addEventListener('click', openInvite);
      $$('tr[data-uid]', body).forEach((tr) => {
        const s = staff.find((x) => x.user_id === tr.dataset.uid);
        const role = $('[data-role]', tr);
        if (role) role.addEventListener('change', async () => {
          if (role.value === 'owner' && !confirm(`Make ${s.full_name || s.email} an owner? Owners can manage staff and payments.`)) { role.value = s.access; return; }
          if (await call({ action: 'update', user_id: s.user_id, access: role.value })) { toast(`${s.full_name || s.email} is now ${ROLE_NAMES[role.value]}`); render(); } else role.value = s.access;
        });
        $$('[data-act]', tr).forEach((b) => b.addEventListener('click', async () => {
          const who = s.full_name || s.email;
          const act = b.dataset.act;
          if (act === 'remove' && !confirm(`Remove ${who} from the team? They’ll lose access straight away.`)) return;
          if (act === 'suspend' && !confirm(`Suspend ${who}? They won’t be able to use the admin until you reactivate them.`)) return;
          b.classList.add('dh-busy');
          const res = await call(act === 'resend' ? { action: 'resend', user_id: s.user_id }
            : act === 'remove' ? { action: 'remove', user_id: s.user_id }
            : { action: 'update', user_id: s.user_id, status: act === 'suspend' ? 'suspended' : 'active' });
          b.classList.remove('dh-busy');
          if (!res) return;
          if (act === 'resend') showLink(s, res);
          else toast(act === 'remove' ? `${who} removed` : act === 'suspend' ? `${who} suspended` : `${who} reactivated`);
          render();
        }));
      });
    }

    function openInvite() {
      const d = dialog(`
        <form data-invite style="display:flex;flex-direction:column;gap:16px">
          <div><h2 style="${UI.h2};font-size:24px">Add a staff member</h2><p style="margin:6px 0 0;${UI.hint};font-size:15px">They’ll get a secure link to set their own password. You never see or share it.</p></div>
          ${fieldHtml('full_name', 'Full name', '', 'required maxlength="100" autocomplete="off"')}
          ${fieldHtml('email', 'Work email', '', 'type="email" required maxlength="254" autocomplete="off"', 'They sign in with this.')}
          ${fieldHtml('phone', 'Phone (WhatsApp)', '', 'type="tel" maxlength="40" autocomplete="off"', 'Optional. Lets you send the invite on WhatsApp.')}
          <fieldset style="border:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px"><legend style="font-size:14px;font-weight:600;padding:0 0 8px">Role</legend>
            ${['manager', 'sales', 'inventory', 'owner'].map((r, i) => `<label style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:14px;border:1px solid rgba(0,0,0,.1);background:#FFFFFF;cursor:pointer"><input type="radio" name="access" value="${r}" ${i === 0 ? 'checked' : ''} style="accent-color:#6E1A2C;margin-top:3px;width:18px;height:18px"><span style="display:flex;flex-direction:column;gap:2px"><span style="font-weight:600">${ROLE_NAMES[r]}</span><span style="${UI.hint}">${ROLE_INFO[r]}</span></span></label>`).join('')}
          </fieldset>
          <p data-err class="dh-error" role="alert" hidden></p>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="submit" style="${UI.btn}">Create account & get invite link</button><button type="button" data-close style="${UI.btn2}">Cancel</button></div>
        </form>`);
      const f = $('[data-invite]', d);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = Object.fromEntries(new FormData(f));
        const btn = $('button[type=submit]', f);
        const err = $('[data-err]', f);
        err.hidden = true;
        btn.classList.add('dh-busy');
        const { data, error } = await db.functions.invoke('staff-admin', { body: { action: 'invite', ...fd } });
        btn.classList.remove('dh-busy');
        const msg = await fnError(error, data);
        if (msg) { err.textContent = msg; err.hidden = false; return; }
        d.close();
        showLink({ full_name: fd.full_name, email: fd.email, phone: fd.phone, access: fd.access }, data);
        render();
      });
    }
    await render();
  }

  /* ======================= ADMIN: discounts ======================= */
  async function initAdminDiscounts() {
    const body = adminBody();
    if (!canDo('discounts', false)) { body.innerHTML = noAccess(); return; }
    const canEdit = canDo('discounts');
    const label = (d) => d.kind === 'percent' ? `${d.value}% off` : `${naira(d.value)} off`;
    const state = (d) => {
      const now = Date.now();
      if (!d.active) return ['draft', 'Off'];
      if (d.starts_at && new Date(d.starts_at).getTime() > now) return ['processing', 'Scheduled'];
      if (d.ends_at && new Date(d.ends_at).getTime() < now) return ['cancelled', 'Ended'];
      if (d.max_uses && d.uses >= d.max_uses) return ['cancelled', 'Used up'];
      return ['active', 'Active'];
    };
    async function render() {
      const [{ data: list = [], error }, { data: orders = [] }] = await Promise.all([
        db.from('discounts').select('*').order('created_at', { ascending: false }),
        db.from('orders').select('discount_code, discount_ngn, total_ngn, status').not('discount_code', 'is', null),
      ]);
      if (error) { body.innerHTML = card(`<p style="margin:0">Couldn’t load discounts: ${esc(error.message)}</p>`); return; }
      const sales = {};
      orders.filter((o) => o.status !== 'cancelled').forEach((o) => { const s = sales[o.discount_code] || (sales[o.discount_code] = { n: 0, given: 0, total: 0 }); s.n++; s.given += o.discount_ngn; s.total += o.total_ngn; });
      body.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <p style="margin:0;${UI.hint};font-size:15px;max-width:620px">Codes shoppers type at checkout. Feature one to show it in the announcement bar at the top of the shop.</p>
          ${canEdit ? `<button type="button" data-new style="${UI.btn}">Create discount</button>` : ''}
        </div>
        ${card(`<h2 style="${UI.h2}">Discount codes</h2>
          ${list.length ? `<div style="overflow-x:auto;margin:0 -8px"><table class="dh-stack" style="width:100%;border-collapse:collapse;min-width:720px">
            <thead><tr><th style="${UI.th}">Code</th><th style="${UI.th}">Discount</th><th style="${UI.th}">Conditions</th><th style="${UI.th}">Used</th><th style="${UI.th}">Sales</th><th style="${UI.th}">Status</th><th style="${UI.th};text-align:right">${canEdit ? 'Actions' : ''}</th></tr></thead>
            <tbody>${list.map((d) => {
              const [k, txt] = state(d);
              const cond = [d.min_subtotal_ngn ? `Bag over ${naira(d.min_subtotal_ngn)}` : '', d.first_order_only ? 'First order only' : '',
                d.starts_at ? `From ${fmtDate(d.starts_at)}` : '', d.ends_at ? `Until ${fmtDate(d.ends_at)}` : ''].filter(Boolean).join(' · ') || 'Any order';
              const s = sales[d.code];
              return `<tr data-id="${d.id}"><td style="${UI.td}"><span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><code style="font-size:15px;font-weight:700;letter-spacing:.04em">${esc(d.code)}</code>${d.featured ? '<span style="padding:2px 8px;border-radius:980px;background:#F6E3E1;color:#6E1A2C;font-size:11px;font-weight:600">In announcement bar</span>' : ''}</span></td>
                <td style="${UI.td};white-space:nowrap">${label(d)}</td><td style="${UI.td};font-size:14px;color:#3A3A3C">${cond}</td>
                <td style="${UI.td};white-space:nowrap">${d.uses}${d.max_uses ? ` of ${d.max_uses}` : ''}</td>
                <td style="${UI.td};font-size:14px;white-space:nowrap">${s ? `${naira(s.total)}<div style="${UI.hint}">${naira(s.given)} off · ${s.n} order${s.n > 1 ? 's' : ''}</div>` : '<span style="color:#A1A1A6">—</span>'}</td>
                <td style="${UI.td}">${pill(k).replace(/>[^<]*<\/span>$/, `>${txt}</span>`)}</td>
                <td style="${UI.td};text-align:right">${canEdit ? `<span style="display:inline-flex;gap:6px"><button type="button" data-edit style="${UI.small}">Edit</button><button type="button" data-toggle style="${UI.small}">${d.active ? 'Turn off' : 'Turn on'}</button><button type="button" data-del style="${UI.small};color:#8A1F35">Delete</button></span>` : ''}</td></tr>`;
            }).join('')}</tbody></table></div>`
            : `<p style="margin:0;${UI.hint};font-size:15px">No discount codes yet.${canEdit ? ' Create one for your first-order offer, a sale or a loyal customer.' : ''}</p>`}`)}`;
      const nb = $('[data-new]', body);
      if (nb) nb.addEventListener('click', () => edit(null));
      $$('tr[data-id]', body).forEach((tr) => {
        const d = list.find((x) => x.id === tr.dataset.id);
        const e = $('[data-edit]', tr); if (e) e.addEventListener('click', () => edit(d));
        const t = $('[data-toggle]', tr); if (t) t.addEventListener('click', async () => {
          const { error: er } = await db.from('discounts').update({ active: !d.active }).eq('id', d.id);
          if (er) toast('Couldn’t save: ' + er.message); else { toast(`${d.code} turned ${d.active ? 'off' : 'on'}`); render(); }
        });
        const x = $('[data-del]', tr); if (x) x.addEventListener('click', async () => {
          if (!confirm(`Delete ${d.code}? Shoppers won’t be able to use it. Past orders keep their discount.`)) return;
          const { error: er } = await db.from('discounts').delete().eq('id', d.id);
          if (er) toast('Couldn’t delete: ' + er.message); else { toast(`${d.code} deleted`); render(); }
        });
      });
    }
    function edit(d) {
      const v = d || { code: '', kind: 'percent', value: 10, min_subtotal_ngn: 0, first_order_only: false, featured: false, max_uses: null, starts_at: null, ends_at: null, active: true };
      const day = (t) => t ? new Date(t).toISOString().slice(0, 10) : '';
      const dlg = dialog(`
        <form data-disc style="display:flex;flex-direction:column;gap:16px">
          <h2 style="${UI.h2};font-size:24px">${d ? 'Edit discount' : 'Create discount'}</h2>
          <label style="${UI.label}">Code<span style="${UI.hint}">Letters and numbers. Shoppers type this at checkout.</span>
            <span style="display:flex;gap:8px"><input name="code" required pattern="[A-Za-z0-9_-]{3,24}" maxlength="24" value="${esc(v.code)}" style="${UI.field};text-transform:uppercase;letter-spacing:.04em;font-weight:600"><button type="button" data-gen style="${UI.btn2}">Generate</button></span></label>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            <label style="${UI.label}">Type<select name="kind" style="${UI.field}"><option value="percent" ${v.kind === 'percent' ? 'selected' : ''}>Percentage off</option><option value="fixed" ${v.kind === 'fixed' ? 'selected' : ''}>Naira amount off</option></select></label>
            ${fieldHtml('value', '<span data-vlabel>Amount</span>', v.value, 'type="number" min="1" step="1" required inputmode="numeric"')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            ${fieldHtml('min_subtotal_ngn', 'Minimum bag (₦)', v.min_subtotal_ngn || '', 'type="number" min="0" step="1000" inputmode="numeric" placeholder="None"')}
            ${fieldHtml('max_uses', 'Use limit', v.max_uses || '', 'type="number" min="1" step="1" inputmode="numeric" placeholder="Unlimited"')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
            ${fieldHtml('starts_at', 'Starts', day(v.starts_at), 'type="date"')}
            ${fieldHtml('ends_at', 'Ends', day(v.ends_at), 'type="date"', '')}
          </div>
          <label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;cursor:pointer"><input type="checkbox" name="first_order_only" ${v.first_order_only ? 'checked' : ''} style="accent-color:#6E1A2C;width:18px;height:18px;margin-top:2px"><span>First order only<span style="display:block;${UI.hint}">Checked against the shopper’s email.</span></span></label>
          <label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;cursor:pointer"><input type="checkbox" name="featured" ${v.featured ? 'checked' : ''} style="accent-color:#6E1A2C;width:18px;height:18px;margin-top:2px"><span>Show in the announcement bar<span style="display:block;${UI.hint}">Replaces any other featured code.</span></span></label>
          <label style="display:flex;gap:10px;align-items:center;font-size:15px;cursor:pointer"><input type="checkbox" name="active" ${v.active ? 'checked' : ''} style="accent-color:#6E1A2C;width:18px;height:18px">Turned on</label>
          <p data-err class="dh-error" role="alert" hidden></p>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="submit" style="${UI.btn}">${d ? 'Save' : 'Create discount'}</button><button type="button" data-close style="${UI.btn2}">Cancel</button></div>
        </form>`);
      const f = $('[data-disc]', dlg);
      const kind = $('[name="kind"]', f);
      const vl = () => { $('[data-vlabel]', f).textContent = kind.value === 'percent' ? 'Percent off (1–90)' : 'Naira off (₦)'; $('[name="value"]', f).max = kind.value === 'percent' ? 90 : ''; };
      kind.addEventListener('change', vl); vl();
      $('[data-gen]', f).addEventListener('click', () => { $('[name="code"]', f).value = 'LOVETH' + Math.random().toString(36).slice(2, 6).toUpperCase(); });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        const err = $('[data-err]', f);
        const n = (k) => parseInt(fd.get(k), 10);
        const row = {
          code: String(fd.get('code')).trim().toUpperCase(), kind: fd.get('kind'), value: n('value'),
          min_subtotal_ngn: n('min_subtotal_ngn') > 0 ? n('min_subtotal_ngn') : 0, max_uses: n('max_uses') > 0 ? n('max_uses') : null,
          starts_at: fd.get('starts_at') ? new Date(fd.get('starts_at') + 'T00:00:00').toISOString() : null,
          ends_at: fd.get('ends_at') ? new Date(fd.get('ends_at') + 'T23:59:59').toISOString() : null,
          first_order_only: fd.get('first_order_only') === 'on', featured: fd.get('featured') === 'on', active: fd.get('active') === 'on',
        };
        if (row.kind === 'percent' && (row.value < 1 || row.value > 90)) { err.textContent = 'Use a percentage between 1 and 90.'; err.hidden = false; return; }
        if (row.starts_at && row.ends_at && row.ends_at < row.starts_at) { err.textContent = 'The end date is before the start date.'; err.hidden = false; return; }
        const btn = $('button[type=submit]', f);
        btn.classList.add('dh-busy');
        if (row.featured) await db.from('discounts').update({ featured: false }).eq('featured', true).neq('code', row.code);
        const res = d ? await db.from('discounts').update(row).eq('id', d.id) : await db.from('discounts').insert(row);
        btn.classList.remove('dh-busy');
        if (res.error) {
          err.textContent = /duplicate|unique/i.test(res.error.message) ? 'That code already exists.' : /code_check|discounts_code/.test(res.error.message) ? 'Use 3–24 letters or numbers.' : res.error.message;
          err.hidden = false; return;
        }
        dlg.close();
        toast(d ? `${row.code} saved` : `${row.code} created`);
        render();
      });
    }
    await render();
  }

  /* ======================= ADMIN: content ======================= */
  const CONTENT = [
    ['Contact details', 'Shown in the footer, help page and product pages.', [
      ['whatsapp', 'WhatsApp number', 'e.g. 0803 123 4567', 'input'], ['email', 'Email address', 'e.g. hello@houseoflovethhair.com', 'input'],
      ['instagram', 'Instagram handle', 'without the @', 'input'], ['tiktok', 'TikTok handle', 'without the @', 'input'],
      ['hours', 'Opening hours', 'e.g. Mon–Sat, 9am–7pm', 'input']]],
    ['Delivery, returns & payment', 'Shown at checkout, on product pages and on the help page.', [
      ['delivery_time', 'Usual delivery time', 'e.g. 2–4 working days', 'input'], ['pickup', 'Pick-up location', 'e.g. 12 Admiralty Way, Lekki, Lagos', 'input'],
      ['payment_methods', 'How customers can pay', 'e.g. Bank transfer · Pay on pick-up', 'input'],
      ['delivery_areas', 'Delivery areas and times', 'Where you deliver and how long it takes', 'area'], ['returns', 'Returns policy', 'What can be returned, and how', 'area']]],
    ['Product details', 'The same on every product page.', [
      ['hair_type', 'Hair type / origin', 'e.g. 100% human hair, Vietnamese', 'input'], ['lace_details', 'Lace details', 'e.g. HD lace, pre-plucked hairline', 'input'],
      ['cap_sizes', 'Cap sizes', 'e.g. Medium (22.5″), adjustable straps', 'input'], ['care_tips', 'Wig care tips', 'Washing, styling and storing', 'area']]],
    ['Our story', 'The About page.', [
      ['story', 'Your story', 'How Dream Hair by Loveth started and what makes your wigs special', 'area'], ['promise', 'Your promise', 'Your promise to your customers', 'area']]],
  ];
  async function initAdminContent() {
    const body = adminBody();
    if (!canDo('content', false)) { body.innerHTML = noAccess(); return; }
    const canEdit = canDo('content');
    const { data: rows = [] } = await db.from('site_content').select('*');
    const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const filled = CONTENT.flatMap((g) => g[2]).filter(([k]) => (v[k] || '').trim()).length;
    const total = CONTENT.flatMap((g) => g[2]).length;
    body.innerHTML = `
      <div class="dh-savebar glass-light" style="position:sticky;top:12px;z-index:5;border-radius:980px;padding:8px 8px 8px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span data-status style="flex:1;min-width:160px;font-size:15px;color:#6E6E73">${filled} of ${total} filled in. Empty ones show as [placeholders] in the shop.</span>
        ${canEdit ? `<button type="button" data-save style="${UI.btn}">Save content</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:24px;align-items:start">
        ${CONTENT.map(([title, sub, fields]) => card(`<div><h2 style="${UI.h2}">${title}</h2><p style="margin:4px 0 0;${UI.hint}">${sub}</p></div>
          ${fields.map(([k, label, ph, kind]) => kind === 'area'
            ? `<label style="${UI.label}">${label}<textarea name="${k}" maxlength="4000" placeholder="${esc(ph)}" style="${UI.area}">${esc(v[k] || '')}</textarea></label>`
            : fieldHtml(k, label, v[k] || '', `maxlength="300" placeholder="${esc(ph)}"`)).join('')}`)).join('')}
      </div>
      ${card(`<h2 style="${UI.h2}">Marketing tools</h2><p style="margin:0;${UI.hint}">Made from your products and this content.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <a href="/marketing/instagram" style="${UI.btn2}">Instagram post maker</a>
          <a href="/marketing/thank-you-card" style="${UI.btn2}">Printable thank-you card</a>
          <a href="/marketing/app-icon" style="${UI.btn2}">App icon & logo files</a>
        </div>`)}
      <p style="margin:0;${UI.hint}">The free-delivery amount and the discount in the announcement bar come from <a href="/admin/settings" style="color:#6E1A2C">Settings</a> and <a href="/admin/discounts" style="color:#6E1A2C">Discounts</a>.</p>`;
    if (!canEdit) { $$('input, textarea', body).forEach((el) => { el.disabled = true; }); return; }
    const status = $('[data-status]', body);
    body.addEventListener('input', () => { status.textContent = 'Unsaved changes'; status.style.color = '#8A4B0F'; });
    $('[data-save]', body).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const now = new Date().toISOString();
      const up = CONTENT.flatMap((g) => g[2]).map(([k]) => ({ key: k, value: ($(`[name="${k}"]`, body).value || '').trim().replace(/^@/, ''), updated_at: now }));
      btn.classList.add('dh-busy');
      const { error } = await db.from('site_content').upsert(up);
      btn.classList.remove('dh-busy');
      if (error) { toast('Couldn’t save: ' + error.message); return; }
      try { sessionStorage.removeItem('dh-content-v1'); } catch { /* ignore */ }
      const n = up.filter((r) => r.value).length;
      status.textContent = `Saved. ${n} of ${total} filled in.`; status.style.color = '#1E5B34';
      toast('Content saved — the shop updates right away');
    });
  }

  /* ======================= ADMIN: settings ======================= */
  async function initAdminSettings() {
    const body = adminBody();
    if (!canDo('settings', false)) { body.innerHTML = noAccess(); return; }
    const canEdit = canDo('settings');
    const [{ data: store }, { data: delivery = [] }] = await Promise.all([
      db.from('store_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('delivery_options').select('*').order('sort'),
    ]);
    body.innerHTML = `
      ${canEdit ? '' : `<p style="margin:0;${UI.hint};font-size:15px">You can see these settings. Only the owner can change them.</p>`}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:24px;align-items:start">
        ${card(`<h2 style="${UI.h2}">Free delivery</h2>
          ${fieldHtml('free_over', 'Free standard delivery on orders over (₦)', store && store.free_delivery_over_ngn != null ? store.free_delivery_over_ngn : '', 'type="number" min="0" step="1000" inputmode="numeric" placeholder="Off"', 'Leave empty to turn it off. Applied at checkout and shown in the announcement bar.')}
          ${canEdit ? `<button type="button" data-savefree style="${UI.btn};align-self:flex-start">Save</button>` : ''}`)}
        ${card(`<h2 style="${UI.h2}">Delivery options</h2><p style="margin:-8px 0 0;${UI.hint}">What shoppers choose from at checkout.</p>
          <div style="display:flex;flex-direction:column;gap:12px">${delivery.map((o) => `
            <div data-code="${esc(o.code)}" style="display:grid;grid-template-columns:minmax(0,1fr) 130px auto;gap:10px;align-items:end;padding:12px;border-radius:14px;background:rgba(255,255,255,.7)">
              <label style="${UI.label}">${esc(o.name)}<input name="detail" value="${esc(o.detail || '')}" maxlength="120" placeholder="e.g. 2–4 working days" style="${UI.field}"></label>
              <label style="${UI.label}">Fee (₦)<input name="fee" type="number" min="0" step="500" value="${o.fee_ngn}" style="${UI.field}"></label>
              <label style="display:flex;gap:8px;align-items:center;min-height:44px;font-size:14px;cursor:pointer"><input type="checkbox" name="on" ${o.active ? 'checked' : ''} style="accent-color:#6E1A2C;width:18px;height:18px">On</label>
            </div>`).join('')}</div>
          ${canEdit ? `<button type="button" data-savedelivery style="${UI.btn};align-self:flex-start">Save delivery options</button>` : ''}`)}
      </div>
      <div data-paycards style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:24px;align-items:start"></div>
      ${card(`<h2 style="${UI.h2}">Admin app</h2><p style="margin:0;${UI.hint};font-size:15px">Install the admin on your phone for one-tap access to orders.</p><a href="/app/install?app=admin" style="${UI.btn2};align-self:flex-start">Install on your phone</a>`)}`;
    if (!canEdit) $$('input', body).forEach((el) => { el.disabled = true; });
    const sf = $('[data-savefree]', body);
    if (sf) sf.addEventListener('click', async () => {
      const n = parseInt($('[name="free_over"]', body).value, 10);
      sf.classList.add('dh-busy');
      const { error } = await db.from('store_settings').update({ free_delivery_over_ngn: n >= 0 ? n : null, updated_at: new Date().toISOString() }).eq('id', 1);
      sf.classList.remove('dh-busy');
      try { sessionStorage.removeItem('dh-content-v1'); } catch { /* ignore */ }
      toast(error ? 'Couldn’t save: ' + error.message : n >= 0 ? `Free delivery over ${naira(n)}` : 'Free delivery turned off');
    });
    const sd = $('[data-savedelivery]', body);
    if (sd) sd.addEventListener('click', async () => {
      sd.classList.add('dh-busy');
      const results = await Promise.all($$('[data-code]', body).map((row) => db.from('delivery_options').update({
        detail: $('[name="detail"]', row).value.trim() || null, fee_ngn: Math.max(0, parseInt($('[name="fee"]', row).value, 10) || 0), active: $('[name="on"]', row).checked,
      }).eq('code', row.dataset.code)));
      sd.classList.remove('dh-busy');
      const bad = results.find((r) => r.error);
      toast(bad ? 'Couldn’t save: ' + bad.error.message : 'Delivery options saved');
    });
    const host = $('[data-paycards]', body);
    await renderPaymentsCard(host);
    await renderAlertsCard(host);
  }

  /* ======================= ADMIN: welcome (accept an invite) ======================= */
  async function initAdminWelcome() {
    const form = $('form');
    const token = new URLSearchParams(location.search).get('t') || '';
    if (!form) return;
    form.removeAttribute('onsubmit');
    const { data, error } = await db.functions.invoke('staff-admin', { body: { action: 'peek', token } });
    const msg = await fnError(error, data);
    if (msg) {
      form.innerHTML = `<h1 style="margin:0;font-size:35px;font-weight:600;letter-spacing:-0.022em">Invite link expired</h1><p style="margin:0;font-size:15px;color:#6E6E73;line-height:1.5">${esc(msg)}</p><a href="/admin/login" style="${UI.btn2};align-self:flex-start">Go to staff sign in</a>`;
      return;
    }
    form.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px"><h1 style="margin:0;font-size:35px;font-weight:600;letter-spacing:-0.022em">Welcome, ${esc(String(data.full_name || '').split(' ')[0] || 'there')}</h1>
        <p style="margin:0;font-size:15px;color:#6E6E73;line-height:1.5">You’ve been added to the store admin as <strong style="color:#1D1D1F">${esc(data.role)}</strong>. Choose a password for <strong style="color:#1D1D1F">${esc(data.email)}</strong>.</p></div>
      <input type="email" autocomplete="username" value="${esc(data.email)}" hidden>
      ${fieldHtml('password', 'New password', '', 'type="password" autocomplete="new-password" minlength="10" required', 'At least 10 characters.')}
      ${fieldHtml('password2', 'Type it again', '', 'type="password" autocomplete="new-password" minlength="10" required')}
      <button type="submit" style="${UI.btn};min-height:50px">Set password and sign in</button>`;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('[name="password"]', form); const pw2 = $('[name="password2"]', form);
      const btn = $('button[type=submit]', form);
      showError(btn, '');
      if (!pw.checkValidity()) { pw.reportValidity(); return; }
      if (pw.value !== pw2.value) { showError(btn, 'The two passwords don’t match.'); return; }
      btn.classList.add('dh-busy');
      const r = await db.functions.invoke('staff-admin', { body: { action: 'accept', token, password: pw.value } });
      const m = await fnError(r.error, r.data);
      if (m) { btn.classList.remove('dh-busy'); showError(btn, m); return; }
      const { error: se } = await db.auth.signInWithPassword({ email: r.data.email, password: pw.value });
      btn.classList.remove('dh-busy');
      if (se) { showError(btn, 'Your password is set. Please sign in.'); setTimeout(() => { location.href = '/admin/login'; }, 1500); return; }
      location.href = '/admin';
    });
  }

  /* ======================= start ======================= */
  async function start() {
    try {
      if (!page.startsWith('admin')) {
        initMenu();
        updateBagBadge();
        initForms();
        const syncing = wl.sync().catch(() => {});
        try {
          if (!db) return;
          await syncing;
          if (page === 'app-install') return initInstallPage();
          if (page.startsWith('marketing-')) return await initMarketing();
          if (page === 'checkout') return await initCheckout();
          if (page === 'order-confirmed') return await initConfirmed();
          if (page === 'account') return await initAccountPage();
          const products = await loadProducts();
          if (page === 'product') return initProductPage(products);
          if (page === 'bag') return initBagPage(products);
          if (['home', 'shop'].includes(page)) return renderProductGrids(products);
          return;
        } finally {
          paintWish();
          initMotion();
          applyContent();
        }
      }
      if (!db) return;
      if (page === 'admin-login') return initAdminLogin();
      if (page === 'admin-welcome') return initAdminWelcome();
      const user = await requireStaff();
      if (!user) return;
      initAdminChrome(user);
      const init = {
        'admin-orders': initAdminOrders, 'admin-dashboard': initAdminDashboard, 'admin-products': initAdminProducts, 'admin-customers': initAdminCustomers,
        'admin-product-edit': initAdminProductEdit, 'admin-staff': initAdminStaff, 'admin-discounts': initAdminDiscounts,
        'admin-content': initAdminContent, 'admin-settings': initAdminSettings,
      }[page];
      try { if (init && !document.body.dataset.denied) await init(); } finally { document.body.classList.add('dh-auth'); initMotion(); }
    } catch (err) {
      console.error(err);
      toast('Something went wrong loading this page. Please refresh.');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
