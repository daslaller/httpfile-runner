'use strict';

/**
 * Quick smoke-test: runs the Mygadgetrepairs v1.http workspace.
 * Adjust env / file paths as needed.
 *
 *   node example.js
 */

const path              = require('path');
const { run, printSummary } = require('./index');
const { discoverEnvFiles }  = require('./env');

const HTTP_FILE = path.resolve(__dirname, '../API/Mygadgetrepairs/v1.http');
const { envFile, privateEnvFile } = discoverEnvFiles(HTTP_FILE);

run({
  files:          [HTTP_FILE],
  envFile,
  privateEnvFile,
  // env: 'development',   // uncomment if you have a named env
  logLevel: 'BASIC',
})
  .then(result => {
    printSummary(result);
    process.exitCode = result.failed > 0 ? 1 : 0;
  })
  .catch(err => {
    console.error('Runner error:', err.message);
    process.exitCode = 2;
  });
