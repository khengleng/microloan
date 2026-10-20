#!/usr/bin/env node
/**
 * External uptime check (DECISIONS D-152), run by .github/workflows/uptime.yml
 * every 10 minutes — from outside, because the API cannot report its own
 * outage.
 *
 *   1. Requests each URL (UPTIME_WEB_URL, UPTIME_API_URL), retrying a few
 *      times so one slow answer is not an outage.
 *   2. Keeps the state in a GitHub issue labelled `uptime`: opened when
 *      something is down, commented at most every UPTIME_REMIND_HOURS
 *      (default 6) while it stays down, closed when everything is up again.
 *   3. E-mails ALERT_EMAIL_TO through Resend (RESEND_API_KEY, ALERT_EMAIL_FROM)
 *      when the issue opens, on each reminder, and when it closes
 *      ("recovered"). Without the key or the recipients it only logs.
 *
 * Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (set by Actions),
 * UPTIME_WEB_URL, UPTIME_API_URL, UPTIME_ATTEMPTS (3), UPTIME_RETRY_SECONDS
 * (20), UPTIME_TIMEOUT_SECONDS (20), UPTIME_REMIND_HOURS (6), RESEND_API_KEY,
 * ALERT_EMAIL_TO (comma-separated), ALERT_EMAIL_FROM. No secret is written
 * here; the defaults are the production URLs, overridable by repository
 * variables.
 */

export const LABEL = 'uptime';
export const DEFAULT_URLS = {
  web: 'https://dbank.cambobia.com/en/login',
  api: 'https://api-production-52b47.up.railway.app/v1/health/ready',
};

/** A probe passes on any 2xx or 3xx answer. */
export const isUp = (status) => status >= 200 && status < 400;

/**
 * What to do, given the probe results, the open uptime issue (if any) and
 * when it was last updated. Pure, so it can be tested without the network.
 */
export function decide({ failures, issue, now, remindHours }) {
  const down = failures.length > 0;
  if (!down) return issue ? { action: 'close' } : { action: 'none' };
  if (!issue) return { action: 'open' };
  const last = new Date(issue.lastActivityAt).getTime();
  return now.getTime() - last >= remindHours * 3_600_000
    ? { action: 'remind' }
    : { action: 'none' };
}

const env = (k, d) => (process.env[k]?.trim() ? process.env[k].trim() : d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(name, url, attempts, retryMs, timeoutMs) {
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'uptime-check (GitHub Actions)' },
      });
      if (isUp(res.status)) return null;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e?.name === 'TimeoutError' ? `no answer in ${timeoutMs / 1000} s` : String(e?.message ?? e);
    }
    console.log(`${name}: attempt ${i}/${attempts} failed — ${last}`);
    if (i < attempts) await sleep(retryMs);
  }
  return { name, url, error: last };
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function email(subject, text) {
  const key = env('RESEND_API_KEY');
  const to = env('ALERT_EMAIL_TO', '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const from = env('ALERT_EMAIL_FROM');
  if (!key || !to.length || !from) {
    console.log(`::warning::Not e-mailed (set the RESEND_API_KEY secret and the ALERT_EMAIL_TO / ALERT_EMAIL_FROM variables): ${subject}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) console.log(`::warning::E-mail failed: HTTP ${res.status}`);
  else console.log(`E-mailed: ${subject}`);
}

async function main() {
  const targets = [
    ['Web app', env('UPTIME_WEB_URL', DEFAULT_URLS.web)],
    ['API readiness', env('UPTIME_API_URL', DEFAULT_URLS.api)],
  ];
  const attempts = Number(env('UPTIME_ATTEMPTS', '3'));
  const retryMs = Number(env('UPTIME_RETRY_SECONDS', '20')) * 1000;
  const timeoutMs = Number(env('UPTIME_TIMEOUT_SECONDS', '20')) * 1000;
  const remindHours = Number(env('UPTIME_REMIND_HOURS', '6'));

  const failures = (await Promise.all(targets.map(([n, u]) => probe(n, u, attempts, retryMs, timeoutMs)))).filter(Boolean);
  const now = new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const run = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`;
  const report = failures.length
    ? failures.map((f) => `- ${f.name} (${f.url}): ${f.error}`).join('\n')
    : targets.map(([n, u]) => `- ${n} (${u}): up`).join('\n');

  const [open] = await gh(`/issues?state=open&labels=${LABEL}&per_page=1&sort=created&direction=desc`);
  const issue = open ? { number: open.number, lastActivityAt: open.updated_at, url: open.html_url } : null;
  const { action } = decide({ failures, issue, now, remindHours });
  console.log(failures.length ? `DOWN:\n${report}` : 'All up.');
  console.log(`Action: ${action}${issue ? ` (issue #${issue.number})` : ''}`);

  if (action === 'open') {
    // The label is created on first use; an existing one is fine.
    await gh('/labels', { method: 'POST', body: JSON.stringify({ name: LABEL, color: 'B60205', description: 'Opened and closed by the uptime workflow' }) }).catch(() => {});
    const created = await gh('/issues', {
      method: 'POST',
      body: JSON.stringify({
        title: `Down: ${failures.map((f) => f.name).join(', ')} (since ${stamp})`,
        labels: [LABEL],
        body: `The uptime check could not reach:\n\n${report}\n\nChecked ${stamp} after ${attempts} attempt(s) each. This issue is closed automatically when everything answers again.\n\nRun: ${run}`,
      }),
    });
    await email(`DOWN: ${failures.map((f) => f.name).join(', ')}`, `${report}\n\nSince ${stamp}.\n${created.html_url}`);
  } else if (action === 'remind') {
    await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Still down at ${stamp}:\n\n${report}\n\nRun: ${run}` }) });
    await email(`STILL DOWN: ${failures.map((f) => f.name).join(', ')}`, `${report}\n\nChecked ${stamp}.\n${issue.url}`);
  } else if (action === 'close') {
    await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Recovered at ${stamp}:\n\n${report}` }) });
    await gh(`/issues/${issue.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
    await email('RECOVERED: all checks up', `${report}\n\nRecovered at ${stamp}.\n${issue.url}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
