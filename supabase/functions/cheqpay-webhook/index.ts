// CheqPay webhook receiver for Dream Hair by Loveth.
//
// CheqPay signs deliveries with the Standard Webhooks scheme:
//   webhook-id         event id (same on every retry — we dedupe on it)
//   webhook-timestamp  unix seconds
//   webhook-signature  "v1,<base64 HMAC-SHA256(secret, id.timestamp.body)>" (space-separated when rolled)
// The key is the base64 part of the whsec_ secret, set as the CHEQPAY_WEBHOOK_SECRET function secret.
//
// On deposit.received the deposit is recorded and matched to the unpaid order
// whose unique amount it equals (record_cheqpay_deposit in the database).
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOLERANCE_SECONDS = 300;
const enc = new TextEncoder();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toBase64(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(secret: string, id: string, timestamp: string, body: string, signatures: string): Promise<boolean> {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey(
    "raw", fromBase64(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = toBase64(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`)));
  return signatures.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && safeEqual(sig, expected);
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const secret = Deno.env.get("CHEQPAY_WEBHOOK_SECRET");
  if (!secret) return json(503, { error: "CHEQPAY_WEBHOOK_SECRET is not set" });

  const body = await req.text();
  const id = req.headers.get("webhook-id") ?? "";
  const timestamp = req.headers.get("webhook-timestamp") ?? "";
  const signature = req.headers.get("webhook-signature") ?? "";
  if (!id || !(await verify(secret, id, timestamp, body, signature))) return json(401, { error: "invalid signature" });

  let event: { type?: string; livemode?: boolean; data?: { object?: unknown } | unknown };
  try {
    event = JSON.parse(body);
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  if (event.type !== "deposit.received") return json(200, { received: true, ignored: event.type ?? null });

  const data = event.data as { object?: unknown } | undefined;
  const tx = data && typeof data === "object" && "object" in data ? data.object : data;
  if (!tx || typeof tx !== "object") return json(400, { error: "missing transaction" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: result, error } = await db.rpc("record_cheqpay_deposit", {
    p_event_id: id,
    p_livemode: !!event.livemode,
    p_tx: tx,
  });
  // A 5xx makes CheqPay retry the delivery later.
  if (error) return json(500, { error: "could not record the deposit" });
  return json(200, { received: true, ...result });
});
