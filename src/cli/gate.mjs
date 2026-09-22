#!/usr/bin/env node
// The password gate of a deployed wiki, as one command, because setting it by hand is four
// steps and every one of them fails silently:
//
//   wiki gate set --password "<word>"      set or rotate the password; mints the secrets on first use
//   wiki gate set --type freedom-account --pass-secret "<the portal's>"
//                                          the door for people running Freedom: writes gate.type into
//                                          wiki.config.json, sets WIKI_PASS_SECRET, drops WIKI_PASSWORD
//   wiki gate set --rotate-secrets         new WIKI_GATE_SECRET and WIKI_SHARE_SECRET: every ticket
//                                          and every share link ever issued stops working
//   wiki gate status                       what the live site does: door, preloaded link, bots, cards
//   wiki gate link [/route]                the preloaded link for a page
//
// Reads the Vercel project from .vercel/project.json (run `vercel link` first) and the token
// from VERCEL_TOKEN or the CLI's own auth file. Talks to the Vercel REST API directly and never
// to `vercel env add`: the 52.x CLI stores an EMPTY value when the value is piped to it and
// prints success (supersuit-repos CLAUDE.md, 2026-08-13), which is how a wiki ends up with a
// password variable that is present and blank. After writing, it reads every variable back by
// LENGTH, redeploys production so the edge picks the values up, and then checks the live site
// the way a person would: anonymous 401, preloaded link 303 to the clean URL, ticket 200,
// GPTBot 403, Twitterbot 200, og card 200, manifest 200.
//
// The password is the operator's to choose; this never invents one. Secrets it does invent,
// once, with crypto.randomBytes.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes, createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

const HELP = `wiki gate <set|status|link>

  set --password "<word>"     set or rotate the password; mints WIKI_GATE_SECRET and WIKI_SHARE_SECRET on first use
  set --type freedom-account --pass-secret "<value>" --key-secret "<value>"
                              the door for people running Freedom (gate.type in wiki.config.json). The pass
                              secret must be the portal's; WIKI_PASSWORD is removed, since it would open nothing.
                              --key-secret is the portal's WIKI_GATE_SECRET, which the hourly ?k= key is derived
                              from; it is never minted here, because a wiki-local one opens nothing
  set --type password --password "<word>"   back to the password door
  set --rotate-secrets        new secrets: every ticket and every share link ever issued stops working
  status [--password "<word>"]  what the live site does: door, preloaded link, ticket, bots, og card, manifest.
                              On a freedom-account wiki the key is read from the project; no password needed
  link [/route] [--password "<word>"]   the preloaded link for a page (the hourly ?k= link on an account wiki)

Commit wiki.config.json after \`set --type\`; the edge reads the gate from it.

Run from the wiki root after \`vercel link\`. Writes through the Vercel REST API (never the CLI's
env add, which stores blanks when piped), reads every value back by length, redeploys production,
then checks the live site. The password is yours to choose; secrets are minted for you.`;

const ROOT = process.cwd();
const args = process.argv.slice(2);
const sub = args[0];
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const has = (name) => args.includes(name);

export function readProject(root = ROOT) {
  const p = join(root, ".vercel", "project.json");
  if (!existsSync(p)) throw new Error("no .vercel/project.json here; run `vercel link` in the wiki root first");
  const { projectId, orgId, projectName } = JSON.parse(readFileSync(p, "utf8"));
  return { projectId, teamId: orgId, projectName };
}

export function readToken(home = homedir()) {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const p = join(home, "Library", "Application Support", "com.vercel.cli", "auth.json");
  if (!existsSync(p)) throw new Error("no VERCEL_TOKEN and no Vercel CLI auth file; run `vercel login` or export VERCEL_TOKEN");
  const { token } = JSON.parse(readFileSync(p, "utf8"));
  if (!token) throw new Error("Vercel auth file has no token");
  return token;
}

