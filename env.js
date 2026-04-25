'use strict';

const fs   = require('fs');
const path = require('path');

const ENV_FILE         = 'http-client.env.json';
const PRIVATE_ENV_FILE = 'http-client.private.env.json';

/**
 * Read and merge a public + optional private env file for a named environment.
 *
 * @param {object} opts
 * @param {string}  opts.envFile         Path to http-client.env.json
 * @param {string} [opts.privateEnvFile] Path to http-client.private.env.json
 * @param {string}  opts.env             Environment name key inside the file
 * @returns {Record<string, string>}
 */
function readEnv({ envFile, privateEnvFile, env }) {
  const pub  = readJsonEnvFile(envFile,        env);
  const priv = privateEnvFile ? readJsonEnvFile(privateEnvFile, env) : {};
  return { ...pub, ...priv };
}

/**
 * Walk upward from a given directory looking for env files, mirroring how
 * the IntelliJ IDE resolves them relative to the open .http file.
 *
 * @param {string} startDir  Directory of the .http file (or the file itself)
 * @param {string} [stopAt]  Stop walking above this directory (default: fs root)
 * @returns {{ envFile: string|null, privateEnvFile: string|null }}
 */
function discoverEnvFiles(startDir, stopAt) {
  const dir = fs.statSync(startDir).isDirectory() ? startDir : path.dirname(startDir);
  let current = path.resolve(dir);
  const root  = stopAt ? path.resolve(stopAt) : path.parse(current).root;

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
    if (parent === current) break; // fs root
    current = parent;
  }

  return { envFile: null, privateEnvFile: null };
}

/**
 * List environment names defined inside an env file.
 *
 * @param {string} envFilePath
 * @returns {string[]}
 */
function listEnvNames(envFilePath) {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(envFilePath, 'utf8')));
  } catch {
    return [];
  }
}

// ── internal ─────────────────────────────────────────────────────────────────

function readJsonEnvFile(filePath, env) {
  try {
    const raw  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const base = raw[''] ?? {};            // unnamed defaults layer
    const named = raw[env] ?? {};
    return { ...base, ...named };
  } catch {
    return {};
  }
}

module.exports = { readEnv, discoverEnvFiles, listEnvNames };
