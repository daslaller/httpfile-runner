import { spawn }        from 'child_process';
import path              from 'path';
import os                from 'os';
import fs                from 'fs';
import { parseReport }   from './report-parser';
import { parseStdout }   from './parser';

export * from './types';
export * from './env';

import type { RunOptions, RunResult, RequestResult } from './types';

const BUNDLED_IJHTTP = path.resolve(
  __dirname, '..', '..', '..', 'ijhttp',
  os.platform() === 'win32' ? 'ijhttp.bat' : 'ijhttp',
);

export async function run(options: RunOptions): Promise<RunResult> {
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
  const args      = buildArgs({ env, envFile, privateEnvFile, variables, logLevel, reportDir, files });

  return new Promise((resolve, reject) => {
    const isWin = os.platform() === 'win32';
    const proc  = spawn(ijhttpPath, args, { shell: isWin });
    const chunks = { out: [] as string[], err: [] as string[] };
    let timer: NodeJS.Timeout | undefined;

    if (timeout) {
      timer = setTimeout(() => {
        proc.kill();
        reject(new Error(`ijhttp timed out after ${timeout}ms`));
      }, timeout);
    }

    proc.stdout.on('data', (d: Buffer) => chunks.out.push(d.toString()));
    proc.stderr.on('data', (d: Buffer) => chunks.err.push(d.toString()));
    proc.on('error', (err) => { clearTimeout(timer); reject(err); });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      const stdout = chunks.out.join('');
      const stderr = chunks.err.join('');
      let requests: RequestResult[] = [];

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
        exitCode:   exitCode ?? 1,
        requests,
        passed,
        failed,
        total:      requests.length,
        stdout,
        stderr,
        ...(report ? { reportDir } : {}),
      });
    });
  });
}

export function printSummary(result: RunResult): void {
  const { requests, passed, failed, total, exitCode } = result;
  console.log(`\nijhttp run — ${total} request(s), ${passed} passed, ${failed} failed\n`);

  for (const r of requests) {
    const icon = r.status === 'passed'  ? '✓'
               : r.status === 'skipped' ? '—'
               : '✗';
    const dur = r.duration ? ` (${r.duration}ms)` : '';
    console.log(`  ${icon} ${r.name}${dur}`);
    if (r.message) console.log(`      ${r.message}`);
  }

  console.log();
  if (exitCode !== 0 && !failed) console.log(`  ijhttp exited with code ${exitCode}`);
}

function buildArgs(opts: {
  env?: string; envFile?: string; privateEnvFile?: string;
  variables: Record<string, string>; logLevel?: string;
  reportDir: string; files: string[];
}): string[] {
  const args: string[] = [];
  if (opts.env)            args.push('--env',              opts.env);
  if (opts.envFile)        args.push('--env-file',         opts.envFile);
  if (opts.privateEnvFile) args.push('--private-env-file', opts.privateEnvFile);
  if (opts.logLevel)       args.push('--log-level',        opts.logLevel);
  args.push('--report', opts.reportDir);
  for (const [k, v] of Object.entries(opts.variables)) args.push('-D', `${k}=${v}`);
  args.push(...opts.files);
  return args;
}

function readReportDir(dir: string): RequestResult[] {
  const xmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
  if (!xmlFiles.length) throw new Error('No XML report files found');
  return xmlFiles.flatMap(f => parseReport(fs.readFileSync(path.join(dir, f), 'utf8')));
}
