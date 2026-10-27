/** Shared HTTP helpers. Every request goes through an injectable fetch. */

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<HttpResponse>;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init as RequestInit) as unknown as Promise<HttpResponse>;

export interface RequestOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  headers?: Record<string, string>;
  label?: string;
}

export async function getText(url: string, options: RequestOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const label = options.label ?? "request";
  const timeoutMs = options.timeoutMs ?? 25000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: options.headers, signal: controller.signal });
    if (!response.ok) {
      throw new HttpError(response.status, `${label} failed with HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(0, `${label} failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const text = await getText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(0, `${options.label ?? "request"} returned invalid JSON`);
  }
}