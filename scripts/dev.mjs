import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const findFreePort = async (startPort) => {
  for (let port = startPort; port < startPort + 20; port += 1) {
    const available = await new Promise((resolve) => {
      const probe = createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, () => probe.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error(`Aucun port API disponible à partir de ${startPort}.`);
};

const run = (name, command, args, env = {}) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, NODE_ENV: 'development', ...env },
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      process.exitCode = code;
    }
  });
  return child;
};

const configuredApiPort = Number(process.env.PORT || 3004);
const apiPort = await findFreePort(configuredApiPort);
if (apiPort !== configuredApiPort) console.warn(`Port API ${configuredApiPort} déjà utilisé, utilisation de ${apiPort}.`);

const api = run('api', 'node', ['node_modules/tsx/dist/cli.mjs', 'server.ts'], { PORT: String(apiPort) });
const web = run('web', 'node', ['node_modules/vite/bin/vite.js'], { VITE_API_PORT: String(apiPort) });

const stop = () => { api.kill(); web.kill(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);