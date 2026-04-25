'use strict';

/**
 * Parses a JUnit XML string produced by ijhttp --report into an array of
 * RequestResult objects.
 *
 * ijhttp writes one XML file per .http file, each a <testsuite> containing
 * one <testcase> per named request (### Name). Failed test assertions surface
 * as <failure> children; HTTP-level errors surface as <error> children.
 *
 * @param {string} xml
 * @returns {import('./index').RequestResult[]}
 */
function parseReport(xml) {
  const results = [];

  // Each <testcase> may be self-closing or have children
  const re = /<testcase\s([^>]*?)>([\s\S]*?)<\/testcase>|<testcase\s([^>]*?)\/>/g;
  let m;

  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? m[3];
    const body  = m[2] ?? '';

    const name     = attr(attrs, 'name')      ?? 'Unknown';
    const classname = attr(attrs, 'classname') ?? '';
    const timeSec  = parseFloat(attr(attrs, 'time') ?? '0');

    const failureMsg = childMessage(body, 'failure');
    const errorMsg   = childMessage(body, 'error');
    const skippedMsg = childMessage(body, 'skipped');

    /** @type {import('./index').RequestResult} */
    const result = {
      name,
      file: classname,
      duration: Math.round(timeSec * 1000),
      status: failureMsg != null ? 'failed'
            : errorMsg   != null ? 'error'
            : skippedMsg != null ? 'skipped'
            : 'passed',
    };

    if (failureMsg != null) result.message = failureMsg;
    if (errorMsg   != null) result.message = errorMsg;

    results.push(result);
  }

  return results;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Extract an XML attribute value by name from an attribute string. */
function attr(attrs, name) {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** Extract the message from a <failure>, <error>, or <skipped> element. */
function childMessage(body, tag) {
  const self   = body.match(new RegExp(`<${tag}[^>]*message="([^"]*)"[^>]*/>`));
  const open   = body.match(new RegExp(`<${tag}[^>]*message="([^"]*)"[^>]*>`));
  const noAttr = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));

  if (self)   return self[1].trim();
  if (open)   return open[1].trim();
  if (noAttr) return noAttr[1].trim();
  if (body.includes(`<${tag}`)) return '';
  return null;
}

module.exports = { parseReport };
