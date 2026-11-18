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
      const found = items.find((i) => i.slug === p.slug && i.options === options);
      if (found) found.quantity = Math.min(20, found.quantity + qty);
      else items.push({ slug: p.slug, name: p.name, price: p.price_ngn, image: p.image, position: p.image_position, options, quantity: qty });
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
    document.addEventListener('click', (e) => { if (!header.contains(e.target)) setOpen(false); });
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
    if (price) price.textContent = naira(p.price_ngn);
    const sub = leaf(card, /\[LENGTH\]|·/);
    if (sub && sub !== price) sub.textContent = [p.style, p.laces[0]].filter(Boolean).join(' · ');
    const wish = $('button[aria-label^="Save"]', card);
    if (wish) wish.setAttribute('aria-label', `Save ${p.name} to wishlist`);
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
    if (priceRow) {
      const spans = $$('span', priceRow);
      if (spans[0]) spans[0].textContent = naira(p.price_ngn);
      if (spans[1]) spans[1].textContent = 'SKU ' + p.slug.toUpperCase();
    }
    const desc = $$('p', info).find((x) => x.closest('div') === h1.closest('div').parentElement || x.parentElement === info);
    if (desc) desc.textContent = p.description || '';
    $$('img[src^="/images/"]').filter((i) => !i.closest('article')).forEach((img) => {
      if (img.closest('header, footer')) return;
      img.src = p.image; img.alt = p.name; img.style.objectPosition = p.image_position || 'center';
    });
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
        });
        sync();
        group.appendChild(b);
      });
      if (valueEl) valueEl.textContent = selected[label];
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
    $$('button').filter((b) => text(b) === 'Apply').forEach((b) => b.addEventListener('click', () => toast('Discount codes are coming soon')));
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
    const refresh = () => {
      const opt = delivery.find((d) => d.code === (ship.find((r) => r.checked) || {}).value);
      const fee = opt ? opt.fee_ngn : 0;
      if (subEl) subEl.textContent = naira(subtotal);
      if (delEl) delEl.textContent = fee ? naira(fee) : 'Free';
      if (totEl) totEl.textContent = naira(subtotal + fee);
      if (payBtn) payBtn.textContent = items.length ? `Place order · ${naira(subtotal + fee)}` : 'Your bag is empty';
      syncPickup();
    };
    ship.forEach((r) => r.addEventListener('change', refresh));
    refresh();
    $$('button').filter((b) => text(b) === 'Apply').forEach((b) => b.addEventListener('click', () => toast('Discount codes are coming soon')));

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
      };
      payBtn.classList.add('dh-busy');
      const label = payBtn.textContent;
      payBtn.textContent = 'Placing your order…';
      const { data, error } = await db.rpc('place_order', {
        customer, items: cart.get().map((i) => ({ slug: i.slug, quantity: i.quantity, options: i.options })),
      });
      payBtn.classList.remove('dh-busy');
      if (error) {
        payBtn.textContent = label;
        showError(payBtn, (error.message || 'Something went wrong.') + ' Please try again.');
        return;
      }
      try { sessionStorage.setItem('dh-last-order', JSON.stringify(data)); } catch { /* ignore */ }
      cart.set([]);
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
      totalPaid.textContent = o.delivery_fee_ngn ? `Total (incl. ${naira(o.delivery_fee_ngn)} delivery)` : 'Total';
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
    const { data: staff } = await db.from('staff').select('role').eq('user_id', session.user.id).maybeSingle();
    if (!staff) {
      await db.auth.signOut();
      location.replace('/admin/login?denied=1');
      return null;
    }
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
    const who = user && user.session.user.email;
    if (who) {
      const nameEl = leaf(aside || document, /^Loveth( Okafor)?$/);
      if (nameEl) nameEl.textContent = who.split('@')[0];
    }
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
    await renderPaymentsCard();

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

  async function renderPaymentsCard() {
    const revH = $$('h2').find((h) => text(h) === 'Revenue');
    const ref = revH && revH.closest('.glass-light');
    if (!ref) return;
    const card = document.createElement('section');
    card.className = 'glass-light';
    card.setAttribute('style', ref.getAttribute('style') || '');
    card.setAttribute('aria-labelledby', 'payments-title');
    ref.insertAdjacentElement('beforebegin', card);
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
        `<span style="display:flex;align-items:center;gap:12px"><img src="${esc(p.image)}" alt="" style="width:44px;height:52px;border-radius:10px;object-fit:cover;object-position:${esc(p.image_position || 'center')}"><span style="display:flex;flex-direction:column;gap:2px"><a href="${productUrl(p)}" target="_blank" rel="noopener" style="font-weight:600;text-decoration:none">${esc(p.name)}</a><span style="font-size:12px;color:#6E6E73">${esc(p.slug)}</span></span></span>`,
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

  /* ======================= start ======================= */
  async function start() {
    try {
      if (!page.startsWith('admin')) {
        initMenu();
        updateBagBadge();
        initForms();
        try {
          if (!db) return;
          if (page === 'checkout') return await initCheckout();
          if (page === 'order-confirmed') return await initConfirmed();
          const products = await loadProducts();
          if (page === 'product') return initProductPage(products);
          if (page === 'bag') return initBagPage(products);
          if (['home', 'shop'].includes(page)) return renderProductGrids(products);
          return;
        } finally {
          initMotion();
        }
      }
      if (!db) return;
      if (page === 'admin-login') return initAdminLogin();
      const user = await requireStaff();
      if (!user) return;
      initAdminChrome(user);
      const init = { 'admin-orders': initAdminOrders, 'admin-dashboard': initAdminDashboard, 'admin-products': initAdminProducts, 'admin-customers': initAdminCustomers }[page];
      try { if (init) await init(); } finally { document.body.classList.add('dh-auth'); initMotion(); }
    } catch (err) {
      console.error(err);
      toast('Something went wrong loading this page. Please refresh.');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
