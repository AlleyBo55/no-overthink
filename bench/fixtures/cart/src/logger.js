const LEVELS = ['debug', 'info', 'warn', 'error'];

export function createLogger(level = 'info') {
  const min = LEVELS.indexOf(level);
  const write = (name) => (...args) => {
    if (LEVELS.indexOf(name) >= min) console[name === 'debug' ? 'log' : name](`[${name}]`, ...args);
  };
  return Object.fromEntries(LEVELS.map((name) => [name, write(name)]));
}
