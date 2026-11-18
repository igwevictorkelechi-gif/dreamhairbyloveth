// Customer sign-up for Dream Hair by Loveth.
//
// Creates a ready-to-use account (no confirmation email: the project has no
// mail sender of its own yet) and the customer's profile, then the browser
// signs in with the same email and password. Orders are tied to the account by
// user id only, never by email, so registering someone else's address gives no
// access to their past orders.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_PER_HOUR = 5;
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Please fill in the form." }); }

  const email = clean(body.email, 254).toLowerCase();
  const password = String(body.password ?? "");
  const first_name = clean(body.first_name, 100);
  const last_name = clean(body.last_name, 100);
  const phone = clean(body.phone, 40);
  const marketing_opt_in = body.marketing_opt_in === true;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Please enter a valid email address." });
  if (password.length < 8) return json(400, { error: "Use a password of at least 8 characters." });
  if (password.length > 72) return json(400, { error: "That password is too long (72 characters at most)." });
  if (!first_name || !last_name) return json(400, { error: "Please enter your first and last name." });
  if (phone && phone.replace(/\D/g, "").length < 7) return json(400, { error: "Please check your phone number." });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("signup_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_HOUR) return json(429, { error: "Too many new accounts from this network. Please try again in an hour." });
  await db.from("signup_attempts").insert({ ip });

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name, last_name, role: "customer" },
  });
  if (error || !data?.user) {
    const msg = String(error?.message ?? "");
    if (/already|registered|exists/i.test(msg)) return json(409, { error: "An account with this email already exists. Sign in instead." });
    if (/password/i.test(msg)) return json(400, { error: "Please choose a stronger password." });
    return json(500, { error: "We couldn't create your account just now. Please try again." });
  }

  const { error: pErr } = await db.from("customer_profiles").insert({
    user_id: data.user.id, first_name, last_name, phone: phone || null, marketing_opt_in,
  });
  if (pErr) return json(500, { error: "Your account was created but your details didn't save. Sign in and add them on your account page." });
  if (marketing_opt_in) await db.from("subscribers").insert({ email }).then(() => {}, () => {});

  return json(201, { ok: true });
});
