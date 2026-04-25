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
 * @property {string}                [env]
 * @property {string}                [envFile]
 * @property {string}                [privateEnvFile]
 * @property {Record<string,string>} [variables]
 */

const httpyac = require('httpyac');
const path    = require('path');
const fs      = require('fs');

/**
 * Run one or more .http files via httpyac (no Java required).
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
  } = options;

  if (!files.length) throw new Error('run() requires at least one .http file path');

  const requests = [];

  for (const file of files) {
    const httpFile = await httpyac.io.fileProvider.parse(
      path.resolve(file),
      { envFile, privateEnvFile },
    );

    const context = {
      variables: { ...variables },
      activeEnvironments: env ? [env] : [],
    };

    for (const httpRegion of httpFile.httpRegions) {
      if (!httpRegion.request) continue;

      const name  = httpRegion.symbol?.name ?? httpRegion.request.url ?? 'Unknown';
      const start = Date.now();

      try {
        const response = await httpyac.send({
          httpFile,
          httpRegion,
          context,
        });

        const statusCode = response?.response?.statusCode;
        const duration   = Date.now() - start;
        const testsFailed = response?.testResults?.some(t => !t.result);

        requests.push({
          name,
          file:       path.basename(file),
          status:     testsFailed ? 'failed' : (statusCode >= 400 ? 'failed' : 'passed'),
          statusCode,
          duration,
          message:    testsFailed
            ? response.testResults.find(t => !t.result)?.message
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
