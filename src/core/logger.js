const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function makeLogger(scope = 'APP') {
  const file = path.join(LOG_DIR, `${scope.toLowerCase()}.log`);

  function write(level, msg, extra) {
    const line = `[${ts()}] [${scope}] [${level}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
    // eslint-disable-next-line no-console
    console.log(line);
    fs.appendFileSync(file, line + '\n', 'utf8');
  }

  return {
    info: (m, e) => write('INFO', m, e),
    warn: (m, e) => write('WARN', m, e),
    error: (m, e) => write('ERROR', m, e),
    debug: (m, e) => write('DEBUG', m, e)
  };
}

module.exports = { makeLogger };
