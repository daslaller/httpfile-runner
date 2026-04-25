'use strict';

const path                      = require('path');
const { run, printSummary }     = require('./index');

// Point this at any .http file — no ijhttp or Java needed
const HTTP_FILE = path.resolve(__dirname, '../../wrappers/js/example.js');

run({ files: [HTTP_FILE] })
  .then(result => {
    printSummary(result);
    process.exitCode = result.failed > 0 ? 1 : 0;
  })
  .catch(err => {
    console.error('Runner error:', err.message);
    process.exitCode = 2;
  });
