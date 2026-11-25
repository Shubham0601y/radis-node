import { RadisError, RadisNetworkError } from "./errors.js";

import { RADIS_API_BASE_URL } from "./config.js";

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_API_PATH = "/api/v1/cache";

/**
 * Remote client for the Radis cache API.
 * All TTL values are expressed in seconds. A TTL of 0 means no expiration.
 */
export class Radis {
  constructor({ clientKey, timeout = DEFAULT_TIMEOUT, headers = {} } = {}) {
    if (!clientKey || typeof clientKey !== "string") {
      throw new TypeError("Radis requires a clientKey string");
    }
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new TypeError("timeout must be a positive number of milliseconds");
    }

    // API hostname is centrally configured in src/config.js.
    this.baseURL = `${RADIS_API_BASE_URL.replace(/\/+$/, "")}${DEFAULT_API_PATH}`;
    this.clientKey = clientKey;
    this.timeout = timeout;
    this.headers = { ...headers };
  }

  async request(path, { method = "GET", body, signal, headers = {} } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const abortFromCaller = () => controller.abort(signal.reason);

    if (signal) {
      if (signal.aborted) abortFromCaller();
      else signal.addEventListener("abort", abortFromCaller, { once: true });
    }

    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-client-key": this.clientKey,
          ...this.headers,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await response.text();
      let payload = null;
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { message: raw };
        }
      }

      if (!response.ok || payload?.success === false) {
        throw new RadisError(
          payload?.message || `Radis API request failed with status ${response.status}`,
          {
            status: response.status,
            code: payload?.code ?? null,
            details: payload?.details ?? payload?.data ?? null,
          },
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof RadisError) throw error;
      if (error?.name === "AbortError") {
        throw new RadisNetworkError(
          signal?.aborted ? "Radis request was aborted" : `Radis request timed out after ${this.timeout}ms`,
          { cause: error },
        );
      }
      throw new RadisNetworkError("Unable to reach the Radis API", { cause: error });
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async set(key, value, ttl = 0, options = {}) {
    this.#validateKey(key);
    this.#validateTTL(ttl);
    const result = await this.request("/set", {
      method: "POST", body: { key, value, ttl }, signal: options.signal,
    });
    return result?.data ?? true;
  }

  /** Returns the cached value, or null when the key is missing. */
  async get(key, options = {}) {
    return (await this.getWithMetadata(key, options))?.value ?? null;
  }

  /** Returns { key, value, ttl }, or null when the key is missing. */
  async getWithMetadata(key, options = {}) {
    this.#validateKey(key);
    const result = await this.request(`/get/${encodeURIComponent(key)}`, { signal: options.signal });
    return result?.data ?? null;
  }

  async del(key, options = {}) {
    this.#validateKey(key);
    const result = await this.request(`/delete/${encodeURIComponent(key)}`, {
      method: "DELETE", signal: options.signal,
    });
    return Boolean(result?.data);
  }

  async exists(key, options = {}) {
    this.#validateKey(key);
    const result = await this.request(`/exists/${encodeURIComponent(key)}`, { signal: options.signal });
    return Boolean(result?.data);
  }

  async type(key, options = {}) {
    this.#validateKey(key);
    const result = await this.request(`/type/${encodeURIComponent(key)}`, { signal: options.signal });
    return result?.data ?? "none";
  }

  /** Returns remaining TTL in seconds: null=missing, 0=no expiration, >0=seconds remaining. */
  async ttl(key, options = {}) {
    this.#validateKey(key);
    const result = await this.request(`/ttl/${encodeURIComponent(key)}`, { signal: options.signal });
    return result?.data ?? null;
  }

  async persist(key, options = {}) {
    this.#validateKey(key);
    const result = await this.request("/persist", {
      method: "POST", body: { key }, signal: options.signal,
    });
    return Boolean(result?.data);
  }

  async rename(key, newKey, options = {}) {
    this.#validateKey(key);
    this.#validateKey(newKey);
    const result = await this.request("/rename", {
      method: "POST", body: { key, newKey }, signal: options.signal,
    });
    return Boolean(result?.data);
  }

  async copy(key, newKey, options = {}) {
    this.#validateKey(key);
    this.#validateKey(newKey);
    const result = await this.request("/copy", {
      method: "POST", body: { key, newKey }, signal: options.signal,
    });
    return Boolean(result?.data);
  }

  async mset(values, ttl = 0, options = {}) {
    if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length === 0) {
      throw new TypeError("values must be a non-empty object of key-value pairs");
    }
    Object.keys(values).forEach((key) => this.#validateKey(key));
    this.#validateTTL(ttl);
    const result = await this.request("/set-multiple", {
      method: "POST", body: { values, ttl }, signal: options.signal,
    });
    return Boolean(result?.data);
  }

  /** Returns an array of { key, value, ttl }; missing keys have value=null and ttl=null. */
  async mget(keys, options = {}) {
    this.#validateKeys(keys);
    const result = await this.request("/get-multiple", {
      method: "POST", body: { keys }, signal: options.signal,
    });
    return result?.data ?? [];
  }

  /** Returns the number of keys deleted. */
  async mdel(keys, options = {}) {
    this.#validateKeys(keys);
    const result = await this.request("/delete-multiple", {
      method: "DELETE", body: { keys }, signal: options.signal,
    });
    return Number(result?.data ?? 0);
  }

  async expireMultiple(keys, ttl, options = {}) {
    this.#validateKeys(keys);
    this.#validateTTL(ttl);
    if (ttl === 0) throw new TypeError("ttl must be greater than 0 for expireMultiple");
    const result = await this.request("/expire-multiple", {
      method: "POST", body: { keys, ttl }, signal: options.signal,
    });
    return Boolean(result?.data);
  }

  /** Returns the current tenant's cache-entry list as provided by the API. */
  async entries(options = {}) {
    const result = await this.request("/entries", { signal: options.signal });
    return result?.data ?? [];
  }

  // Redis-style alias.
  async delete(key, options = {}) {
    return this.del(key, options);
  }

  #validateKey(key) {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("key must be a non-empty string");
    }
  }

  #validateKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new TypeError("keys must be a non-empty array");
    }
    keys.forEach((key) => this.#validateKey(key));
  }

  #validateTTL(ttl) {
    if (!Number.isSafeInteger(ttl) || ttl < 0) {
      throw new TypeError("ttl must be a non-negative safe integer in seconds");
    }
  }
}
