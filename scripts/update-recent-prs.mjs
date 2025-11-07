#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';

const START_TAG = '<!-- START_RECENT_PRS -->';
const END_TAG = '<!-- END_RECENT_PRS -->';
const README_PATH = new URL('../README.md', import.meta.url);

const login = process.env.GITHUB_LOGIN || 'simo981';
const prLimit = Number(process.env.PR_LIMIT || 3);
const lookbackDays = Number(process.env.PR_LOOKBACK_DAYS || 60);
const eventsPerPage = Number(process.env.EVENTS_PER_PAGE || 50);
const eventMaxPages = Number(process.env.EVENT_MAX_PAGES || 3);
const includeDrafts = (process.env.PR_INCLUDE_DRAFTS || 'false').toLowerCase() === 'true';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const baseHeaders = {
  'User-Agent': 'simo981-recent-prs-script',
  Accept: 'application/vnd.github+json'
};
if (token) {
  baseHeaders.Authorization = `Bearer ${token}`;
}

const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatStatus(pr) {
  if (pr.merged_at) return 'Merged';
  if (pr.state === 'closed') return 'Closed';
  if (pr.draft) return 'Draft';
  return 'Open';
}

async function fetchRecentPRs() {
  const prs = [];
  const seen = new Set();

  for (let page = 1; page <= eventMaxPages; page += 1) {
    const response = await fetch(
      `https://api.github.com/users/${login}/events/public?page=${page}&per_page=${eventsPerPage}`,
      { headers: baseHeaders }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub events request failed: ${response.status} ${response.statusText} — ${text}`);
    }

    const events = await response.json();
    if (!Array.isArray(events) || !events.length) {
      break;
    }

    for (const event of events) {
      if (event.type !== 'PullRequestEvent') continue;
      const eventDate = new Date(event.created_at);
      if (Number.isNaN(eventDate.getTime()) || eventDate < sinceDate) {
        continue;
      }

      const pr = event.payload?.pull_request;
      if (!pr?.html_url) continue;
      if (!includeDrafts && pr.draft) continue;

      const key = pr.html_url;
      if (seen.has(key)) continue;
      seen.add(key);

      prs.push({
        repoName: pr.head?.repo?.full_name || event.repo?.name || pr.base?.repo?.full_name || pr.url?.split('/repos/')[1] || 'Unknown',
        repoUrl: pr.base?.repo?.html_url || (event.repo?.name ? `https://github.com/${event.repo.name}` : pr.html_url.split('/pull/')[0]),
        title: pr.title || 'Pull request',
        url: pr.html_url,
        status: formatStatus(pr),
        date: pr.merged_at || pr.closed_at || pr.created_at || event.created_at
      });

      if (prs.length >= prLimit) {
        return prs;
      }
    }
  }

  return prs;
}

function buildPrMarkup(prs) {
  if (!prs.length) {
    return '<div align="center">\n  <!-- No recent pull requests available -->\n</div>';
  }

  const rows = prs
    .map((pr) => `  <tr>
    <td><code>${formatDate(pr.date)}</code></td>
    <td><a href="${pr.url}" target="_blank" rel="noopener noreferrer">${pr.title}</a></td>
    <td>${pr.status}</td>
    <td><a href="${pr.repoUrl}" target="_blank" rel="noopener noreferrer">${pr.repoName}</a></td>
  </tr>`)
    .join('\n');

  return `<div align="center">\n  <table style="width:90%;max-width:720px;border-collapse:collapse;font-family:'Segoe UI', Ubuntu, sans-serif;font-size:14px;color:#c9d1d9;">\n    <thead>\n      <tr style="text-align:left;color:#8b949e;font-size:13px;">\n        <th style="padding:6px 8px;">Date</th>\n        <th style="padding:6px 8px;">Pull Request</th>\n        <th style="padding:6px 8px;">Status</th>\n        <th style="padding:6px 8px;">Repository</th>\n      </tr>\n    </thead>\n    <tbody>\n${rows}\n    </tbody>\n  </table>\n</div>`;
}

async function updateReadme(markup) {
  const content = await fs.readFile(README_PATH, 'utf8');
  const startIndex = content.indexOf(START_TAG);
  const endIndex = content.indexOf(END_TAG);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Recent PR markers not found in README.');
  }

  const before = content.slice(0, startIndex + START_TAG.length);
  const after = content.slice(endIndex);
  const nextContent = `${before}\n${markup}\n${after}`;

  if (nextContent === content) {
    console.log('ℹ️  README already up to date (PRs).');
    return;
  }

  await fs.writeFile(README_PATH, nextContent);
  console.log('✅ README recent PRs updated.');
}

try {
  const prs = await fetchRecentPRs();
  const markup = buildPrMarkup(prs);
  await updateReadme(markup);
} catch (error) {
  console.error('❌ Failed to update recent PRs:', error.message);
  process.exit(1);
}
