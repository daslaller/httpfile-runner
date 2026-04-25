import type { RequestResult } from './types';

export function parseStdout(stdout: string): RequestResult[] {
  const results: RequestResult[] = [];
  const lines = stdout.split(/\r?\n/);
  let current: (RequestResult & { _lines?: string[] }) | null = null;

  for (const line of lines) {
    const reqMatch = line.match(/^###\s+(.+?)(?:\s+\(line\s+\d+\))?\s*$/);
    if (reqMatch) {
      if (current) results.push(finalise(current));
      current = { name: reqMatch[1].trim(), status: 'passed', duration: 0, _lines: [] };
      continue;
    }

    if (!current) continue;
    current._lines!.push(line);

    const resMatch = line.match(/Response code:\s*(\d+);\s*Time:\s*(\d+)ms/);
    if (resMatch) {
      current.statusCode = parseInt(resMatch[1], 10);
      current.duration   = parseInt(resMatch[2], 10);
      if (current.statusCode >= 400) current.status = 'failed';
      continue;
    }

    if (/tests?\s+failed/i.test(line) || /FAILED/i.test(line)) {
      current.status = 'failed';
      if (!current.message) current.message = line.trim();
    }

    if (/^\s*Error:/i.test(line)) {
      current.status  = 'error';
      current.message = line.replace(/^\s*error\s*:\s*/i, '').trim();
    }
  }

  if (current) results.push(finalise(current));
  return results;
}

function finalise(r: RequestResult & { _lines?: string[] }): RequestResult {
  const { _lines, ...rest } = r;
  return rest;
}
