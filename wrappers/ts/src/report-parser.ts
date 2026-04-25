import type { RequestResult, RequestStatus } from './types';

export function parseReport(xml: string): RequestResult[] {
  const results: RequestResult[] = [];
  const re = /<testcase\s([^>]*?)>([\s\S]*?)<\/testcase>|<testcase\s([^>]*?)\/>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? m[3];
    const body  = m[2] ?? '';

    const name      = attr(attrs, 'name')      ?? 'Unknown';
    const classname = attr(attrs, 'classname') ?? '';
    const timeSec   = parseFloat(attr(attrs, 'time') ?? '0');

    const failureMsg = childMessage(body, 'failure');
    const errorMsg   = childMessage(body, 'error');
    const skippedMsg = childMessage(body, 'skipped');

    const status: RequestStatus =
      failureMsg != null ? 'failed'  :
      errorMsg   != null ? 'error'   :
      skippedMsg != null ? 'skipped' : 'passed';

    const result: RequestResult = {
      name,
      file:     classname,
      status,
      duration: Math.round(timeSec * 1000),
    };

    if (failureMsg != null) result.message = failureMsg;
    if (errorMsg   != null) result.message = errorMsg;

    results.push(result);
  }

  return results;
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function childMessage(body: string, tag: string): string | null {
  const self   = body.match(new RegExp(`<${tag}[^>]*message="([^"]*)"[^>]*/>`));
  const open   = body.match(new RegExp(`<${tag}[^>]*message="([^"]*)"[^>]*>`));
  const noAttr = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));

  if (self)   return self[1].trim();
  if (open)   return open[1].trim();
  if (noAttr) return noAttr[1].trim();
  if (body.includes(`<${tag}`)) return '';
  return null;
}
