import http from 'node:http';

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
const port = Number(process.env.PORT || 10000);

if (!commit) {
  console.error('[release-gate] RENDER_GIT_COMMIT is missing; refusing production startup.');
  process.exit(1);
}

let gateServer = null;

const closeGateServer = async () => {
  if (!gateServer?.listening) return;
  await new Promise((resolve) => gateServer.close(() => resolve()));
};

const exitGate = async (code) => {
  await closeGateServer();
  process.exit(code);
};

// Render scans for an open PORT while a new revision starts. The CI gate can take
// several minutes, so expose a temporary *not-ready* HTTP listener while waiting.
// Returning 503 on the health path prevents the gated revision from receiving
// production traffic until the required GitHub workflow succeeds.
gateServer = http.createServer((request, response) => {
  response.statusCode = 503;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify({
    ok: false,
    status: 'waiting-for-ci',
    workflow: workflowName,
    commit: commit.slice(0, 12),
    path: request.url || '/',
  }));
});

await new Promise((resolve, reject) => {
  const onError = (error) => {
    gateServer?.off('listening', onListening);
    reject(error);
  };
  const onListening = () => {
    gateServer?.off('error', onError);
    resolve();
  };
  gateServer.once('error', onError);
  gateServer.once('listening', onListening);
  gateServer.listen(port, '0.0.0.0');
}).catch((error) => {
  console.error('[release-gate] Unable to open temporary Render gate listener.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

console.log(`[release-gate] Temporary not-ready listener active on 0.0.0.0:${port} while waiting for CI.`);

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
        await exitGate(0);
      }

      console.error(`[release-gate] "${workflowName}" completed with ${run.conclusion || 'unknown'}; refusing production startup.`);
      await exitGate(1);
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
await exitGate(1);
