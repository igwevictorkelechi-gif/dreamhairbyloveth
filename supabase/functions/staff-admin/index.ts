// Staff accounts for the Dream Hair by Loveth admin.
//
// Owner-only actions (signed-in owner's token required):
//   invite { full_name, email, phone?, access }   -> creates the account and a 48-hour invite link
//   resend { user_id }                            -> a fresh invite link (old ones stop working)
//   update { user_id, access?, status? }          -> change role, suspend ('suspended') or reactivate ('active')
//   remove { user_id }                            -> takes away admin access
// Public actions (the invite link itself is the credential):
//   peek   { token }                              -> who the invite is for
//   accept { token, password }                    -> sets their password and activates the account
//
// The invite link is shown to the owner (to share by WhatsApp or copy) and, if
// email is set up (RESEND_API_KEY), also emailed. Passwords are never seen by
// the owner.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM = Deno.env.get("ALERT_FROM_EMAIL") ?? "Dream Hair by Loveth <onboarding@resend.dev>";
const SITE = Deno.env.get("SITE_URL") ?? "https://dreamhairbyloveth.vercel.app";
const ROLES = ["owner", "manager", "sales", "inventory"] as const;
const ROLE_NAME: Record<string, string> = { owner: "Owner", manager: "Manager", sales: "Sales & customer care", inventory: "Inventory" };
const INVITE_HOURS = 48;

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const legacyRole = (access: string) => (access === "owner" || access === "manager" ? access : "staff");

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function siteFor(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$|^https:\/\/(www\.)?houseoflovethhair\.com$|^http:\/\/localhost:\d+$/.test(o) ? o : SITE;
}

async function newInvite(userId: string, req: Request) {
  await admin.from("staff_invites").delete().eq("user_id", userId).is("used_at", null);
  const token = randomToken();
  const { error } = await admin.from("staff_invites").insert({
    token_hash: await sha256(token), user_id: userId, expires_at: new Date(Date.now() + INVITE_HOURS * 3600_000).toISOString(),
  });
  if (error) throw new Error("Couldn't create the invite link.");
  await admin.from("staff").update({ invited_at: new Date().toISOString() }).eq("user_id", userId);
  return `${siteFor(req)}/admin/welcome?t=${token}`;
}

async function emailInvite(to: string, name: string, access: string, inviter: string, link: string) {
  if (!RESEND_KEY) return false;
  const first = name.split(" ")[0] || "there";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1D1D1F;max-width:520px">
    <p style="font-size:13px;letter-spacing:3px;color:#6E1A2C">HOUSE OF LOVETH</p>
    <h1 style="font-size:24px;margin:0 0 12px">You're invited to the store admin</h1>
    <p>Hi ${first}, ${inviter} has added you to the Dream Hair by Loveth admin as <strong>${ROLE_NAME[access]}</strong>.</p>
    <p><a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:980px;background:#6E1A2C;color:#FFFFFF;text-decoration:none;font-weight:600">Set your password</a></p>
    <p style="color:#6E6E73;font-size:13px">This link works once and expires in ${INVITE_HOURS} hours.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: "Your Dream Hair by Loveth admin invite", html,
      text: `Hi ${first}, ${inviter} has added you to the Dream Hair by Loveth admin as ${ROLE_NAME[access]}. Set your password here (works once, expires in ${INVITE_HOURS} hours): ${link}` }),
  });
  return res.ok;
}

