
//human.js

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(min = 400, max = 1200) {
  const ms = randomBetween(min, max);
  await sleep(ms);
}

module.exports = {
  sleep,
  humanDelay,
  randomBetween,
};
