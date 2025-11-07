#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';

const START_TAG = '<!-- START_RECENT_COMMITS -->';
const END_TAG = '<!-- END_RECENT_COMMITS -->';
const README_PATH = new URL('../README.md', import.meta.url);

const login = process.env.GITHUB_LOGIN || 'simo981';
const commitLimit = Number(process.env.COMMIT_LIMIT || 3);
const lookbackDays = Number(process.env.COMMIT_LOOKBACK_DAYS || 45);
const eventsPerPage = Number(process.env.EVENTS_PER_PAGE || 50);
const eventMaxPages = Number(process.env.EVENT_MAX_PAGES || 2);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
const baseHeaders = {
  'User-Agent': 'simo981-recent-commits-script',
  Accept: 'application/vnd.github+json'
};
if (token) {
  baseHeaders.Authorization = `Bearer ${token}`;
}

const commitCache = new Map();

async function fetchCommitDetails(repoName, sha) {
  const cacheKey = `${repoName}@${sha}`;
  if (commitCache.has(cacheKey)) {
    return commitCache.get(cacheKey);
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${repoName}/commits/${sha}`, {
      headers: baseHeaders
    });
    if (!response.ok) {
      console.warn(`⚠️  Unable to fetch commit ${sha} for ${repoName}: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const info = {
      message: data.commit?.message?.split('\n')[0] || 'Update',
      url: data.html_url,
      date: data.commit?.author?.date || data.commit?.committer?.date || null
    };
    commitCache.set(cacheKey, info);
    return info;
  } catch (error) {
    console.warn(`⚠️  Error fetching commit ${sha} for ${repoName}: ${error.message}`);
    return null;
  }
}

async function fetchRecentCommits() {
  const commits = [];
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
      if (event.type !== 'PushEvent') continue;
      const eventDate = new Date(event.created_at);
      if (Number.isNaN(eventDate.getTime()) || eventDate < sinceDate) {
        continue;
      }

      const repoName = event.repo?.name;
      if (!repoName) continue;
      const repoUrl = `https://github.com/${repoName}`;

      const commitsInEvent = event.payload?.commits;
      if (Array.isArray(commitsInEvent) && commitsInEvent.length) {
        for (const commit of commitsInEvent) {
          const sha = commit?.sha;
          if (!sha || seen.has(sha)) continue;
          seen.add(sha);

          const message = (commit?.message || 'Update').split('\n')[0];
          const commitUrl = `https://github.com/${repoName}/commit/${sha}`;

          commits.push({
            repoName,
            repoUrl,
            message,
            url: commitUrl,
            oid: sha.slice(0, 7),
            occurredAt: eventDate.toISOString()
          });

          if (commits.length >= commitLimit) {
            return commits;
          }
        }
        continue;
      }

      const headSha = event.payload?.head;
      if (headSha && !seen.has(headSha)) {
        const details = await fetchCommitDetails(repoName, headSha);
        if (!details) {
          continue;
        }
        seen.add(headSha);
        commits.push({
          repoName,
          repoUrl,
          message: details.message,
          url: details.url || `https://github.com/${repoName}/commit/${headSha}`,
          oid: headSha.slice(0, 7),
          occurredAt: details.date || eventDate.toISOString()
        });
        if (commits.length >= commitLimit) {
          return commits;
        }
      }
    }
  }

  return commits;
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function buildCommitMarkup(commits) {
  if (!commits.length) {
    return '<div align="center">\n  <!-- No recent commits available -->\n</div>';
  }

  const rows = commits
    .map((commit) => {
      const date = formatDate(commit.occurredAt);
      return `  <tr>
    <td><code>${date}</code></td>
    <td><a href="${commit.url}" target="_blank" rel="noopener noreferrer">${commit.message}</a></td>
    <td><a href="${commit.repoUrl}" target="_blank" rel="noopener noreferrer">${commit.repoName}</a></td>
  </tr>`;
    })
    .join('\n');

  return `<div align="center">\n  <table style="width:90%;max-width:720px;border-collapse:collapse;font-family:'Segoe UI', Ubuntu, sans-serif;font-size:14px;color:#c9d1d9;">\n    <thead>\n      <tr style="text-align:left;color:#8b949e;font-size:13px;">\n        <th style="padding:6px 8px;">Date</th>\n        <th style="padding:6px 8px;">Commit</th>\n        <th style="padding:6px 8px;">Repository</th>\n      </tr>\n    </thead>\n    <tbody>\n${rows}\n    </tbody>\n  </table>\n</div>`;
}

async function updateReadme(markup) {
  const content = await fs.readFile(README_PATH, 'utf8');
  const startIndex = content.indexOf(START_TAG);
  const endIndex = content.indexOf(END_TAG);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Recent commit markers not found in README.');
  }

  const before = content.slice(0, startIndex + START_TAG.length);
  const after = content.slice(endIndex);
  const nextContent = `${before}\n${markup}\n${after}`;

  if (nextContent === content) {
    console.log('ℹ️  README already up to date.');
    return;
  }

  await fs.writeFile(README_PATH, nextContent);
  console.log('✅ README recent commits updated.');
}

try {
  const commits = await fetchRecentCommits();
  const markup = buildCommitMarkup(commits);
  await updateReadme(markup);
} catch (error) {
  console.error('❌ Failed to update recent commits:', error.message);
  process.exit(1);
}
