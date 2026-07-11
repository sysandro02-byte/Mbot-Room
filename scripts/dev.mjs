import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const run = (name, command, args) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, NODE_ENV: 'development' },
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      process.exitCode = code;
    }
  });

  return child;
};

const api = run('api', 'node', ['node_modules/tsx/dist/cli.mjs', 'server.ts']);
const web = run('web', 'node', ['node_modules/vite/bin/vite.js']);

const stop = () => {
  api.kill();
  web.kill();
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
