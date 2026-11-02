const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retry(fn, { attempts = 5, baseMs = 100, maxMs = 5000, shouldRetry = () => true } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !shouldRetry(error)) break;
      const delay = Math.min(maxMs, baseMs * 2 ** attempt);
      await sleep(delay / 2 + Math.random() * (delay / 2));
    }
  }
  throw lastError;
}
