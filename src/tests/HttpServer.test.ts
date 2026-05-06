import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as net from "node:net";
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

// ── Utility ─────────────────────────────────────────────────────────

function getPort(server: HttpServer.HttpServer): number {
  const sym = Object.getOwnPropertySymbols(server).find((s) => s.description === "server")!;
  const tcpServer = (server as unknown as Record<symbol, net.Server>)[sym];
  return (tcpServer.address() as net.AddressInfo).port;
}