async function findInvite(token: string) {
  if (!token || token.length < 20) return null;
  const { data } = await admin.from("staff_invites").select("user_id, expires_at, used_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  const { data: staff } = await admin.from("staff").select("user_id, full_name, email, access, status").eq("user_id", data.user_id).maybeSingle();
  if (!staff || staff.status === "suspended") return null;
  return staff;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Bad request" }); }
  const action = String(body.action ?? "");

  try {
    // ---------- public: the invite link ----------
    if (action === "peek" || action === "accept") {
      const staff = await findInvite(String(body.token ?? ""));
      if (!staff) return json(410, { error: "This invite link has expired or was already used. Ask the owner to send a new one." });
      if (action === "peek") return json(200, { full_name: staff.full_name, email: staff.email, role: ROLE_NAME[staff.access] });
      const password = String(body.password ?? "");
      if (password.length < 10) return json(400, { error: "Use a password of at least 10 characters." });
      if (password.length > 72) return json(400, { error: "That password is too long (72 characters at most)." });
      const { error } = await admin.auth.admin.updateUserById(staff.user_id, { password, email_confirm: true });
      if (error) return json(400, { error: /weak|pwned|password/i.test(error.message) ? "Please choose a stronger password." : "Couldn't set your password. Please try again." });
      await admin.from("staff_invites").update({ used_at: new Date().toISOString() }).eq("token_hash", await sha256(String(body.token)));
      if (staff.status === "invited") await admin.from("staff").update({ status: "active" }).eq("user_id", staff.user_id);
      return json(200, { ok: true, email: staff.email });
    }

    // ---------- owner only ----------
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) return json(401, { error: "Please sign in again." });
    const { data: me } = await admin.from("staff").select("access, status, full_name, email").eq("user_id", user.id).maybeSingle();
    if (!me || me.status !== "active" || me.access !== "owner") return json(403, { error: "Only the owner can manage staff." });
    const myName = me.full_name || me.email || "The owner";
    const log = (action: string, target: string) =>
      admin.from("staff_activity").insert({ user_id: user.id, actor: myName, action, target, target_url: "/admin/staff" });

    if (action === "invite") {
      const full_name = clean(body.full_name, 100);
      const email = clean(body.email, 254).toLowerCase();
      const phone = clean(body.phone, 40) || null;
      const access = String(body.access ?? "");
      if (!full_name) return json(400, { error: "Please enter their name." });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Please enter a valid email address." });
      if (!(ROLES as readonly string[]).includes(access)) return json(400, { error: "Please choose a role." });

      // existing account (for example a customer) or a new one
      let userId: string | null = null;
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email, email_confirm: true, password: randomToken() + "Aa1!", user_metadata: { full_name, staff: true },
      });
      if (created?.user) userId = created.user.id;
      else if (/already|registered|exists/i.test(cErr?.message ?? "")) {
        for (let page = 1; page <= 20 && !userId; page++) {
          const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          const hit = list?.users.find((u) => (u.email ?? "").toLowerCase() === email);
          if (hit) userId = hit.id;
          if (!list || list.users.length < 200) break;
        }
      }
      if (!userId) return json(500, { error: "Couldn't create the account. Please try again." });

      const { data: existing } = await admin.from("staff").select("status").eq("user_id", userId).maybeSingle();
      if (existing) return json(409, { error: existing.status === "suspended" ? "This person is suspended. Reactivate them from the team list." : "This person is already on your team." });
      const { error: sErr } = await admin.from("staff").insert({
        user_id: userId, role: legacyRole(access), access, status: "invited", full_name, email, phone,
        invited_by: user.id, invited_at: new Date().toISOString(),
      });
      if (sErr) return json(500, { error: "Couldn't add them to the team." });
      const link = await newInvite(userId, req);
      const emailed = body.send_email === false ? false : await emailInvite(email, full_name, access, myName, link).catch(() => false);
      await log(`invited ${full_name} as`, ROLE_NAME[access]);
      return json(201, { ok: true, user_id: userId, link, emailed, email_ready: !!RESEND_KEY });
    }

    const userId = String(body.user_id ?? "");
    const { data: target } = await admin.from("staff").select("user_id, full_name, email, access, status").eq("user_id", userId).maybeSingle();
    if (!target) return json(404, { error: "That person isn't on the team." });
    if (target.user_id === user.id) return json(400, { error: "You can't change your own access." });

    if (action === "resend") {
      if (target.status !== "invited") return json(400, { error: "They've already set up their account." });
      const link = await newInvite(target.user_id, req);
      const emailed = body.send_email === false ? false : await emailInvite(target.email, target.full_name ?? "", target.access, myName, link).catch(() => false);
      await log("re-sent the invite to", target.full_name ?? target.email);
      return json(200, { ok: true, link, emailed, email_ready: !!RESEND_KEY });
    }

    if (action === "update") {
      const patch: Record<string, string> = {};
      if (body.access !== undefined) {
        const access = String(body.access);
        if (!(ROLES as readonly string[]).includes(access)) return json(400, { error: "Please choose a role." });
        patch.access = access; patch.role = legacyRole(access);
      }
      if (body.status !== undefined) {
        const status = String(body.status);
        if (status !== "active" && status !== "suspended") return json(400, { error: "Unknown status." });
        if (status === "active" && target.status === "invited") return json(400, { error: "They need to accept their invite first." });
        patch.status = status;
      }
      const { error } = await admin.from("staff").update(patch).eq("user_id", target.user_id);
      if (error) return json(500, { error: "Couldn't save that change." });
      const who = target.full_name ?? target.email;
      if (patch.status === "suspended") {
        await admin.from("staff_invites").delete().eq("user_id", target.user_id).is("used_at", null);
        await log("suspended", who);
      } else if (patch.status === "active") await log("reactivated", who);
      if (patch.access) await log(`changed ${who}'s role to`, ROLE_NAME[patch.access]);
      return json(200, { ok: true });
    }

    if (action === "remove") {
      await admin.from("staff_invites").delete().eq("user_id", target.user_id);
      const { error } = await admin.from("staff").delete().eq("user_id", target.user_id);
      if (error) return json(500, { error: "Couldn't remove them." });
      // delete the login too unless it's also a customer account
      const { data: profile } = await admin.from("customer_profiles").select("user_id").eq("user_id", target.user_id).maybeSingle();
      if (!profile) await admin.auth.admin.deleteUser(target.user_id).catch(() => {});
      await log("removed", target.full_name ?? target.email);
      return json(200, { ok: true });
    }

    return json(400, { error: "Unknown action" });
  } catch (e) {
    console.error(e);
    return json(500, { error: e instanceof Error ? e.message : "Something went wrong." });
  }
});
