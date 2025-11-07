#!/usr/bin/env node
import fs from 'node:fs/promises';
import process from 'node:process';

const login = process.env.GITHUB_LOGIN || 'simo981';
const repoLimit = Number(process.env.REPO_LIMIT || 40);
const perRepoLanguageLimit = Number(process.env.LANG_PER_REPO_LIMIT || 10);
const topLanguagesLimit = Number(process.env.LANG_TOP_LIMIT || 6);
const outputPath = new URL('../assets/contribution-languages.svg', import.meta.url);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token) {
  console.warn('⚠️  GITHUB_TOKEN not provided. Skipping language badge update.');
  process.exit(0);
}

const query = `
  query($login: String!, $repoLimit: Int!, $langLimit: Int!) {
    user(login: $login) {
      repositoriesContributedTo(
        first: $repoLimit
        includeUserRepositories: true
        privacy: PUBLIC
        contributionTypes: [COMMIT]
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        nodes {
          name
          owner { login }
          languages(first: $langLimit, orderBy: {field: SIZE, direction: DESC}) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchLanguages() {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `bearer ${token}`,
      'User-Agent': 'simo981-language-badge-script'
    },
    body: JSON.stringify({
      query,
      variables: { login, repoLimit, langLimit: perRepoLanguageLimit }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText} — ${text}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(`GraphQL returned errors: ${JSON.stringify(payload.errors)}`);
  }

  const repos = payload?.data?.user?.repositoriesContributedTo?.nodes ?? [];
  const languageMap = new Map();

  for (const repo of repos) {
    const edges = repo?.languages?.edges;
    if (!Array.isArray(edges)) continue;
    for (const edge of edges) {
      const size = edge?.size ?? 0;
      const name = edge?.node?.name;
      if (!name || !size) continue;
      const color = edge?.node?.color || '#58a6ff';
      if (!languageMap.has(name)) {
        languageMap.set(name, { size: 0, color });
      }
      const entry = languageMap.get(name);
      entry.size += size;
      if (!entry.color && color) entry.color = color;
    }
  }

  return languageMap;
}

function buildSvg(languageMap) {
  const entries = Array.from(languageMap.entries())
    .map(([name, info]) => ({ name, ...info }))
    .sort((a, b) => b.size - a.size)
    .slice(0, topLanguagesLimit);

  const total = entries.reduce((sum, lang) => sum + lang.size, 0);

  if (!entries.length || !total) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="140" role="img" aria-label="No language data">
  <style>
    text { font-family: 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
    .title { font-size: 20px; font-weight: 600; }
  </style>
  <rect width="100%" height="100%" rx="16" fill="#0d1117" />
  <text class="title" x="260" y="70" text-anchor="middle">Languages</text>
</svg>`;
  }

  const rows = entries.map((entry, index) => {
    const percent = Math.max(1, Math.round((entry.size / total) * 100));
    const y = 80 + index * 40;
    const barX = 170;
    const barWidth = 250;
    const valueWidth = Math.round((entry.size / total) * barWidth);
    const color = entry.color || '#58a6ff';

    return `
      <g>
        <circle cx="40" cy="${y - 8}" r="6" fill="${color}" />
        <text class="label" x="60" y="${y - 4}">${entry.name}</text>
        <rect class="track" x="${barX}" y="${y - 20}" width="${barWidth}" height="18" rx="9" />
        <rect class="bar" x="${barX}" y="${y - 20}" width="${Math.max(4, valueWidth)}" height="18" rx="9" fill="${color}" />
        <text class="value" x="${barX + barWidth + 15}" y="${y - 5}">${percent}%</text>
      </g>`;
  }).join('\n');

  const height = 110 + entries.length * 40;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="${height}" role="img" aria-label="Languages across contributions">
  <style>
    text { font-family: 'Segoe UI', Ubuntu, sans-serif; fill: #c9d1d9; }
    .title { font-size: 20px; font-weight: 600; }
    .label { font-size: 14px; font-weight: 500; }
    .value { font-size: 14px; fill: #8b949e; }
    .track { fill: #21262d; }
  </style>
  <rect width="100%" height="100%" rx="16" fill="#0d1117" />
  <text class="title" x="40" y="40">Languages across contributions</text>
  ${rows}
</svg>`;
}

async function main() {
  try {
    const languageMap = await fetchLanguages();
    const svg = buildSvg(languageMap);
    await fs.writeFile(outputPath, svg, 'utf8');
    console.log('✅ Contribution language badge updated.');
  } catch (error) {
    console.error('❌ Failed to update language badge:', error.message);
    process.exit(1);
  }
}

await main();
