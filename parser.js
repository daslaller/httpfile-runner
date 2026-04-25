'use strict';

/**
 * Parses ijhttp stdout as a fallback when --report XML is unavailable.
 *
 * ijhttp stdout (BASIC log level) looks roughly like:
 *
 *   Running in 1 parallel thread
 *
 *   ### Ping orders list (v2) (line 19)
 *   > GET https://api.roapp.io/v2/orders?page=1
 *   ...
 *   < 200 OK
 *   ...
 *   Response code: 200; Time: 312ms; Content length: 1024 bytes
 *
 *   Tests passed: 1/1
 *
 * This parser is intentionally lenient — stdout format is undocumented and
 * can change between ijhttp versions.
 *
 * @param {string} stdout
 * @returns {import('./index').RequestResult[]}
 */
function parseStdout(stdout) {
  const results = [];
  const lines = stdout.split(/\r?\n/);
  let current = null;

  for (const line of lines) {
    // Request separator: "### Name (line N)" or just "### Name"
    const reqMatch = line.match(/^###\s+(.+?)(?:\s+\(line\s+\d+\))?\s*$/);
    if (reqMatch) {
      if (current) results.push(finalise(current));
      current = { name: reqMatch[1].trim(), status: 'passed', duration: 0, _lines: [] };
      continue;
    }

    if (!current) continue;
    current._lines.push(line);

    // "Response code: 200; Time: 312ms; Content length: 1024 bytes"
    const resMatch = line.match(/Response code:\s*(\d+);\s*Time:\s*(\d+)ms/);
    if (resMatch) {
      current.statusCode = parseInt(resMatch[1], 10);
      current.duration   = parseInt(resMatch[2], 10);
      if (current.statusCode >= 400) current.status = 'failed';
      continue;
    }

    // "Tests failed: N/M" or assertion failure lines
    if (/tests?\s+failed/i.test(line) || /FAILED/i.test(line)) {
      current.status = 'failed';
      if (!current.message) current.message = line.trim();
    }

    // Error lines
    if (/^\s*Error:/i.test(line) || /^error\s*:/i.test(line)) {
      current.status = 'error';
      current.message = line.replace(/^\s*error\s*:\s*/i, '').trim();
    }
  }

  if (current) results.push(finalise(current));
  return results;
}

function finalise(r) {
  const { _lines, ...rest } = r;
  return rest;
}

module.exports = { parseStdout };
