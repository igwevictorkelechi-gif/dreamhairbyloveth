// Order alerts for Dream Hair by Loveth.
//
// The database queues a row in `notifications` for every alert (order placed,
// payment received, order shipped) and wakes this function. It claims due rows
// (claim_notifications), sends each one once, and records the result.
//
//   Email, store and customers:   Resend            RESEND_API_KEY, ALERT_FROM_EMAIL
//   WhatsApp to the store:        CallMeBot         CALLMEBOT_APIKEY (number set in admin)
//   WhatsApp to customers:        Meta Cloud API    WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
//                                                   + approved templates (see README)
//
// POST {action:"process"} needs no auth: it only sends alerts already queued by
// the database, each at most once. "status" and "test" are staff-only.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = Deno.env.get("SITE_URL") ?? "https://dreamhairbyloveth.vercel.app";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("ALERT_FROM_EMAIL") ?? "Dream Hair by Loveth <onboarding@resend.dev>";
const CALLMEBOT_KEY = Deno.env.get("CALLMEBOT_APIKEY") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en";
const TEMPLATES: Record<string, string> = {
  placed: Deno.env.get("WA_TEMPLATE_PLACED") ?? "dh_order_received",
  paid: Deno.env.get("WA_TEMPLATE_PAID") ?? "dh_payment_received",
  shipped: Deno.env.get("WA_TEMPLATE_SHIPPED") ?? "dh_order_shipped",
};

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// ---------- formatting ----------
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const naira = (n: number) => "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
const nairaKobo = (k: number) =>
  "₦" + (Number(k) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const intlPhone = (p: string) => {
  let d = String(p ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = "234" + d.slice(1);
  return d;
};
const orderUrl = (o: Row) => `${SITE}/order-confirmed?order=${encodeURIComponent(o.number)}&t=${o.access_token}`;
const adminUrl = (o: Row) => `${SITE}/admin/orders#${encodeURIComponent(o.number)}`;
const amountDue = (o: Row) =>
  o.payment_provider === "cheqpay" && o.pay_amount_kobo ? nairaKobo(o.pay_amount_kobo) : naira(o.total_ngn);
const fullName = (o: Row) => `${o.first_name} ${o.last_name}`.trim();
const paymentLabel = (o: Row) =>
  o.payment_method === "pay_on_pickup" ? "Pay on pick-up" : o.payment_provider === "cheqpay" ? "Bank transfer (CheqPay)" : "Bank transfer";

function paymentLine(o: Row, pay: Row | null): string {
  if (o.payment_method === "pay_on_pickup") return "Pay when you pick up your order.";
  if (o.payment_provider === "cheqpay" && pay?.account_number) {
    return `Transfer exactly ${nairaKobo(o.pay_amount_kobo)} to ${pay.account_number} (${pay.bank_name}, ${pay.account_name}). Your payment is confirmed automatically.`;
  }
  return "We'll send our bank details on WhatsApp or by email shortly.";
}

// ---------- email ----------
function layout(heading: string, inner: string, cta?: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1D1D1F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;overflow:hidden">
<tr><td style="padding:26px 28px 8px"><div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:4px;color:#6E1A2C">HOUSE OF LOVETH</div></td></tr>
<tr><td style="padding:8px 28px 6px"><h1 style="margin:0;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em">${esc(heading)}</h1></td></tr>
<tr><td style="padding:10px 28px 24px;font-size:15px;line-height:1.6">${inner}
${cta ? `<p style="margin:22px 0 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#6E1A2C;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:980px">${esc(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #EEEEF0;font-size:12px;color:#6E6E73">Dream Hair by Loveth · A breath of fresh hair</td></tr>
</table></td></tr></table></body></html>`;
}

function itemsHtml(items: Row[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;border-top:1px solid #EEEEF0">${items
    .map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #EEEEF0"><strong>${esc(i.name)}</strong><br><span style="color:#6E6E73;font-size:13px">${esc(i.options || "")} · Qty ${i.quantity}</span></td>
<td align="right" style="padding:10px 0;border-bottom:1px solid #EEEEF0;white-space:nowrap">${naira(i.unit_price_ngn * i.quantity)}</td></tr>`)
    .join("")}</table>`;
}

function totalsHtml(o: Row) {
  return `<p style="margin:0;color:#6E6E73">Subtotal ${naira(o.subtotal_ngn)} · Delivery ${o.delivery_fee_ngn ? naira(o.delivery_fee_ngn) : "free"}</p>
<p style="margin:4px 0 0;font-size:18px"><strong>Total ${amountDue(o)}</strong></p>`;
}

function payBox(o: Row, pay: Row | null) {
  if (o.payment_status === "paid") return "";
  if (o.payment_provider === "cheqpay" && pay?.account_number) {
    return `<div style="margin:18px 0 0;padding:16px 18px;border-radius:14px;background:#FFF7EA">
<strong>Pay by bank transfer</strong><br>Amount: <strong>${nairaKobo(o.pay_amount_kobo)}</strong> (please send the exact amount, kobo included)<br>
Account number: <strong>${esc(pay.account_number)}</strong><br>Bank: ${esc(pay.bank_name)}<br>Account name: ${esc(pay.account_name)}<br>
<span style="color:#6E6E73;font-size:13px">Your payment is confirmed automatically, usually within a minute.</span></div>`;
  }
  return `<p style="margin:16px 0 0">${esc(paymentLine(o, pay))}</p>`;
}

function ownerEmail(event: string, o: Row, items: Row[]) {
  const who = `<p style="margin:0"><strong>${esc(fullName(o))}</strong><br><a href="tel:${esc(o.phone)}" style="color:#6E1A2C">${esc(o.phone)}</a> · <a href="https://wa.me/${intlPhone(o.phone)}" style="color:#1E5B34">WhatsApp</a><br><a href="mailto:${esc(o.email)}" style="color:#6E1A2C">${esc(o.email)}</a></p>
<p style="margin:12px 0 0">${esc([o.address, o.address2, o.city, o.state].filter(Boolean).join(", "))}<br><span style="color:#6E6E73">${esc(o.delivery_code)} delivery · ${esc(paymentLabel(o))}</span></p>`;
  if (event === "paid") {
    const payer = o.payer?.name ? ` from ${esc(o.payer.name)}${o.payer.bank_name ? " (" + esc(o.payer.bank_name) + ")" : ""}` : "";
    return {
      subject: `Paid: order #${o.number} · ${amountDue(o)}`,
      html: layout(`Payment received for #${o.number}`, `<p style="margin:0 0 12px">${amountDue(o)} arrived${payer}. The order has moved to processing.</p>${who}${itemsHtml(items)}`, { href: adminUrl(o), label: "Open the order" }),
      text: `Payment received for #${o.number}: ${amountDue(o)}. ${adminUrl(o)}`,
    };
  }
  return {
    subject: `New order #${o.number} · ${amountDue(o)} · ${fullName(o)}`,
    html: layout(`New order #${o.number}`, `${who}${itemsHtml(items)}${totalsHtml(o)}<p style="margin:12px 0 0;color:#6E6E73">Payment: ${o.payment_status === "paid" ? "paid" : "awaiting payment"}</p>`, { href: adminUrl(o), label: "Open the order" }),
    text: `New order #${o.number} from ${fullName(o)} (${o.phone}) for ${amountDue(o)}. ${adminUrl(o)}`,
  };
}

function customerEmail(event: string, o: Row, items: Row[], pay: Row | null) {
  if (event === "paid") {
    return {
      subject: `Payment received for order #${o.number}`,
      html: layout(`Thank you, ${o.first_name}`, `<p style="margin:0">We've received your payment of <strong>${amountDue(o)}</strong> for order #${esc(o.number)}. We're preparing it now and will let you know when it's on its way.</p>${itemsHtml(items)}`, { href: orderUrl(o), label: "View your order" }),
      text: `We've received your payment of ${amountDue(o)} for order #${o.number}. ${orderUrl(o)}`,
    };
  }
  if (event === "shipped") {
    return {
      subject: `Your order #${o.number} is on its way`,
      html: layout(`Your order is on its way`, `<p style="margin:0">Good news, ${esc(o.first_name)}: order #${esc(o.number)} has left us and is heading to ${esc([o.city, o.state].filter(Boolean).join(", "))}.</p>${itemsHtml(items)}<p style="margin:0;color:#6E6E73">Questions? Just reply to this email.</p>`, { href: orderUrl(o), label: "View your order" }),
      text: `Your order #${o.number} is on its way. ${orderUrl(o)}`,
    };
  }
  return {
    subject: `We've got your order #${o.number}`,
    html: layout(`Thank you, ${o.first_name}`, `<p style="margin:0">Your order <strong>#${esc(o.number)}</strong> is confirmed.</p>${itemsHtml(items)}${totalsHtml(o)}${payBox(o, pay)}`, { href: orderUrl(o), label: "View your order" }),
    text: `Your order #${o.number} is confirmed. Total ${amountDue(o)}. ${paymentLine(o, pay)} ${orderUrl(o)}`,
  };
}

function ownerWhatsApp(event: string, o: Row, items: Row[]) {
  const list = items.map((i) => `- ${i.name} x${i.quantity}`).join("\n");
  if (event === "paid") return `Dream Hair: payment received for #${o.number} - ${amountDue(o)}${o.payer?.name ? " from " + o.payer.name : ""}.\n${adminUrl(o)}`;
  return `Dream Hair: new order #${o.number} - ${amountDue(o)}\n${fullName(o)} - ${o.phone}\n${list}\n${o.city}, ${o.state} - ${paymentLabel(o)}${o.payment_status === "paid" ? " (paid)" : " (awaiting payment)"}\n${adminUrl(o)}`;
}

function customerTemplate(event: string, o: Row): string[] {
  if (event === "paid") return [o.first_name, amountDue(o), `#${o.number}`];
  if (event === "shipped") return [o.first_name, `#${o.number}`];
  return [o.first_name, `#${o.number}`, amountDue(o), orderUrl(o)];
}

// ---------- senders ----------
async function sendEmail(to: string, msg: { subject: string; html: string; text: string }, replyTo?: string | null) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: msg.subject, html: msg.html, text: msg.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend: ${body?.message ?? res.status}`);
  return body?.id ?? null;
}

async function sendCallMeBot(phone: string, text: string) {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent("+" + intlPhone(phone))}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(CALLMEBOT_KEY)}`;
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok || !/queued|sent/i.test(body)) throw new Error(`CallMeBot: ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || res.status}`);
  return null;
}

async function sendMetaTemplate(phone: string, template: string, params: string[]) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: intlPhone(phone),
      type: "template",
      template: {
        name: template,
        language: { code: WA_LANG },
        components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: String(t).slice(0, 1000) })) }],
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp: ${body?.error?.message ?? res.status}`);
  return body?.messages?.[0]?.id ?? null;
}

class Skip extends Error {}

// ---------- processing ----------
async function processQueue(limit = 20) {
  const { data: rows, error } = await db.rpc("claim_notifications", { p_limit: limit });
  if (error) throw error;
  if (!rows?.length) return [];
  const { data: settings } = await db.from("alert_settings").select("*").eq("id", 1).single();
  const { data: pay } = await db.from("payment_settings").select("*").eq("id", 1).single();
  const orders = new Map<string, { o: Row; items: Row[] }>();
  const results = [];

  for (const n of rows as Row[]) {
    let status = "sent", err: string | null = null, providerId: string | null = null;
    try {
      let ctx: { o: Row; items: Row[] } | undefined;
      if (n.order_id) {
        ctx = orders.get(n.order_id);
        if (!ctx) {
          const { data: o } = await db.from("orders").select("*, order_items(*)").eq("id", n.order_id).single();
          if (!o) throw new Skip("Order no longer exists");
          ctx = { o, items: o.order_items ?? [] };
          orders.set(n.order_id, ctx);
        }
      }
      if (n.audience === "owner") {
        if (n.channel === "email") {
          if (!RESEND_KEY) throw new Skip("Email isn't set up (RESEND_API_KEY)");
          if (!settings?.owner_email) throw new Skip("No store email address set");
          const msg = n.event === "test"
            ? { subject: "Test alert from your Dream Hair admin", html: layout("Order alerts are working", "<p style=\"margin:0\">You'll get an email like this for every new order and every payment.</p>"), text: "Order alerts are working." }
            : ownerEmail(n.event, ctx!.o, ctx!.items);
          providerId = await sendEmail(settings.owner_email, msg);
        } else {
          if (!CALLMEBOT_KEY) throw new Skip("Store WhatsApp isn't set up (CALLMEBOT_APIKEY)");
          if (!settings?.owner_whatsapp) throw new Skip("No store WhatsApp number set");
          await sendCallMeBot(settings.owner_whatsapp, n.event === "test" ? "Dream Hair: order alerts are working. You'll get a message like this for every new order and payment." : ownerWhatsApp(n.event, ctx!.o, ctx!.items));
        }
      } else {
        if (!settings?.notify_customers) throw new Skip("Customer messages are turned off");
        const o = ctx!.o;
        if (n.channel === "email") {
          if (!RESEND_KEY) throw new Skip("Email isn't set up (RESEND_API_KEY)");
          providerId = await sendEmail(o.email, customerEmail(n.event, o, ctx!.items, pay), settings?.owner_email);
        } else {
          if (!WA_TOKEN || !WA_PHONE_ID) throw new Skip("Customer WhatsApp isn't set up (WHATSAPP_TOKEN)");
          providerId = await sendMetaTemplate(o.phone, TEMPLATES[n.event], customerTemplate(n.event, o));
        }
      }
    } catch (e) {
      status = e instanceof Skip ? "skipped" : "failed";
      err = String((e as Error).message ?? e).slice(0, 300);
    }
    const retryIn = Math.min(60, 2 ** n.attempts) * 60_000; // 2, 4, 8 … minutes
    await db.from("notifications").update({
      status, error: err, provider_id: providerId,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      next_attempt_at: new Date(Date.now() + (status === "failed" ? retryIn : 0)).toISOString(),
    }).eq("id", n.id);
    results.push({ id: n.id, event: n.event, channel: n.channel, audience: n.audience, status, error: err });
  }
  return results;
}

async function staffFrom(req: Request) {
  const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return null;
  const { data: staff } = await db.from("staff").select("role").eq("user_id", user.id).maybeSingle();
  return staff;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let action = "process";
  try { action = (await req.json()).action ?? "process"; } catch { /* default */ }

  if (action === "process") {
    try {
      return json(200, { processed: await processQueue() });
    } catch {
      return json(500, { error: "could not process alerts" });
    }
  }

  if (!(await staffFrom(req))) return json(403, { error: "Staff only" });

  if (action === "status") {
    return json(200, {
      email: !!RESEND_KEY, from: FROM, store_whatsapp: !!CALLMEBOT_KEY, customer_whatsapp: !!(WA_TOKEN && WA_PHONE_ID), templates: TEMPLATES,
    });
  }
  if (action === "test") {
    const { data: queued, error } = await db.from("notifications")
      .insert([{ event: "test", channel: "email", audience: "owner" }, { event: "test", channel: "whatsapp", audience: "owner" }])
      .select("id");
    if (error) return json(500, { error: "could not queue the test" });
    const results = await processQueue(50);
    const mine = new Set((queued ?? []).map((q) => q.id));
    return json(200, { results: results.filter((r) => mine.has(r.id)) });
  }
  return json(400, { error: "Unknown action" });
});
