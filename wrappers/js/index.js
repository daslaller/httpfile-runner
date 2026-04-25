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
 * @property {string}          [reportDir]
 *
 * @typedef {object} RawResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 *
 * @typedef {object} RunOptions
 * @property {string|string[]}       files
 * @property {string}                [env]
 * @property {string}                [envFile]            path to http-client.env.json
 * @property {string}                [privateEnvFile]     path to http-client.private.env.json
 * @property {Record<string,string>} [variables]          -D key=value overrides
 * @property {string}                [report]             persist JUnit XML to this dir
 * @property {'BASIC'|'HEADERS'|'VERBOSE'|'NONE'} [logLevel]
 * @property {number}                [connectTimeout]     HTTP connect/read timeout passed to ijhttp (ms)
 * @property {boolean}               [insecure]           skip SSL certificate verification
 * @property {boolean}               [dockerMode]         enable Docker networking mode
 * @property {string}                [proxy]              proxy URI (e.g. socks://host:port)
 * @property {string}                [ijhttpPath]         override the bundled binary path
 * @property {number}                [processTimeout]     ms before the Node process is killed
 */

const { spawn }       = require('child_process');
const path            = require('path');
const os              = require('os');
const fs              = require('fs');
const { parseReport } = require('./report-parser');
const { parseStdout } = require('./parser');

const BUNDLED_IJHTTP = path.resolve(
  __dirname, '..', 'ijhttp',
  os.platform() === 'win32' ? 'ijhttp.bat' : 'ijhttp',
);

/**
 * Low-level wrapper — returns raw { stdout, stderr, code } from ijhttp.
 * Use this when you want to handle output yourself.
 *
 * @param {string|string[]} files
 * @param {RunOptions}      options
 * @returns {Promise<RawResult>}
 */
function runHttp(files, options = {}) {
  const fileArray    = Array.isArray(files) ? files : [files];
  const ijhttpPath   = options.ijhttpPath ?? BUNDLED_IJHTTP;
  const args         = buildArgs({ ...options, files: fileArray, reportDir: null });

  return new Promise((resolve, reject) => {
    const isWin = os.platform() === 'win32';
    const proc  = spawn(ijhttpPath, args, {
      stdio:  ['ignore', 'pipe', 'pipe'],
      shell:  isWin,
    });

    let stdout = '';
    let stderr = '';
    let timer;

    if (options.processTimeout) {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`ijhttp process timed out after ${options.processTimeout}ms`));
      }, options.processTimeout);
    }

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(new Error(`Failed to start ijhttp: ${err.message}`)); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/**
 * High-level runner — parses ijhttp output into structured RequestResult[].
 *
 * @param {RunOptions} options
 * @returns {Promise<RunResult>}
 */
async function run(options = {}) {
  const {
    files       = [],
    report,
    ijhttpPath  = BUNDLED_IJHTTP,
    processTimeout,
  } = options;

  const fileArray = Array.isArray(files) ? files : [files];
  if (!fileArray.length) throw new Error('run() requires at least one .http file path');

  const useTemp   = !report;
  const reportDir = report ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ijhttp-'));
  const args      = buildArgs({ ...options, files: fileArray, reportDir });

  return new Promise((resolve, reject) => {
    const isWin = os.platform() === 'win32';
    const proc  = spawn(ijhttpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    });

    let stdout = '';
    let stderr = '';
    let timer;

    if (processTimeout) {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`ijhttp process timed out after ${processTimeout}ms`));
      }, processTimeout);
    }

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);

      let requests = [];
      try {
        requests = readReportDir(reportDir);
      } catch {
        requests = parseStdout(stdout);
      } finally {
        if (useTemp) fs.rmSync(reportDir, { recursive: true, force: true });
      }

      const passed = requests.filter(r => r.status === 'passed').length;
      const failed = requests.filter(r => r.status !== 'passed' && r.status !== 'skipped').length;

      resolve({
        exitCode,
        requests,
        passed,
        failed,
        total: requests.length,
        stdout,
        stderr,
        ...(report ? { reportDir } : {}),
      });
    });
  });
}

/**
 * @param {RunResult} result
 */
function printSummary(result) {
  const { requests, passed, failed, total, exitCode } = result;
  console.log(`\nijhttp run — ${total} request(s), ${passed} passed, ${failed} failed\n`);
  for (const r of requests) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '—' : '✗';
    const dur  = r.duration ? ` (${r.duration}ms)` : '';
    console.log(`  ${icon} ${r.name}${dur}`);
    if (r.message) console.log(`      ${r.message}`);
  }
  console.log();
  if (exitCode !== 0 && !failed) console.log(`  ijhttp exited with code ${exitCode}`);
}

// ── internal ─────────────────────────────────────────────────────────────────

function buildArgs({ env, envFile, privateEnvFile, variables = {}, logLevel,
                     connectTimeout, insecure, dockerMode, proxy, reportDir, files }) {
  const args = [];

  if (env)            args.push('--env',              env);
  // TODO: verify exact flag names against installed ijhttp version
  if (envFile)        args.push('--env-file',         envFile);
  if (privateEnvFile) args.push('--private-env-file', privateEnvFile);
  if (logLevel)       args.push('--log-level',        logLevel);
  if (connectTimeout) args.push('--timeout',          connectTimeout.toString());
  if (insecure)       args.push('--insecure');
  if (dockerMode)     args.push('--docker-mode');
  if (proxy)          args.push('--proxy',            proxy);
  if (reportDir)      args.push('--report',           reportDir);

  for (const [k, v] of Object.entries(variables)) args.push('-D', `${k}=${v}`);

  args.push(...files);
  return args;
}

function readReportDir(dir) {
  const xmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
  if (!xmlFiles.length) throw new Error('No XML report files found');
  return xmlFiles.flatMap(f => parseReport(fs.readFileSync(path.join(dir, f), 'utf8')));
}

module.exports = { run, runHttp, printSummary, BUNDLED_IJHTTP };
