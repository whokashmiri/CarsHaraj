function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function minutes(n) {
  return n * 60 * 1000;
}

function hours(n) {
  return n * 60 * 60 * 1000;
}

module.exports = { sleep, minutes, hours };
