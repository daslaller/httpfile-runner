import fs   from 'fs';
import path from 'path';

const ENV_FILE         = 'http-client.env.json';
const PRIVATE_ENV_FILE = 'http-client.private.env.json';

export interface EnvFiles {
  envFile:        string | null;
  privateEnvFile: string | null;
}

export function readEnv(opts: {
  envFile:          string;
  privateEnvFile?:  string;
  env:              string;
}): Record<string, string> {
  const pub  = readJsonEnvFile(opts.envFile, opts.env);
  const priv = opts.privateEnvFile ? readJsonEnvFile(opts.privateEnvFile, opts.env) : {};
  return { ...pub, ...priv };
}

export function discoverEnvFiles(startDir: string, stopAt?: string): EnvFiles {
  const dir    = fs.statSync(startDir).isDirectory() ? startDir : path.dirname(startDir);
  let current  = path.resolve(dir);
  const root   = stopAt ? path.resolve(stopAt) : path.parse(current).root;

  while (true) {
    const candidate        = path.join(current, ENV_FILE);
    const privateCandidate = path.join(current, PRIVATE_ENV_FILE);

    if (fs.existsSync(candidate)) {
      return {
        envFile:        candidate,
        privateEnvFile: fs.existsSync(privateCandidate) ? privateCandidate : null,
      };
    }

    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return { envFile: null, privateEnvFile: null };
}

export function listEnvNames(envFilePath: string): string[] {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(envFilePath, 'utf8')));
  } catch {
    return [];
  }
}

function readJsonEnvFile(filePath: string, env: string): Record<string, string> {
  try {
    const raw   = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const base  = raw[''] ?? {};
    const named = raw[env] ?? {};
    return { ...base, ...named };
  } catch {
    return {};
  }
}
