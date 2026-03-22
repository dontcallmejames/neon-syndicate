// src/lib/logger.js
// Structured JSON-lines logger. Each line is a self-contained JSON object,
// making logs easy to grep, parse, and pipe to any log aggregator.
//
// Output format:
//   {"ts":"2026-03-21T12:00:00.000Z","level":"info","module":"tick","msg":"tick complete","tick":42,"ms":314}
//
// info/log → stdout  (non-error operational events)
// warn/error → stderr (problems, non-fatal and fatal)

function log(level, module, msg, fields = {}) {
  const entry = { ts: new Date().toISOString(), level, module, msg, ...fields };
  const line = JSON.stringify(entry) + '\n';
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

const logger = {
  info:  (module, msg, fields) => log('info',  module, msg, fields),
  warn:  (module, msg, fields) => log('warn',  module, msg, fields),
  error: (module, msg, fields) => log('error', module, msg, fields),
};

module.exports = logger;
