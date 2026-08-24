// Serves the fixture pages from disk over loopback.
//
// Real files rather than a string blob, so the fixture can be opened in a browser and
// debugged by hand when a test misbehaves.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export const FIXTURE_PORT = 9878;
export const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;

/** Start the fixture server. Resolves once it is accepting connections. */
export function startFixtureServer(port = FIXTURE_PORT) {
  const index = fs.readFileSync(path.join(FIXTURES, "index.html"), "utf8");
  const frame = fs.readFileSync(path.join(FIXTURES, "frame.html"), "utf8");

  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    // /ping and /detail exist purely so network-capture tests have something to fetch.
    if (url.startsWith("/ping") || url.startsWith("/detail")) {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ ok: true, url }));
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(url.startsWith("/frame") ? frame : index);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise((done) => server.close(done)),
    }));
  });
}
