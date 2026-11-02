import { retry } from './retry.js';

export function getJson(url) {
  return retry(
    async () => {
      const res = await fetch(url);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return res.json();
    },
    { shouldRetry: (error) => !error.status || error.status >= 500 },
  );
}
