export type RequestStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface RequestResult {
  name: string;
  file?: string;
  status: RequestStatus;
  duration: number;
  statusCode?: number;
  message?: string;
}

export interface RunResult {
  exitCode: number;
  requests: RequestResult[];
  passed: number;
  failed: number;
  total: number;
  stdout: string;
  stderr: string;
  reportDir?: string;
}

export interface RunOptions {
  files: string[];
  env?: string;
  envFile?: string;
  privateEnvFile?: string;
  variables?: Record<string, string>;
  report?: string;
  logLevel?: 'BASIC' | 'HEADERS' | 'VERBOSE' | 'NONE';
  ijhttpPath?: string;
  timeout?: number;
}
