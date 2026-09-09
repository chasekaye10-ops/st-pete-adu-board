export type FetchResult = { ok: true; data: unknown; finalUrl?: string } | { ok: false; error: string };
export type Fetcher = (url: string) => Promise<FetchResult>;

export function createFetcher(fetchImpl: typeof fetch = fetch, timeoutMs = 15000, maxBytes = 2_000_000, format: 'json' | 'text' = 'json'): Fetcher {
  return async url => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = async (): Promise<FetchResult> => {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('Empty response');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let body = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        return { ok: true, data: format === 'json' ? JSON.parse(body) : body,
          ...(response.url ? { finalUrl: response.url } : {}) };
      } finally {
        void reader.cancel().catch(() => {});
      }
    };
    try {
      return await Promise.race([
        request(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error(`Timeout after ${timeoutMs}ms`)); }, timeoutMs);
        }),
      ]);
    } catch (error) {
      controller.abort();
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createTextFetcher(fetchImpl: typeof fetch = fetch): Fetcher {
  return createFetcher(fetchImpl, 15000, 2_000_000, 'text');
}
