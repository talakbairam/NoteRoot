import * as http from "http";
import type { AddressInfo } from "net";

/** How long the browser has to finish a sign-in. */
export const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface LoopbackListener {
  /** The port that is listening (the one asked for, or the one the system picked). */
  readonly port: number;
  /** The authorization code, or undefined when the user said no, the state did not match, or the time ran out. */
  readonly code: Promise<string | undefined>;
  /** Stops the server. Call it when the sign-in is over, whatever the result. */
  close(): void;
}

/** The page the browser shows after the sign-in: plain text, nothing from outside inside it. */
function page(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>NoteRoot</title></head><body style="font-family:sans-serif;margin:3em"><h2>NoteRoot</h2><p>${message}</p></body></html>`;
}

/**
 * Starts the small server that receives the answer of an OAuth sign-in (the browser is sent back to `http://localhost:<port>/`).
 * It only answers a request with the right `state`; anything else (the icon of the tab) gets a 404. Only this computer can reach
 * it. `port` 0 lets the system pick a free port; a service that must register the address in advance gives its fixed port.
 * @throws Error (the one of the server) when the port cannot be used, for example because it is taken.
 */
export function listenForCode(
  state: string,
  messages: { done: string; failed: string },
  port = 0
): Promise<LoopbackListener> {
  return new Promise((resolve, reject) => {
    let finish: (code: string | undefined) => void = () => undefined;
    const code = new Promise<string | undefined>((done) => {
      finish = done;
    });
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/" || !url.searchParams.has("state")) {
        response.writeHead(404).end();
        return;
      }
      const good = url.searchParams.get("state") === state && url.searchParams.has("code");
      response.writeHead(good ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(page(good ? messages.done : messages.failed));
      finish(good ? (url.searchParams.get("code") ?? undefined) : undefined);
    });
    const timer = setTimeout(() => finish(undefined), LOGIN_TIMEOUT_MS);
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        code,
        close: () => {
          clearTimeout(timer);
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
}
