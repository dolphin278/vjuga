import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as net from "node:net";
import { EventEmitter } from "node:events";
import * as HttpServer from "../HttpServer.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Send raw HTTP data over a TCP connection and collect the response. */
function rawRequest(port: number, data: string | Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      socket.write(data);
    });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
    // Close our side after a short delay (server uses keep-alive)
    setTimeout(() => socket.end(), 50);
  });
}

/** Parse status code from raw HTTP response. */
function parseStatus(response: string): number {
  return parseInt(response.split(" ")[1], 10);
}

/** Parse body from raw HTTP response (after \r\n\r\n). */
function parseBody(response: string): string {
  const idx = response.indexOf("\r\n\r\n");
  return idx >= 0 ? response.substring(idx + 4) : "";
}

/** Parse a specific header from raw HTTP response. */
function parseHeader(response: string, name: string): string | null {
  const lower = name.toLowerCase();
  const headerSection = response.substring(0, response.indexOf("\r\n\r\n"));
  for (const line of headerSection.split("\r\n").slice(1)) {
    const colon = line.indexOf(":");
    if (colon >= 0 && line.substring(0, colon).toLowerCase() === lower) {
      return line.substring(colon + 1).trim();
    }
  }
  return null;
}

// ── Tests ───────────────────────────────────────────────────────────

test("make + listen + close lifecycle", async () => {
  const server = HttpServer.make((_req, socket) => {
    HttpServer.respond(socket, 200, '{"ok":true}');
  });

  await HttpServer.listen(server, 0); // port 0 = OS-assigned
  const port = getPort(server);
  assert.ok(port > 0, "Server should be listening on a port");

  const response = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(response), 200);
  assert.equal(parseBody(response), '{"ok":true}');

  await HttpServer.close(server);
});

