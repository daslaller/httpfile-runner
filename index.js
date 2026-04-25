'use strict';

/**
 * @typedef {'passed'|'failed'|'error'|'skipped'} RequestStatus
 *
 * @typedef {object} RequestResult
 * @property {string}        name
 * @property {string}        [file]
 * @property {RequestStatus} status
 * @property {number}        duration   milliseconds
 * @property {number}        [statusCode]
 * @property {string}        [message]
 *
 * @typedef {object} RunResult
 * @property {number}          exitCode
 * @property {RequestResult[]} requests
 * @property {number}          passed
 * @property {number}          failed
 * @property {number}          total
 * @property {string}          stdout
 * @property {string}          stderr
 * @property {string}          [reportDir]   present when caller supplied report option
 *
 * @typedef {object} RunOptions
 * @property {string[]}              files            .http file paths to execute
 * @property {string}                [env]            environment name from env JSON
 * @property {string}                [envFile]        explicit path to http-client.env.json
 * @property {string}                [privateEnvFile] explicit path to http-client.private.env.json
 * @property {Record<string,string>} [variables]      -D key=value overrides
 * @property {string}                [report]         persist JUnit XML here instead of a temp dir
 * @property {'BASIC'|'HEADERS'|'VERBOSE'|'NONE'} [logLevel]
 * @property {string}                [ijhttpPath]     override the bundled binary
 * @property {number}                [timeout]        ms before the process is killed
 */

const { spawn }       = require('child_process');
const path            = require('path');
const os              = require('os');
const fs              = require('fs');
const { parseReport } = require('./report-parser');
const { parseStdout } = require('./parser');

// Resolve the bundled ijhttp binary relative to this file
const BUNDLED_IJHTTP = path.resolve(
  __dirname, '..', 'ijhttp',
  os.platform() === 'win32' ? 'ijhttp.bat' : 'ijhttp',
);

/**
 * Run one or more .http files through the bundled ijhttp CLI.
 *
 * @param {RunOptions} options
 * @returns {Promise<RunResult>}
 */
async function run(options = {}) {
  const {
    files          = [],
    env,
    envFile,
    privateEnvFile,
    variables      = {},
    report,
    logLevel       = 'BASIC',
    ijhttpPath     = BUNDLED_IJHTTP,
    timeout,
  } = options;

  if (!files.length) throw new Error('run() requires at least one .http file path');

  const useTemp   = !report;
  const reportDir = report ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ijhttp-'));

  const args = buildArgs({ env, envFile, privateEnvFile, variables, logLevel, reportDir, files });

  return new Promise((resolve, reject) => {
    // On Windows, .bat files need shell:true
    const isWin  = os.platform() === 'win32';
    const proc   = spawn(ijhttpPath, args, { shell: isWin });

    const chunks = { out: [], err: [] };
    let timer;

    if (timeout) {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`ijhttp timed out after ${timeout}ms`));
      }, timeout);
    }

    proc.stdout.on('data', (d) => chunks.out.push(d.toString()));
    proc.stderr.on('data', (d) => chunks.err.push(d.toString()));

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);

      const stdout = chunks.out.join('');
      const stderr = chunks.err.join('');

      let requests = [];

      try {
        requests = readReportDir(reportDir);
      } catch {
        // XML unavailable — fall back to stdout parsing
        requests = parseStdout(stdout);
      } finally {
        if (useTemp) fs.rmSync(reportDir, { recursive: true, force: true });
      }

      const passed  = requests.filter(r => r.status === 'passed').length;
      const failed  = requests.filter(r => r.status !== 'passed' && r.status !== 'skipped').length;

      resolve({
        exitCode,
        requests,
        passed,
        failed,
        total:  requests.length,
        stdout,
        stderr,
        ...(report ? { reportDir } : {}),
      });
    });
  });
}

/**
 * Print a human-readable summary of a RunResult to stdout.
 *
 * @param {RunResult} result
 */
function printSummary(result) {
  const { requests, passed, failed, total, exitCode } = result;

  console.log(`\nijhttp run — ${total} request(s), ${passed} passed, ${failed} failed\n`);

  for (const r of requests) {
    const icon = r.status === 'passed'  ? '✓'
               : r.status === 'skipped' ? '—'
               : '✗';
    const dur  = r.duration ? ` (${r.duration}ms)` : '';
    console.log(`  ${icon} ${r.name}${dur}`);
    if (r.message) console.log(`      ${r.message}`);
  }

  console.log();
  if (exitCode !== 0 && !failed) {
    console.log(`  ijhttp exited with code ${exitCode}`);
  }
}

// ── internal ──────────────────────────────────────────────────────────────────

function buildArgs({ env, envFile, privateEnvFile, variables, logLevel, reportDir, files }) {
  const args = [];

  if (env)            args.push('--env',              env);
  if (envFile)        args.push('--env-file',         envFile);
  if (privateEnvFile) args.push('--private-env-file', privateEnvFile);
  if (logLevel)       args.push('--log-level',        logLevel);

  args.push('--report', reportDir);

  for (const [k, v] of Object.entries(variables)) {
    args.push('-D', `${k}=${v}`);
  }

  args.push(...files);
  return args;
}

function readReportDir(dir) {
  const xmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
  if (!xmlFiles.length) throw new Error('No XML report files found');

  return xmlFiles.flatMap(f =>
    parseReport(fs.readFileSync(path.join(dir, f), 'utf8')),
  );
}

module.exports = { run, printSummary, BUNDLED_IJHTTP };
