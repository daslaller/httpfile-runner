'use strict';

/**
 * Deployable httpyac backend.
 *
 * Identical response shape to wrappers/js — drop-in replacement that requires
 * no Java or ijhttp binary. Runs entirely in Node.js via the httpyac library,
 * making it safe to use in Cloud Functions, CI containers, or any Node env.
 *
 * @typedef {'passed'|'failed'|'error'|'skipped'} RequestStatus
 *
 * @typedef {object} RequestResult
 * @property {string}        name
 * @property {string}        [file]
 * @property {RequestStatus} status
 * @property {number}        duration
 * @property {number}        [statusCode]
 * @property {string}        [message]
 *
 * @typedef {object} RunResult
 * @property {RequestResult[]} requests
 * @property {number}          passed
 * @property {number}          failed
 * @property {number}          total
 *
 * @typedef {object} RunOptions
 * @property {string[]}              files
 * @property {string}                [env]             environment name
 * @property {Record<string,string>} [variables]       variable overrides
 */

const httpyac = require('httpyac');
const path    = require('path');
const fs      = require('fs');

// Wire the fileProvider stub to Node.js fs — required before any parse/send calls
Object.assign(httpyac.io.fileProvider, {
  EOL:          require('os').EOL,
  exists:       p  => Promise.resolve(fs.existsSync(p.toString())),
  dirname:      p  => path.dirname(p.toString()),
  hasExtension: (p, ...exts) => exts.includes(path.extname(p.toString())),
  isAbsolute:   p  => path.isAbsolute(p.toString()),
  joinPath:     (p, ...s) => path.join(p.toString(), ...s),
  readFile:     (p, enc) => fs.promises.readFile(p.toString(), enc ?? 'utf8'),
  readBuffer:   p  => fs.promises.readFile(p.toString()),
  writeBuffer:  (p, buf) => fs.promises.writeFile(p.toString(), buf),
  readdir:      p  => fs.promises.readdir(p.toString()),
  fsPath:       p  => p.toString(),
  toString:     p  => p.toString(),
});

/**
 * Run one or more .http files via httpyac (no Java required).
 *
 * @param {RunOptions} options
 * @returns {Promise<RunResult>}
 */
async function run(options = {}) {
  const {
    files     = [],
    env,
    variables = {},
  } = options;

  if (!files.length) throw new Error('run() requires at least one .http file path');

  const store    = new httpyac.store.HttpFileStore();
  const requests = [];

  for (const file of files) {
    const absPath = path.resolve(file);
    const text    = fs.readFileSync(absPath, 'utf8');

    const httpFile = await store.parse(absPath, text, {
      workingDir: path.dirname(absPath),
    });

    for (const httpRegion of httpFile.httpRegions) {
      if (!httpRegion.request) continue;

      const name  = httpRegion.symbol?.name ?? httpRegion.request.url ?? 'Unknown';
      const start = Date.now();

      try {
        const success = await httpyac.send({
          httpFile,
          httpRegion,
          variables:          { ...variables },
          activeEnvironments: env ? [env] : [],
        });

        const response    = httpRegion.response;
        const duration    = Date.now() - start;
        const testsFailed = httpRegion.testResults?.some(
          t => t.status === httpyac.TestResultStatus.FAILED,
        );

        requests.push({
          name,
          file:       path.basename(file),
          status:     !success || testsFailed        ? 'failed'
                    : (response?.statusCode ?? 0) >= 400 ? 'failed'
                    : 'passed',
          statusCode: response?.statusCode,
          duration,
          message: testsFailed
            ? httpRegion.testResults.find(t => t.status === httpyac.TestResultStatus.FAILED)?.message
            : undefined,
        });
      } catch (err) {
        requests.push({
          name,
          file:     path.basename(file),
          status:   'error',
          duration: Date.now() - start,
          message:  err.message,
        });
      }
    }
  }

  const passed = requests.filter(r => r.status === 'passed').length;
  const failed = requests.filter(r => r.status !== 'passed' && r.status !== 'skipped').length;

  return { requests, passed, failed, total: requests.length };
}

/**
 * @param {RunResult} result
 */
function printSummary(result) {
  const { requests, passed, failed, total } = result;
  console.log(`\nhttpyac run — ${total} request(s), ${passed} passed, ${failed} failed\n`);
  for (const r of requests) {
    const icon = r.status === 'passed' ? '✓' : r.status === 'skipped' ? '—' : '✗';
    const dur  = r.duration ? ` (${r.duration}ms)` : '';
    console.log(`  ${icon} ${r.name}${dur}`);
    if (r.message) console.log(`      ${r.message}`);
  }
  console.log();
}

module.exports = { run, printSummary };