test("GET request parsing: method, url, pathEnd, qIdx", async () => {
  const captures: Array<{ method: number; url: string; pathEnd: number; qIdx: number }> = [];

  const server = HttpServer.make((req, socket) => {
    captures.push({ method: req.method, url: req.url, pathEnd: req.pathEnd, qIdx: req.qIdx });
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // GET without query string
  await rawRequest(port, "GET /users/42 HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(captures.length, 1);
  assert.equal(captures[0].method, HttpServer.GET);
  assert.equal(captures[0].url, "/users/42");
  assert.equal(captures[0].pathEnd, 9);
  assert.equal(captures[0].qIdx, -1);

  // GET with query string
  await rawRequest(port, "GET /users?offset=0&limit=20 HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(captures.length, 2);
  assert.equal(captures[1].url, "/users?offset=0&limit=20");
  assert.equal(captures[1].pathEnd, 6);
  assert.equal(captures[1].qIdx, 6);

  await HttpServer.close(server);
});

test("POST request parsing: body extraction", async () => {
  let capturedBody: string | null = null;
  let capturedMethod: number = 0;

  const server = HttpServer.make((req, socket) => {
    capturedBody = req.body;
    capturedMethod = req.method;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const body = '{"user":"test","pass":"secret"}';
  await rawRequest(
    port,
    `POST /auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
  );

  assert.equal(capturedMethod, HttpServer.POST);
  assert.equal(capturedBody, body);

  await HttpServer.close(server);
});

test("PUT request parsing", async () => {
  let capturedMethod = 0;
  let capturedBody: string | null = null;

  const server = HttpServer.make((req, socket) => {
    capturedMethod = req.method;
    capturedBody = req.body;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const body = '{"name":"updated"}';
  await rawRequest(
    port,
    `PUT /users/1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
  );

  assert.equal(capturedMethod, HttpServer.PUT);
  assert.equal(capturedBody, body);
  await HttpServer.close(server);
});

test("DELETE request parsing", async () => {
  let capturedMethod = 0;

  const server = HttpServer.make((req, socket) => {
    capturedMethod = req.method;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  await rawRequest(port, "DELETE /users/1 HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(capturedMethod, HttpServer.DELETE);
  await HttpServer.close(server);
});

test("unknown method sets method to 0", async () => {
  let capturedMethod = -1;

  const server = HttpServer.make((req, socket) => {
    capturedMethod = req.method;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  await rawRequest(port, "OPTIONS / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(capturedMethod, 0);
  await HttpServer.close(server);
});

test("GET request has null body", async () => {
  let capturedBody: string | null = "not-null";

  const server = HttpServer.make((req, socket) => {
    capturedBody = req.body;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  await rawRequest(port, "GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(capturedBody, null);
  await HttpServer.close(server);
});

test("getHeader: case-insensitive header lookup", async () => {
  let hostValue: string | null = null;
  let ctValue: string | null = null;
  let missingValue: string | null = "not-null";

  const server = HttpServer.make((req, socket) => {
    hostValue = HttpServer.getHeader(req, "Host");
    ctValue = HttpServer.getHeader(req, "content-type");
    missingValue = HttpServer.getHeader(req, "X-Missing");
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  await rawRequest(
    port,
    "POST /data HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
  );

  assert.equal(hostValue, "example.com");
  assert.equal(ctValue, "application/json");
  assert.equal(missingValue, null);
  await HttpServer.close(server);
});

test("getHeader: returns null when header section is empty", async () => {
  let result: string | null = "not-null";

  const server = HttpServer.make((req, socket) => {
    result = HttpServer.getHeader(req, "Host");
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Minimal request with no headers (just request line + empty line)
  await rawRequest(port, "GET / HTTP/1.1\r\n\r\n");
  assert.equal(result, null);
  await HttpServer.close(server);
});

test("respond: JSON with various status codes", async () => {
  const server = HttpServer.make((req, socket) => {
    if (req.url === "/ok") HttpServer.respond(socket, 200, '{"ok":true}');
    else if (req.url === "/created") HttpServer.respond(socket, 201, '{"id":1}');
    else if (req.url === "/bad") HttpServer.respond(socket, 400, '{"error":"bad"}');
    else if (req.url === "/not-found") HttpServer.respond(socket, 404, '{"error":"nf"}');
    else HttpServer.respond(socket, 500, '{"error":"ise"}');
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r200 = await rawRequest(port, "GET /ok HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(r200), 200);
  assert.equal(parseBody(r200), '{"ok":true}');
  assert.equal(parseHeader(r200, "Content-Type"), "application/json");
  assert.ok(parseHeader(r200, "Content-Length"));

  const r404 = await rawRequest(port, "GET /not-found HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(r404), 404);

  await HttpServer.close(server);
});

test("respond: custom content type", async () => {
  const server = HttpServer.make((_req, socket) => {
    HttpServer.respond(socket, 200, "hello world", "text/plain");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseHeader(r, "Content-Type"), "text/plain");
  assert.equal(parseBody(r), "hello world");
  await HttpServer.close(server);
});

test("respondRaw + precompute: pre-built responses", async () => {
  const healthResponse = HttpServer.precompute(200, '{"ok":true}');
  const errorResponse = HttpServer.precompute(404, '{"error":"not found"}', "application/json");

  const server = HttpServer.make((req, socket) => {
    if (req.url === "/health") HttpServer.respondRaw(socket, healthResponse);
    else HttpServer.respondRaw(socket, errorResponse);
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r1 = await rawRequest(port, "GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(r1), 200);
  assert.equal(parseBody(r1), '{"ok":true}');

  const r2 = await rawRequest(port, "GET /missing HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(r2), 404);
  assert.equal(parseBody(r2), '{"error":"not found"}');

  await HttpServer.close(server);
});

test("respondBuffer: Buffer body with custom content type", async () => {
  const body = Buffer.from("binary data here");

  const server = HttpServer.make((_req, socket) => {
    HttpServer.respondBuffer(socket, 200, body, "application/octet-stream");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(r), 200);
  assert.equal(parseHeader(r, "Content-Type"), "application/octet-stream");
  assert.equal(parseBody(r), "binary data here");
  await HttpServer.close(server);
});

test("keep-alive: multiple requests on same connection", async () => {
  let count = 0;

  const server = HttpServer.make((_req, socket) => {
    count++;
    HttpServer.respond(socket, 200, `{"n":${count}}`);
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Send two requests on the same TCP connection
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      socket.write("GET /a HTTP/1.1\r\nHost: localhost\r\n\r\n");
      // Send second request after brief delay
      setTimeout(() => {
        socket.write("GET /b HTTP/1.1\r\nHost: localhost\r\n\r\n");
        setTimeout(() => socket.end(), 50);
      }, 30);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });

  // Should have two HTTP responses
  const parts = response.split("HTTP/1.1 200 OK");
  assert.equal(parts.length, 3, "Should have 2 responses (3 parts when split)");
  assert.ok(response.includes('{"n":1}'));
  assert.ok(response.includes('{"n":2}'));

  await HttpServer.close(server);
});

test("pipelining: multiple requests in one TCP segment", async () => {
  const urls: string[] = [];

  const server = HttpServer.make((req, socket) => {
    urls.push(req.url);
    HttpServer.respond(socket, 200, `{"url":"${req.url}"}`);
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Send two requests in a single write (pipelining)
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      socket.write(
        "GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n" +
          "GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n",
      );
      setTimeout(() => socket.end(), 50);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });

  assert.deepEqual(urls, ["/first", "/second"]);
  assert.ok(response.includes('{"url":"/first"}'));
  assert.ok(response.includes('{"url":"/second"}'));
  await HttpServer.close(server);
});

test("partial request: data split across TCP segments", async () => {
  let capturedBody: string | null = null;

  const server = HttpServer.make((req, socket) => {
    capturedBody = req.body;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Split a POST request across multiple writes
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      // Send headers first
      socket.write("POST /data HTTP/1.1\r\nHost: localhost\r\nContent-Le");
      // Send rest of headers + partial body after delay
      setTimeout(() => {
        socket.write('ngth: 15\r\n\r\n{"key":"val');
        // Send rest of body
        setTimeout(() => {
          socket.write('ue"}');
          setTimeout(() => socket.end(), 50);
        }, 20);
      }, 20);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });

  assert.equal(capturedBody, '{"key":"value"}');
  assert.equal(parseStatus(response), 200);
  await HttpServer.close(server);
});

test("Content-Length: lowercase header variant", async () => {
  let capturedBody: string | null = null;

  const server = HttpServer.make((req, socket) => {
    capturedBody = req.body;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  await rawRequest(port, "POST / HTTP/1.1\r\nHost: localhost\r\ncontent-length: 4\r\n\r\ntest");

  assert.equal(capturedBody, "test");
  await HttpServer.close(server);
});

test("POST without Content-Length has null body", async () => {
  let capturedBody: string | null = "not-null";

  const server = HttpServer.make((req, socket) => {
    capturedBody = req.body;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  await rawRequest(port, "POST / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(capturedBody, null);
  await HttpServer.close(server);
});

test("respond: handles unicode body (byteLength != length)", async () => {
  const server = HttpServer.make((_req, socket) => {
    HttpServer.respond(socket, 200, '{"emoji":"😀"}');
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseBody(r), '{"emoji":"😀"}');
  // Content-Length should be byte length (16), not string length (14)
  assert.equal(parseHeader(r, "Content-Length"), String(Buffer.byteLength('{"emoji":"😀"}')));
  await HttpServer.close(server);
});

test("precompute: custom content type", async () => {
  const buf = HttpServer.precompute(200, "plain text", "text/plain");
  const str = buf.toString("utf8");
  assert.ok(str.includes("Content-Type: text/plain"));
  assert.ok(str.includes("plain text"));
  assert.ok(str.includes("Content-Length: 10"));
});

test("precompute: defaults to JSON content type", async () => {
  const buf = HttpServer.precompute(200, "{}");
  const str = buf.toString("utf8");
  assert.ok(str.includes("Content-Type: application/json"));
});

test("precompute: unknown status code uses 'Unknown' text", async () => {
  const buf = HttpServer.precompute(418, '{"teapot":true}');
  const str = buf.toString("utf8");
  assert.ok(str.includes("HTTP/1.1 418 Unknown"));
});

test("respond: unknown status code works", async () => {
  const server = HttpServer.make((_req, socket) => {
    HttpServer.respond(socket, 418, '{"teapot":true}');
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(r), 418);
  await HttpServer.close(server);
});

test("socket error does not crash the server", async () => {
  const server = HttpServer.make((_req, socket) => {
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Connect and immediately destroy (triggers ECONNRESET)
  const socket = net.createConnection({ port, host: "127.0.0.1" });
  socket.on("connect", () => socket.destroy());
  await new Promise((r) => setTimeout(r, 50));

  // Server should still work after the error
  const r = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.equal(parseStatus(r), 200);
  await HttpServer.close(server);
});

test("buffer growth: request larger than initial buffer", async () => {
  let capturedBody: string | null = null;

  const server = HttpServer.make((req, socket) => {
    capturedBody = req.body;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Send a body larger than the initial 8KB buffer
  const largeBody = "x".repeat(16384);
  await rawRequest(
    port,
    `POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${largeBody.length}\r\n\r\n${largeBody}`,
  );

  assert.equal(capturedBody, largeBody);
  await HttpServer.close(server);
});

test("respond: unknown status code with custom content type", async () => {
  const server = HttpServer.make((_req, socket) => {
    HttpServer.respond(socket, 418, "teapot", "text/plain");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.ok(r.startsWith("HTTP/1.1 418 Unknown"));
  assert.equal(parseBody(r), "teapot");
  await HttpServer.close(server);
});

test("respondBuffer: unknown status code uses 'Unknown' text", async () => {
  const body = Buffer.from("teapot");

  const server = HttpServer.make((_req, socket) => {
    HttpServer.respondBuffer(socket, 418, body, "text/plain");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const r = await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  assert.ok(r.startsWith("HTTP/1.1 418 Unknown"));
  assert.equal(parseBody(r), "teapot");
  await HttpServer.close(server);
});

test("partial second request after pipelined first: buffer compaction", async () => {
  const urls: string[] = [];

  const server = HttpServer.make((req, socket) => {
    urls.push(req.url);
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Send one complete request + an incomplete second request in one TCP write.
  // After processing the first, the incomplete second stays in the buffer → compaction.
  // Then we send the rest of the second request.
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      // One complete GET + partial second GET (only the first 10 bytes of it)
      socket.write("GET /first HTTP/1.1\r\nHost: localhost\r\n\r\nGET /seco");
      setTimeout(() => {
        // Complete the second request
        socket.write("nd HTTP/1.1\r\nHost: localhost\r\n\r\n");
        setTimeout(() => socket.end(), 50);
      }, 30);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });

  assert.deepEqual(urls, ["/first", "/second"]);
  assert.ok(response.includes("{}"));
  await HttpServer.close(server);
});

test("very short request data (< 18 bytes): waits for more", async () => {
  let capturedUrl: string | null = null;

  const server = HttpServer.make((req, socket) => {
    capturedUrl = req.url;
    HttpServer.respond(socket, 200, "{}");
  });

  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Send < 18 bytes initially, then complete the request
  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
      socket.write("GET /");
      setTimeout(() => {
        socket.write("tiny HTTP/1.1\r\nHost: localhost\r\n\r\n");
        setTimeout(() => socket.end(), 50);
      }, 30);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });

  assert.equal(capturedUrl, "/tiny");
  assert.equal(parseStatus(response), 200);
  await HttpServer.close(server);
});

// ── Robustness (G6-1) ───────────────────────────────────────────────

/** Write each part on its own tick, then collect everything until close/timeout. */
function sendParts(port: number, parts: Array<string | Buffer>, waitMs = 80): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let data = "";
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(data);
    };
    socket.setEncoding("utf8");
    socket.on("data", (d) => (data += d));
    socket.on("error", finish);
    socket.on("close", finish);
    socket.on("connect", async () => {
      for (const p of parts) {
        socket.write(p);
        await new Promise((r) => setTimeout(r, 15));
      }
      setTimeout(finish, waitMs);
    });
  });
}

test("stale bytes past `used` never satisfy the header terminator (G6-1)", async () => {
  const urls: string[] = [];
  const server = HttpServer.make((req, socket) => {
    urls.push(req.url);
    HttpServer.respond(socket, 200, "{}");
  });
  await HttpServer.listen(server, 0);
  const port = getPort(server);

  // Second request ends in "\r\n\r" and the stale byte right after `used` is
  // "\n" from the first request — previously matched, drove used to -1 and
  // crashed the process with ERR_OUT_OF_RANGE on the next chunk.
  const a = "GET /a HTTP/1.1\r\nX: y\r\n\r\n";
  const b = "GET /b HTTP/1.1\r\nX: z\r\n\r";
  const out = await sendParts(port, [a, b, "\n", "GET /c HTTP/1.1\r\n\r\n"]);
  assert.deepEqual(urls, ["/a", "/b", "/c"]);
  assert.equal(out.split("HTTP/1.1 200").length - 1, 3);
  await HttpServer.close(server);
});

test("a throwing handler destroys only its connection", async () => {
  const server = HttpServer.make((req, socket) => {
    if (req.url === "/boom") throw new Error("boom");
    HttpServer.respond(socket, 200, "{}");
  });
  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const out = await sendParts(port, ["GET /boom HTTP/1.1\r\n\r\n"], 200);
  assert.equal(out, "");
  const r = await rawRequest(port, "GET /ok HTTP/1.1\r\n\r\n");
  assert.equal(parseStatus(r), 200);
  await HttpServer.close(server);
});

test("oversized unterminated header block → 431 + close", async () => {
  let calls = 0;
  const server = HttpServer.make((_req, socket) => {
    calls++;
    HttpServer.respond(socket, 200, "{}");
  });
  await HttpServer.listen(server, 0);
  const port = getPort(server);

  const out = await sendParts(port, ["GET / HTTP/1.1\r\nX-Pad: " + "a".repeat(70_000)], 200);
  assert.equal(calls, 0);
  assert.ok(out.startsWith("HTTP/1.1 431 "), out);
  assert.ok(out.includes("Connection: close"));
  await HttpServer.close(server);
});

// ── In-process connections (fake socket) ────────────────────────────
//
// Deterministic coverage of framing, limits, backpressure and lifecycle:
// a fake socket is handed to the underlying net.Server's 'connection'
// listener and fed chunks synchronously.

class FakeSocket extends EventEmitter {
  out: Buffer[] = [];
  ended = false;
  destroyed = false;
  paused = false;
  timeout = -1;
  writableNeedDrain = false;
  writableLength = 0;
  setNoDelay(): void {}
  setTimeout(ms: number): void {
    this.timeout = ms;
  }
  write(d: string | Buffer): boolean {
    this.out.push(Buffer.from(d));
    return true;
  }
  ends = 0;
  end(d?: Buffer): void {
    if (d !== undefined) this.out.push(d);
    this.ended = true;
    this.ends++;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit("close");
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  cork(): void {}
  uncork(): void {}
  feed(...parts: string[]): this {
    for (const p of parts) this.emit("data", Buffer.from(p));
    return this;
  }
  text(): string {
    return Buffer.concat(this.out).toString();
  }
}

interface Seen {
  method: number;
  url: string;
  body: string | null;
  host: string | null;
}

function tcpOf(server: HttpServer.HttpServer): net.Server {
  const sym = Object.getOwnPropertySymbols(server).find((s) => s.description === "server")!;
  return (server as unknown as Record<symbol, net.Server>)[sym];
}

function fakeServer(
  options?: HttpServer.Options,
  onReq?: (req: HttpServer.Request, socket: net.Socket) => void,
): { server: HttpServer.HttpServer; seen: Seen[]; connect: () => FakeSocket } {
  const seen: Seen[] = [];
  const server = HttpServer.make((req, socket) => {
    seen.push({
      method: req.method,
      url: req.url,
      body: req.body,
      host: HttpServer.getHeader(req, "host"),
    });
    if (onReq !== undefined) onReq(req, socket);
    else HttpServer.respond(socket, 200, "{}");
  }, options);
  const connect = (): FakeSocket => {
    const s = new FakeSocket();
    tcpOf(server).emit("connection", s);
    return s;
  };
  return { server, seen, connect };
}

function statusOf(s: FakeSocket): number {
  return parseStatus(s.text());
}

test("method token is parsed in full (G6-11)", () => {
  const { seen, connect } = fakeServer();
  const methods = ["GET", "PUT", "POST", "PATCH", "DELETE", "HEAD", "FOO", "GEX", "PUX"];
  methods.push("POSX", "PATCX", "DELETX", "OPTIONS", "TRACE", "GARBAGE");
  const s = connect();
  for (const m of methods) s.feed(`${m} /${m} HTTP/1.1\r\n\r\n`);
  assert.deepEqual(
    seen.map((r) => r.method),
    [1, 3, 2, 5, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  assert.equal(HttpServer.PATCH, 5);
  assert.equal(s.ended, false);
});

test("Content-Length is honored in any position, any case, with OWS, for every method (G6-2/G6-3)", () => {
  const { seen, connect } = fakeServer();
  const smuggled = "GET /admin HTTP/1.1\r\n\r\n";
  const n = smuggled.length;
  const s = connect();
  s.feed(`POST /first HTTP/1.1\r\nContent-Length: ${n}\r\nHost: h\r\n\r\n${smuggled}`);
  s.feed(`POST /upper HTTP/1.1\r\nHost: h\r\nCONTENT-LENGTH:${n}\r\n\r\n${smuggled}`);
  s.feed(`POST /ows HTTP/1.1\r\nHost: h\r\ncontent-length: \t${n} \t\r\n\r\n${smuggled}`);
  s.feed(`DELETE /del HTTP/1.1\r\nHost: h\r\nContent-length: ${n}\r\n\r\n${smuggled}`);
  s.feed(`GET /get HTTP/1.1\r\nContent-Length: ${n}\r\n\r\n${smuggled}`);
  s.feed(`POST /dup HTTP/1.1\r\nContent-Length: 2\r\ncontent-length: 2\r\n\r\nok`);
  s.feed(`POST /zero HTTP/1.1\r\nContent-Length: 0\r\nContent-Lengthy: 9\r\n\r\n`);
  assert.deepEqual(
    seen.map((r) => [r.url, r.body]),
    [
      ["/first", smuggled],
      ["/upper", smuggled],
      ["/ows", smuggled],
      ["/del", smuggled],
      ["/get", smuggled],
      ["/dup", "ok"],
      ["/zero", null],
    ],
  );
  assert.equal(seen[0].host, "h");
  assert.equal(s.ended, false);
});

test("malformed framing → 400 + close", () => {
  const bad = [
    "POST / HTTP/1.1\r\nContent-Length: -5\r\n\r\n",
    "POST / HTTP/1.1\r\nContent-Length: \r\n\r\n",
    "POST / HTTP/1.1\r\nContent-Length: 5, 5\r\n\r\nhello",
    "POST / HTTP/1.1\r\nContent-Length: 5 x\r\n\r\nhello",
    "POST / HTTP/1.1\r\ncontent-length: 0\r\nContent-Length: 3\r\n\r\nabc",
    "POST / HTTP/1.1\r\nContent-Length : 3\r\n\r\nabc",
    "POST / HTTP/1.1\r\nContent-Length\t: 3\r\n\r\nabc",
    "POST / HTTP/1.1\r\nTransfer-Encoding : chunked\r\n\r\n",
    "POST / HTTP/1.1\r\nX: a\r\n Content-Length: 3\r\n\r\nabc", // obs-fold
    "POST / HTTP/1.1\r\nX: a\r\n\tContent-Length: 3\r\n\r\nabc",
    "GET / HTTP/1.1\r\nX: a\nContent-Length: 3\r\n\r\nabc", // bare LF
    "GET / HTTP/1.1\nHost: h\r\n\r\n", // bare LF ends the request line
    "GET\r\nHost: h\r\n\r\n", // no spaces
    " GET / HTTP/1.1\r\n\r\n", // empty method
    "GET  HTTP/1.1\r\n\r\n", // empty URL
    "GET /\r\nHost: h x\r\n\r\n", // no version
    "GET / \r\n\r\n", // empty version
    "GET /x\r\n\r\n",
  ];
  for (const req of bad) {
    const { seen, connect } = fakeServer();
    const s = connect().feed(req, "GET /after HTTP/1.1\r\n\r\n");
    assert.equal(statusOf(s), 400, JSON.stringify(req));
    assert.ok(s.text().includes("Connection: close"));
    assert.equal(s.ended, true);
    assert.equal(seen.length, 0, JSON.stringify(req));
  }
});

test("getHeader trims SP/HTAB around the value and finds the last header", () => {
  const values: Array<string | null> = [];
  const { connect } = fakeServer(undefined, (req) => {
    values.push(HttpServer.getHeader(req, "x-a"), HttpServer.getHeader(req, "X-B"));
  });
  connect().feed("GET / HTTP/1.1\r\nX-A:\t one two \t\r\nx-b:   \r\n\r\n");
  assert.deepEqual(values, ["one two", ""]);
});

test("Transfer-Encoding → 501 + close", () => {
  for (const te of [
    "Transfer-Encoding: chunked",
    "transfer-encoding:gzip",
    "TRANSFER-ENCODING: x",
  ]) {
    const { seen, connect } = fakeServer();
    const s = connect().feed(
      `POST / HTTP/1.1\r\nHost: h\r\nContent-Length: 5\r\n${te}\r\n\r\n0\r\n\r\nGET /smuggled HTTP/1.1\r\n\r\n`,
    );
    assert.equal(statusOf(s), 501);
    assert.equal(s.ended, true);
    assert.equal(seen.length, 0);
  }
  // Names that merely start like the framing headers are ordinary headers
  const { seen, connect } = fakeServer();
  connect().feed("GET / HTTP/1.1\r\nTE: trailers\r\nTransfer-Encodings: x\r\nC: y\r\nt: z\r\n\r\n");
  assert.equal(seen.length, 1);
});

test("body size limit → 413 + close (G6-4)", () => {
  {
    const { seen, connect } = fakeServer({ maxBodySize: 4 });
    const ok = connect().feed("POST / HTTP/1.1\r\nContent-Length: 4\r\n\r\nabcd");
    assert.equal(statusOf(ok), 200);
    const s = connect().feed("POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\nabcde");
    assert.equal(statusOf(s), 413);
    assert.equal(s.ended, true);
    assert.equal(seen.length, 1);
  }
  // Absurd lengths are rejected without precision loss, default limit 1 MiB
  const { connect } = fakeServer();
  const huge = connect().feed("POST / HTTP/1.1\r\nContent-Length: 99999999999999999999\r\n\r\n");
  assert.equal(statusOf(huge), 413);
  const over = connect().feed(`POST / HTTP/1.1\r\nContent-Length: ${1024 * 1024 + 1}\r\n\r\n`);
  assert.equal(statusOf(over), 413);
});

test("header size limit holds regardless of TCP chunking (G6-4)", () => {
  const { seen, connect } = fakeServer({ maxHeaderSize: 64 });
  // Complete header block over the limit, delivered in one chunk
  const a = connect().feed(`GET / HTTP/1.1\r\nX-Pad: ${"a".repeat(64)}\r\n\r\n`);
  assert.equal(statusOf(a), 431);
  assert.equal(a.ended, true);
  // Same block trickled byte by byte
  const b = connect();
  for (const ch of `GET / HTTP/1.1\r\nX-Pad: ${"a".repeat(64)}\r\n\r\n`) b.feed(ch);
  assert.equal(statusOf(b), 431);
  // Exactly at the limit is fine
  const c = connect().feed(`GET / HTTP/1.1\r\nX: ${"a".repeat(64 - 23)}\r\n\r\n`);
  assert.equal(statusOf(c), 200);
  assert.equal(seen.length, 1);
});

test("rejected connection ignores further input", () => {
  const { seen, connect } = fakeServer();
  const s = connect().feed("BAD\r\n\r\n");
  const before = s.out.length;
  s.feed("GET / HTTP/1.1\r\n\r\n");
  assert.equal(s.out.length, before);
  assert.equal(seen.length, 0);
});

test("leading empty lines before a request are ignored", () => {
  const { seen, connect } = fakeServer();
  connect().feed("\r\n\nGET /a HTTP/1.1\r\n\r\n\r\n", "\r\n", "GET /b HTTP/1.1\r\n\r\n");
  assert.deepEqual(
    seen.map((r) => r.url),
    ["/a", "/b"],
  );
});

test("body split across chunks waits without re-parsing, then dispatches once", () => {
  const { seen, connect } = fakeServer();
  const s = connect();
  s.feed(
    "POST /p HTTP/1.1\r\nContent-Length: 10\r\n\r\nab",
    "cd",
    "efgh",
    "ij",
    "GET /n HTTP/1.1\r\n\r\n",
  );
  assert.deepEqual(
    seen.map((r) => [r.url, r.body]),
    [
      ["/p", "abcdefghij"],
      ["/n", null],
    ],
  );
});

test("large buffers are released once the connection is idle", () => {
  const { seen, connect } = fakeServer();
  const body = "x".repeat(200_000);
  const s = connect();
  s.feed(`POST / HTTP/1.1\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
  s.feed("GET /next HTTP/1.1\r\n\r\n");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].body, body);
});

test("backpressure: dispatch pauses until the socket drains (G6-5)", () => {
  const { seen, connect } = fakeServer(undefined, (_req, socket) => {
    HttpServer.respond(socket, 200, "{}");
    (socket as unknown as FakeSocket).writableNeedDrain = true;
  });
  const s = connect();
  const req = "GET / HTTP/1.1\r\n\r\n";
  s.feed(req.repeat(3));
  assert.equal(seen.length, 1);
  assert.equal(s.paused, true);
  s.feed(req); // arrives while paused — buffered only
  assert.equal(seen.length, 1);
  s.writableNeedDrain = false;
  s.emit("drain");
  assert.equal(seen.length, 2); // paused again after the next response
  s.writableNeedDrain = false;
  s.emit("drain");
  s.writableNeedDrain = false;
  s.emit("drain");
  assert.equal(seen.length, 4);
  s.writableNeedDrain = false;
  s.emit("drain"); // nothing buffered
  assert.equal(seen.length, 4);
  assert.equal(s.paused, false);
});

test("handler exceptions destroy the connection and reach onError", () => {
  const errors: unknown[] = [];
  let calls = 0;
  const { connect } = fakeServer({ onError: (e) => errors.push(e) }, (req, socket) => {
    calls++;
    if (req.url === "/boom") throw new Error("boom");
    HttpServer.respond(socket, 200, "{}");
    (socket as unknown as FakeSocket).writableNeedDrain = true;
  });
  const s = connect().feed("GET /ok HTTP/1.1\r\n\r\nGET /boom HTTP/1.1\r\n\r\n");
  assert.equal(s.paused, true);
  s.writableNeedDrain = false;
  s.emit("drain"); // throws inside resume()
  assert.equal(s.destroyed, true);
  assert.equal(calls, 2);
  assert.equal((errors[0] as Error).message, "boom");
  s.feed("GET /ignored HTTP/1.1\r\n\r\n");
  assert.equal(calls, 2);
});

test("keepAliveTimeout arms a socket inactivity timeout (G6-7)", () => {
  const def = fakeServer().connect();
  assert.equal(def.timeout, 5000);
  def.emit("timeout");
  assert.equal(def.destroyed, true);
  const custom = fakeServer({ keepAliveTimeout: 20 }).connect();
  assert.equal(custom.timeout, 20);
  const off = fakeServer({ keepAliveTimeout: 0 }).connect();
  assert.equal(off.timeout, -1);
});

test("headersTimeout bounds the time to receive a header block (G6-7)", async () => {
  const { seen, connect } = fakeServer({ headersTimeout: 30 });
  const slow = connect().feed("GET / HTTP/1.1\r\n");
  slow.feed("X: 1\r\n"); // still within the deadline
  const fast = connect().feed("GET /fast HTTP/1.1\r\n\r\nGET /next");
  await new Promise((r) => setTimeout(r, 50));
  slow.feed("X: 2\r\n");
  assert.equal(slow.destroyed, true);
  fast.feed(" HTTP/1.1\r\n\r\n");
  assert.equal(fast.destroyed, true); // the pending /next started the clock
  assert.deepEqual(
    seen.map((r) => r.url),
    ["/fast"],
  );
  // A request that completes in time resets the clock; body phase is exempt
  const ok = connect().feed("POST /b HTTP/1.1\r\nContent-Length: 2\r\n\r\n");
  await new Promise((r) => setTimeout(r, 50));
  ok.feed("hi");
  assert.equal(ok.destroyed, false);
  assert.equal(seen[1].body, "hi");
  // Disabled
  const off = fakeServer({ headersTimeout: 0 });
  const s = off.connect().feed("GET / HTTP/1.1\r\n");
  await new Promise((r) => setTimeout(r, 10));
  s.feed("\r\n");
  assert.equal(off.seen.length, 1);
});

test("close() destroys idle connections and closes busy ones once idle (G6-7)", async () => {
  const { server, seen, connect } = fakeServer();
  await HttpServer.listen(server, 0);
  const idle = connect().feed("GET / HTTP/1.1\r\n\r\n");
  const flushing = connect();
  flushing.writableLength = 10;
  const midRequest = connect().feed("GET /late HTTP/1.1\r\n");
  const closed = HttpServer.close(server);
  assert.equal(idle.destroyed, true);
  assert.equal(flushing.ended, true);
  assert.equal(flushing.destroyed, false);
  assert.equal(midRequest.ended, false);
  midRequest.feed("\r\n");
  assert.equal(statusOf(midRequest), 200);
  assert.equal(midRequest.ended, true);
  assert.deepEqual(
    seen.map((r) => r.url),
    ["/", "/late"],
  );
  await closed;
});

test("close() leaves a paused connection to finish after drain", async () => {
  const { server, seen, connect } = fakeServer(undefined, (_req, socket) => {
    HttpServer.respond(socket, 200, "{}");
    (socket as unknown as FakeSocket).writableNeedDrain = true;
  });
  await HttpServer.listen(server, 0);
  const s = connect().feed("GET /1 HTTP/1.1\r\n\r\nGET /2 HTTP/1.1\r\n\r\nGET /3");
  const closed = HttpServer.close(server);
  assert.equal(s.destroyed, false);
  s.writableNeedDrain = false;
  s.emit("drain"); // dispatches /2, pauses again with /3 partial
  assert.equal(s.ended, false);
  s.writableNeedDrain = false;
  s.emit("drain");
  s.feed(" HTTP/1.1\r\n\r\n");
  assert.equal(s.ended, false); // paused after /3
  s.writableNeedDrain = false;
  s.emit("drain");
  assert.equal(s.ended, true);
  assert.equal(seen.length, 3);
  await closed;
});

test("close() over TCP resolves with an idle keep-alive client (G6-7)", async () => {
  const server = HttpServer.make((_req, socket) => HttpServer.respond(socket, 200, "{}"));
  await HttpServer.listen(server, 0);
  const port = getPort(server);
  const c = net.createConnection({ port, host: "127.0.0.1" });
  const gotResponse = new Promise((r) => c.once("data", r));
  c.on("error", () => {});
  c.on("connect", () => c.write("GET / HTTP/1.1\r\n\r\n"));
  await gotResponse;
  await HttpServer.close(server);
  c.destroy();
});

test("backpressure over TCP: a non-reading client does not grow the queue (G6-5)", async () => {
  const body = JSON.stringify("x".repeat(100_000));
  let handled = 0;
  let maxQueued = 0;
  const server = HttpServer.make((_req, socket) => {
    handled++;
    HttpServer.respond(socket, 200, body);
    maxQueued = Math.max(maxQueued, socket.writableLength);
  });
  await HttpServer.listen(server, 0);
  const port = getPort(server);
  const c = net.createConnection({ port, host: "127.0.0.1" });
  c.pause();
  c.on("error", () => {});
  await new Promise((r) => c.on("connect", r));
  c.write("GET / HTTP/1.1\r\n\r\n".repeat(2000));
  await new Promise((r) => setTimeout(r, 300));
  // Loose bound: kernel loopback buffers (multi-MB on Linux) absorb some
  assert.ok(handled < 1000, `handled ${handled}`);
  assert.ok(maxQueued < 4 * 1024 * 1024, `queued ${maxQueued}`);
  c.destroy();
  await HttpServer.close(server);
});

// ── In-flight tracking: keepAliveTimeout and close() wait for responses ──

/** Fake-socket server whose handler defers every response to the test. */
function deferredServer(options?: HttpServer.Options): {
  server: HttpServer.HttpServer;
  pending: Array<() => void>;
  connect: () => FakeSocket;
} {
  const pending: Array<() => void> = [];
  const { server, connect } = fakeServer(options, (_req, socket) => {
    pending.push(() => HttpServer.respond(socket, 200, "{}"));
  });
  return { server, pending, connect };
}

test("idle timeout is deferred while a response is in flight", () => {
  const { pending, connect } = deferredServer({ keepAliveTimeout: 50 });
  const s = connect().feed("GET / HTTP/1.1\r\n\r\n");
  s.timeout = -1;
  s.emit("timeout");
  assert.equal(s.destroyed, false);
  pending.shift()!();
  assert.equal(statusOf(s), 200);
  assert.equal(s.timeout, 50); // re-armed once idle
  s.emit("timeout");
  assert.equal(s.destroyed, true);
});

test("respond helpers tolerate foreign sockets and extra responses", () => {
  const foreign = new FakeSocket();
  HttpServer.respondRaw(foreign as unknown as net.Socket, HttpServer.precompute(200, "{}"));
  assert.equal(statusOf(foreign), 200);
  const { connect } = fakeServer(undefined, (_req, socket) => {
    HttpServer.respond(socket, 200, "{}");
    HttpServer.respondBuffer(socket, 200, Buffer.from("x"), "text/plain");
  });
  const s = connect().feed("GET / HTTP/1.1\r\n\r\n");
  assert.equal(s.text().split("HTTP/1.1 200").length - 1, 2);
});

test("close() ends a connection right after its in-flight response", async () => {
  const { server, pending, connect } = deferredServer();
  await HttpServer.listen(server, 0);
  const s = connect().feed("GET /a HTTP/1.1\r\n\r\nGET /b HTTP/1.1\r\n\r\nGET /c");
  const closed = HttpServer.close(server);
  assert.equal(s.destroyed || s.ended, false);
  pending.shift()!(); // /a answered, /b still in flight
  assert.equal(s.ended, false);
  pending.shift()!(); // /b answered, but /c is partially received
  assert.equal(s.ended, false);
  s.feed(" HTTP/1.1\r\n\r\n");
  assert.equal(s.ended, false); // /c dispatched and in flight
  pending.shift()!();
  assert.equal(s.ended, true);
  assert.equal(s.text().split("HTTP/1.1 200").length - 1, 3);
  await closed;
});

test("close() with in-flight responses on paused or rejected connections", async () => {
  const pending: Array<() => void> = [];
  const { server, connect } = fakeServer(undefined, (_req, socket) => {
    pending.push(() => HttpServer.respond(socket, 200, "{}"));
    (socket as unknown as FakeSocket).writableNeedDrain = true;
  });
  await HttpServer.listen(server, 0);
  const paused = connect().feed("GET / HTTP/1.1\r\n\r\n");
  const rejected = connect().feed("GET / HTTP/1.1\r\n\r\n");
  rejected.writableNeedDrain = false;
  rejected.emit("drain");
  rejected.feed("BAD\r\n\r\n");
  assert.equal(statusOf(rejected), 400);
  const closed = HttpServer.close(server);
  pending[0]!(); // still paused: end waits for drain
  assert.equal(paused.ended, false);
  paused.writableNeedDrain = false;
  paused.emit("drain");
  assert.equal(paused.ended, true);
  pending[1]!(); // already rejected and ended: no second end
  assert.equal(rejected.ends, 1);
  await closed;
});

test("keepAliveTimeout over TCP: a slow async handler is not cut off (G6-7)", async () => {
  const server = HttpServer.make(
    (_req, socket) => {
      setTimeout(() => HttpServer.respond(socket, 200, '{"slow":true}'), 150);
    },
    { keepAliveTimeout: 50 },
  );
  await HttpServer.listen(server, 0);
  const port = getPort(server);
  const c = net.createConnection({ port, host: "127.0.0.1" });
  let data = "";
  c.setEncoding("utf8");
  c.on("data", (d) => (data += d));
  c.on("error", () => {});
  const closedByServer = new Promise((r) => c.on("close", r));
  c.on("connect", () => c.write("GET / HTTP/1.1\r\n\r\n"));
  await closedByServer; // idle timeout after the response
  assert.equal(parseBody(data), '{"slow":true}');
  await HttpServer.close(server);
});

test("close() over TCP waits for an in-flight async response (G6-7)", async () => {
  const server = HttpServer.make((_req, socket) => {
    setTimeout(() => HttpServer.respond(socket, 200, '{"late":true}'), 80);
  });
  await HttpServer.listen(server, 0);
  const port = getPort(server);
  const c = net.createConnection({ port, host: "127.0.0.1" });
  let data = "";
  c.setEncoding("utf8");
  c.on("data", (d) => (data += d));
  c.on("error", () => {});
  const ended = new Promise((r) => c.on("end", r));
  await new Promise((r) => c.on("connect", r));
  c.write("GET / HTTP/1.1\r\n\r\n");
  await new Promise((r) => setTimeout(r, 20));
  await HttpServer.close(server);
  await ended;
  assert.equal(parseBody(data), '{"late":true}');
  c.destroy();
});

// ── Utility ─────────────────────────────────────────────────────────

function getPort(server: HttpServer.HttpServer): number {
  const sym = Object.getOwnPropertySymbols(server).find((s) => s.description === "server")!;
  const tcpServer = (server as unknown as Record<symbol, net.Server>)[sym];
  return (tcpServer.address() as net.AddressInfo).port;
}
