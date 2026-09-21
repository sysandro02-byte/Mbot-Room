const enabled = String(process.env.MBOTE_ROOM_REQUIRE_CI_GATE || '').toLowerCase() === 'true';

if (!enabled) {
  console.log('[release-gate] CI deployment gate disabled.');
  process.exit(0);
}

const commit = String(process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '').trim();
const repoFullName = String(process.env.MBOTE_ROOM_GITHUB_REPOSITORY || 'sysandro02-byte/Mbot-Room').trim();
const workflowName = String(process.env.MBOTE_ROOM_REQUIRED_WORKFLOW || 'MBoteRoom CI').trim();
const timeoutMs = Math.max(60_000, Number(process.env.MBOTE_ROOM_CI_GATE_TIMEOUT_MS || 600_000));
const pollMs = Math.max(10_000, Number(process.env.MBOTE_ROOM_CI_GATE_POLL_MS || 15_000));

if (!commit) {
  console.error('[release-gate] RENDER_GIT_COMMIT is missing; refusing production startup.');
  process.exit(1);
}

const endpoint = `https://api.github.com/repos/${repoFullName}/actions/runs?head_sha=${encodeURIComponent(commit)}&per_page=30`;
const deadline = Date.now() + timeoutMs;
let lastState = 'not-found';

while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'MBoteRoom-Render-Release-Gate',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      console.warn(`[release-gate] GitHub API returned ${response.status}; retrying.`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(pollMs, retryAfter * 1000)));
      continue;
    }

    const payload = await response.json();
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    const run = runs
      .filter((item) => item?.name === workflowName)
      .sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime())[0];

    if (!run) {
      lastState = 'not-found';
      console.log(`[release-gate] Waiting for "${workflowName}" on ${commit.slice(0, 12)}…`);
    } else if (run.status === 'completed') {
      if (run.conclusion === 'success') {
        console.log(`[release-gate] "${workflowName}" passed for ${commit.slice(0, 12)}. Starting production.`);
        process.exit(0);
      }

      console.error(`[release-gate] "${workflowName}" completed with ${run.conclusion || 'unknown'}; refusing production startup.`);
      process.exit(1);
    } else {
      lastState = `${run.status || 'unknown'}`;
      console.log(`[release-gate] "${workflowName}" is ${lastState}; waiting…`);
    }
  } catch (error) {
    lastState = 'github-api-unreachable';
    console.warn('[release-gate] GitHub API unavailable; retrying.', error instanceof Error ? error.message : String(error));
  }

  await new Promise((resolve) => setTimeout(resolve, pollMs));
}

console.error(`[release-gate] Timed out while waiting for "${workflowName}" (${lastState}); refusing production startup.`);
process.exit(1);