export function siteUrl(root = ROOT) {
  const p = join(root, "wiki.config.json");
  if (!existsSync(p)) throw new Error("no wiki.config.json here");
  const { url } = JSON.parse(readFileSync(p, "utf8"));
  if (!/^https:\/\//.test(url || "")) throw new Error(`wiki.config.json url must be https://…, got ${url}`);
  return url.replace(/\/$/, "");
}

export function preloadedLink(base, route = "/", password, unlockParam = "key") {
  const u = new URL(route, base);
  u.searchParams.set(unlockParam, password);
  return u.toString();
}

/** The portal's hourly account key, derived exactly as the wiki gate and the portal derive it. */
export function hourKeyFor(gateSecret, at = Date.now()) {
  return createHmac("sha256", gateSecret).update(`wiki-gate:${Math.floor(at / 3_600_000)}`).digest("hex").slice(0, 32);
}

/** The link that opens an account-gated page for the next hour: what /freedom:profile emits. */
export function accountLink(base, route = "/", gateSecret, at = Date.now()) {
  return preloadedLink(base, route, hourKeyFor(gateSecret, at), "k");
}

/** The gate type wiki.config.json declares. Absent means the family password gate. */
export function gateTypeOf(root = ROOT) {
  try { return JSON.parse(readFileSync(join(root, "wiki.config.json"), "utf8")).gate?.type || "password"; } catch { return "password"; }
}

/** Write `gate.type` into wiki.config.json, keeping every other key and every other gate field
 *  except a family `unlockParam` of "key", which the type now decides. */
export function writeGateType(root, type) {
  const p = join(root, "wiki.config.json");
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  const gate = { ...(cfg.gate && typeof cfg.gate === "object" ? cfg.gate : {}), type };
  if (gate.unlockParam === "key") delete gate.unlockParam;
  cfg.gate = gate;
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

/** The env variables the gate needs, given what is already set. Pure, so it is testable.
 *  `type` "freedom-account" drops WIKI_PASSWORD (it would open nothing and reads as a lock in the
 *  dashboard), sets WIKI_PASS_SECRET when one is given, and mints the two family secrets. */
export function planEnv(existing, { password, type, passSecret, keySecret, rotateSecrets = false, random = () => randomBytes(32).toString("hex") }) {
  const plan = [];
  const have = (k) => existing.find((e) => e.key === k);
  if (type === "freedom-account") {
    if (have("WIKI_PASSWORD")) plan.push({ key: "WIKI_PASSWORD", value: "", action: "delete" });
    if (passSecret !== undefined) plan.push({ key: "WIKI_PASS_SECRET", value: passSecret, action: have("WIKI_PASS_SECRET") ? "update" : "create" });
    // THE HOURLY KEY IS THE PORTAL'S, never the wiki's. The portal derives `?k=` from ITS
    // WIKI_GATE_SECRET, so a secret minted here can never match and every key link meets the
    // door. supersuit.wiki ran that way from its move onto this gate until 2026-09-21, found by
    // the first named-key read. So: set it only from --key-secret, never mint or rotate it.
    if (keySecret !== undefined) plan.push({ key: "WIKI_GATE_SECRET", value: keySecret, action: have("WIKI_GATE_SECRET") ? "update" : "create" });
    const cur = have("WIKI_SHARE_SECRET");
    if (!cur) plan.push({ key: "WIKI_SHARE_SECRET", value: random(), action: "create" });
    else if (rotateSecrets) plan.push({ key: "WIKI_SHARE_SECRET", value: random(), action: "update" });
    return plan;
  } else if (password !== undefined) {
    plan.push({ key: "WIKI_PASSWORD", value: password, action: have("WIKI_PASSWORD") ? "update" : "create" });
  }
  for (const k of ["WIKI_GATE_SECRET", "WIKI_SHARE_SECRET"]) {
    const cur = have(k);
    if (!cur) plan.push({ key: k, value: random(), action: "create" });
    else if (rotateSecrets) plan.push({ key: k, value: random(), action: "update" });
  }
  return plan;
}

async function api(token, path, init = {}) {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel API ${init.method || "GET"} ${path}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function listEnv(token, { projectId, teamId }) {
  const { envs } = await api(token, `/v9/projects/${projectId}/env?teamId=${teamId}`);
  return envs.filter((e) => e.target?.includes("production"));
}

/** The LIST endpoint returns encrypted variables as ciphertext even with decrypt=true (a
 *  7-character password read back as 992 characters, 2026-09-13); only the per-variable GET
 *  decrypts. So read-back fetches each variable on its own. */
async function readBack(token, { projectId, teamId }, keys) {
  const envs = await listEnv(token, { projectId, teamId });
  const out = [];
  for (const key of keys) {
    const e = envs.find((x) => x.key === key);
    if (!e) { out.push({ key, value: "" }); continue; }
    const one = await api(token, `/v1/projects/${projectId}/env/${e.id}?teamId=${teamId}&decrypt=true`);
    out.push({ key, value: one.value ?? "" });
  }
  return out;
}

async function applyPlan(token, project, plan, existing) {
  for (const step of plan) {
    // A variable the 59.x CLI created is `sensitive` by default (a Secret): its value can never be
    // read back through the API, so a length check would report it blank forever. Recreate it as
    // `encrypted`, which is still stored encrypted at rest and IS readable to its owner.
    const cur = existing.find((e) => e.key === step.key);
    if (step.action === "delete") {
      if (cur) await api(token, `/v9/projects/${project.projectId}/env/${cur.id}?teamId=${project.teamId}`, { method: "DELETE" });
      continue;
    }
    if (step.action === "update" && cur?.type === "sensitive") {
      console.log(`[gate] ${step.key} was stored as sensitive (unreadable); recreating it as encrypted so it can be verified`);
      await api(token, `/v9/projects/${project.projectId}/env/${cur.id}?teamId=${project.teamId}`, { method: "DELETE" });
      step.action = "create";
    }
    if (step.action === "create") {
      await api(token, `/v10/projects/${project.projectId}/env?teamId=${project.teamId}`, {
        method: "POST",
        body: JSON.stringify({ key: step.key, value: step.value, type: "encrypted", target: ["production", "preview"] }),
      });
    } else {
      await api(token, `/v9/projects/${project.projectId}/env/${cur.id}?teamId=${project.teamId}`, {
        method: "PATCH",
        body: JSON.stringify({ value: step.value }),
      });
    }
  }
}

/** Read back what the API now holds and compare LENGTHS, never trust the write's exit code. */
export function verifyLengths(after, plan) {
  const bad = [];
  for (const step of plan) {
    const e = after.find((x) => x.key === step.key);
    const got = e?.value ?? "";
    if (step.action === "delete") { if (got.length) bad.push(`${step.key}: expected it gone, read back ${got.length}`); continue; }
    if (got.length !== step.value.length) bad.push(`${step.key}: expected length ${step.value.length}, read back ${got.length}`);
  }
  return bad;
}

async function redeploy(token, project) {
  const { deployments } = await api(token, `/v6/deployments?projectId=${project.projectId}&teamId=${project.teamId}&target=production&limit=1&state=READY`);
  const latest = deployments?.[0];
  if (!latest) throw new Error("no READY production deployment to redeploy; deploy once first (`vercel deploy --prod`)");
  const created = await api(token, `/v13/deployments?teamId=${project.teamId}&forceNew=1`, {
    method: "POST",
    body: JSON.stringify({ name: project.projectName, deploymentId: latest.uid, target: "production", meta: { action: "redeploy", why: "wiki gate set" } }),
  });
  const id = created.id;
  process.stdout.write(`[gate] redeploying ${created.url} `);
  for (let i = 0; i < 120; i += 1) {
    const d = await api(token, `/v13/deployments/${id}?teamId=${project.teamId}`);
    if (d.readyState === "READY") { console.log("ready"); return d; }
    if (["ERROR", "CANCELED"].includes(d.readyState)) throw new Error(`redeploy ${d.readyState}`);
    await new Promise((r) => setTimeout(r, 5000));
    process.stdout.write(".");
  }
  throw new Error("redeploy did not become READY in ten minutes");
}

async function head(url, headers = {}) {
  const res = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (wiki gate check)", ...headers } });
  return res;
}

/** The live checks a person would run. Returns [{name, ok, got}]. */
export async function liveChecks(base, password, unlockParam = "key", route = "/") {
  const out = [];
  const check = (name, ok, got) => out.push({ name, ok, got });
  const anon = await head(base + route);
  check("anonymous reader meets the door (401)", anon.status === 401, anon.status);
  const pre = await head(preloadedLink(base, route, password.toUpperCase(), unlockParam));
  const loc = pre.headers.get("location") || "";
  check("preloaded link, any capitalization, 303s to the clean url", pre.status === 303 && !loc.includes(unlockParam + "="), `${pre.status} -> ${loc}`);
  const cookie = (pre.headers.get("set-cookie") || "").split(";")[0];
  const ticketed = await head(base + route, { cookie });
  check("ticket cookie admits (200)", ticketed.status === 200, ticketed.status);
  const wrong = await head(preloadedLink(base, route, password + "x", unlockParam));
  check("wrong key is refused (401)", wrong.status === 401, wrong.status);
  const bot = await head(base + route, { "user-agent": "GPTBot/1.0" });
  check("training crawler blocked (403)", bot.status === 403, bot.status);
  const unfurl = await head(base + route, { "user-agent": "Twitterbot/1.0" });
  check("unfurl bot passes (200)", unfurl.status === 200, unfurl.status);
  const html = unfurl.status === 200 ? await unfurl.text() : "";
  const og = html.match(/property=["']?og:image["']? content=["']?([^"' >]+)/)?.[1];
  const card = og ? await head(og) : null;
  check("og card is open (200)", card?.status === 200, og ? card.status : "no og:image on page");
  const manifest = await head(base + "/manifest.webmanifest");
  check("manifest is open (200)", manifest.status === 200, manifest.status);
  return out;
}

/** The live checks for a freedom-account wiki: what a stranger, an operator's link, a crawler
 *  and an unfurl bot each meet. Needs the project's WIKI_GATE_SECRET to build the hourly link. */
export async function liveChecksAccount(base, gateSecret, route = "/") {
  const out = [];
  const check = (name, ok, got) => out.push({ name, ok, got });
  const anon = await head(base + route);
  const anonHtml = anon.status === 401 ? await anon.text() : "";
  check("anonymous reader meets the sign-in door (401)", anon.status === 401 && /\/wiki\/sign-in\?to=/.test(anonHtml), anon.status);
  check("the door carries no password form", !/type="password"/.test(anonHtml), anon.status);
  const keyed = await head(accountLink(base, route, gateSecret));
  const loc = keyed.headers.get("location") || "";
  check("the hourly ?k= link 303s to the clean url", keyed.status === 303 && !loc.includes("k="), `${keyed.status} -> ${loc}`);
  const cookie = (keyed.headers.get("set-cookie") || "").split(";")[0];
  const granted = await head(base + route, { cookie });
  check("the grant cookie admits (200)", granted.status === 200, granted.status);
  const wrong = await head(preloadedLink(base, route, "0".repeat(32), "k"));
  check("a wrong key is refused (401)", wrong.status === 401, wrong.status);
  const old = await head(preloadedLink(base, route, "ibiza", "key"));
  check("a password link opens nothing (401)", old.status === 401, old.status);
  const bot = await head(base + route, { "user-agent": "GPTBot/1.0" });
  check("training crawler blocked (403)", bot.status === 403, bot.status);
  const unfurl = await head(base + route, { "user-agent": "Twitterbot/1.0" });
  check("unfurl bot passes (200)", unfurl.status === 200, unfurl.status);
  const html = unfurl.status === 200 ? await unfurl.text() : "";
  const og = html.match(/property=["']?og:image["']? content=["']?([^"' >]+)/)?.[1];
  const card = og ? await head(og) : null;
  check("og card is open (200)", card?.status === 200, og ? card.status : "no og:image on page");
  const manifest = await head(base + "/manifest.webmanifest");
  check("manifest is open (200)", manifest.status === 200, manifest.status);
  return out;
}

function printChecks(checks) {
  let bad = 0;
  for (const c of checks) { console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}  [${c.got}]`); if (!c.ok) bad += 1; }
  return bad;
}

function unlockParamOf(root = ROOT) {
  try { return JSON.parse(readFileSync(join(root, "wiki.config.json"), "utf8")).gate?.unlockParam || "key"; } catch { return "key"; }
}

async function main() {
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return 0;
  }
  const base = siteUrl();
  const unlockParam = unlockParamOf();
  const declaredType = gateTypeOf();
  const route = args[1] && !args[1].startsWith("--") ? args[1] : "/";
  // The gate secret of a freedom-account wiki, read from the project: it builds the hourly link
  // that `link` prints and `status` exercises, so neither needs a password.
  const liveGateSecret = async () => {
    const project = readProject();
    const token = readToken();
    const [e] = await readBack(token, project, ["WIKI_GATE_SECRET"]);
    if (!e.value) throw new Error("WIKI_GATE_SECRET on the project is unreadable or unset; run `wiki gate set --type freedom-account` (it recreates the secret readable) or pass VERCEL_TOKEN");
    return e.value;
  };

  if (sub === "link") {
    if (declaredType === "freedom-account") { console.log(accountLink(base, route, await liveGateSecret())); return 0; }
    const password = flag("--password");
    if (!password) { console.error("[gate] link needs --password (the live one; read it from your registry)"); return 2; }
    console.log(preloadedLink(base, route, password, unlockParam));
    return 0;
  }

  if (sub === "status") {
    console.log(`[gate] ${base} (gate.type ${declaredType})`);
    if (declaredType === "freedom-account") return printChecks(await liveChecksAccount(base, await liveGateSecret(), flag("--route") || "/")) ? 1 : 0;
    const password = flag("--password");
    if (!password) { console.error("[gate] status needs --password to exercise the preloaded link"); return 2; }
    return printChecks(await liveChecks(base, password, unlockParam, flag("--route") || "/")) ? 1 : 0;
  }

  if (sub === "set") {
    const password = flag("--password");
    const rotate = has("--rotate-secrets");
    const type = flag("--type");
    const passSecret = flag("--pass-secret");
    const keySecret = flag("--key-secret");
    if (keySecret !== undefined && keySecret.length < 32) { console.error("[gate] --key-secret must be the portal's WIKI_GATE_SECRET, at least 32 characters"); return 2; }
    if (type !== undefined && !["password", "freedom-account"].includes(type)) { console.error(`[gate] --type must be password or freedom-account, got "${type}"`); return 2; }
    if (type === "freedom-account" && passSecret !== undefined && passSecret.length < 32) { console.error("[gate] --pass-secret must be the portal's own value, at least 32 characters; a short or invented one opens nothing"); return 2; }
    if (password === undefined && !rotate && type === undefined && keySecret === undefined) { console.error("[gate] set needs --password \"<word>\", --type <password|freedom-account>, and/or --rotate-secrets"); return 2; }
    if (password !== undefined && !password.trim()) { console.error("[gate] refusing an empty password; that is the blank-variable failure this command exists to prevent"); return 2; }
    const effectiveType = type ?? declaredType;
    if (type !== undefined && type !== declaredType) { writeGateType(ROOT, type); console.log(`[gate] wiki.config.json gate.type = ${type} (commit it; the edge reads the gate from the config)`); }
    const project = readProject();
    const token = readToken();
    const existing = await listEnv(token, project);
    const plan = planEnv(existing, { password, type: effectiveType, passSecret, keySecret, rotateSecrets: rotate });
    for (const s of plan) console.log(`[gate] ${s.action} ${s.key}${s.action === "delete" ? "" : ` (${s.value.length} chars)`}`);
    await applyPlan(token, project, plan, existing);
    const after = await readBack(token, project, ["WIKI_PASSWORD", "WIKI_PASS_SECRET", "WIKI_GATE_SECRET", "WIKI_SHARE_SECRET"]);
    const bad = verifyLengths(after, plan);
    if (bad.length) { console.error("[gate] READ-BACK MISMATCH, not redeploying:\n  " + bad.join("\n  ")); return 1; }
    console.log("[gate] read back: every variable has the length that was written");
    if (effectiveType === "freedom-account" && !after.find((e) => e.key === "WIKI_PASS_SECRET")?.value) {
      console.log("[gate] no WIKI_PASS_SECRET on the project: the gate will verify passes with WIKI_GATE_SECRET, which must then equal the portal's WIKI_GATE_SECRET");
    }
    if (effectiveType === "freedom-account" && keySecret === undefined) {
      console.log("[gate] WIKI_GATE_SECRET was not set from --key-secret: the hourly ?k= links open this wiki only if it already equals the portal's");
    }
    await redeploy(token, project);
    if (effectiveType === "freedom-account") {
      const gateSecret = after.find((e) => e.key === "WIKI_GATE_SECRET")?.value;
      console.log(`[gate] live checks on ${base}`);
      const failures = printChecks(await liveChecksAccount(base, gateSecret));
      console.log(`[gate] the hourly link an operator gets: ${accountLink(base, "/", gateSecret)}`);
      if (rotate) console.log("[gate] secrets rotated: every grant and every share link issued before now is dead, and the portal's WIKI_GATE_SECRET must be updated to match");
      console.log(`[gate] record it: registry gate = { type: "freedom-account", unlockParam: "k" }`);
      return failures ? 1 : 0;
    }
    const livePassword = password ?? after.find((e) => e.key === "WIKI_PASSWORD")?.value;
    if (!livePassword) { console.log("[gate] secrets set; no WIKI_PASSWORD, so the gate is dark and the wiki is open"); return 0; }
    console.log(`[gate] live checks on ${base}`);
    const failures = printChecks(await liveChecks(base, livePassword, unlockParam));
    console.log(`[gate] preloaded link: ${preloadedLink(base, "/", livePassword, unlockParam)}`);
    if (rotate) console.log("[gate] secrets rotated: every ticket and every share link issued before now is dead");
    console.log(`[gate] record it: registry gate = { password: "${livePassword}", unlockParam: "${unlockParam}" }`);
    return failures ? 1 : 0;
  }

  console.error(`[gate] unknown subcommand "${sub}"; one of set, status, link`);
  return 2;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().then((code) => process.exit(code), (err) => { console.error(`[gate] ${err.message}`); process.exit(1); });
