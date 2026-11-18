// Staff-only: connect the store's CheqPay virtual account.
//
// POST { action: "status" | "connect" | "disconnect" } with the signed-in staff
// member's Supabase session. "connect" reads the developer account's virtual
// accounts with the CHEQPAY_API_KEY function secret and saves the first active
// NGN account as the account shoppers pay into. The API key never leaves the
// server.
import { createClient } from "jsr:@supabase/supabase-js@2";

const API_BASE = Deno.env.get("CHEQPAY_API_BASE") ?? "https://api.mycheqpay.com/v1";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json(401, { error: "Sign in first" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: staff } = await admin.from("staff").select("role").eq("user_id", user.id).maybeSingle();
  if (!staff) return json(403, { error: "Staff only" });

  let action = "status";
  try { action = (await req.json()).action ?? "status"; } catch { /* default */ }

  const key = Deno.env.get("CHEQPAY_API_KEY") ?? "";
  const keyMode = key.startsWith("cp_live_") ? "live" : key.startsWith("cp_test_") ? "test" : null;
  const status = async () => {
    const { data: settings } = await admin.from("payment_settings").select("*").eq("id", 1).single();
    return {
      api_key_set: !!keyMode,
      key_mode: keyMode,
      webhook_secret_set: !!Deno.env.get("CHEQPAY_WEBHOOK_SECRET"),
      webhook_url: `${url}/functions/v1/cheqpay-webhook`,
      settings,
    };
  };

  if (action === "status") return json(200, await status());

  if (action === "disconnect") {
    if (staff.role !== "owner") return json(403, { error: "Only the owner can disconnect payments" });
    await admin.from("payment_settings").update({
      mode: null, virtual_account_id: null, account_number: null, bank_name: null, account_name: null,
      connected_at: null, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    return json(200, await status());
  }

  if (action !== "connect") return json(400, { error: "Unknown action" });
  if (!keyMode) return json(400, { error: "Add your CheqPay secret key (cp_test_… or cp_live_…) as the CHEQPAY_API_KEY secret in Supabase first." });

  const res = await fetch(`${API_BASE}/virtual_accounts?limit=20`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? `CheqPay answered ${res.status}`;
    return json(502, { error: `CheqPay refused the request: ${msg}` });
  }
  const account = (body.data ?? []).find((v: { status?: string; currency?: string; account_number?: string }) =>
    v.status === "active" && (v.currency ?? "NGN") === "NGN" && v.account_number);
  if (!account) {
    return json(404, { error: "No active NGN virtual account found. Create a customer for the store and open a virtual account for it in your CheqPay developer dashboard, then try again." });
  }
  await admin.from("payment_settings").update({
    mode: keyMode,
    virtual_account_id: account.id,
    account_number: account.account_number,
    bank_name: account.bank_name,
    account_name: account.account_name,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  return json(200, await status());
});
