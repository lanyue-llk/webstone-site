import http from "node:http";
import { connect as connectSocket, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { publicEvidenceUrl } from "./prepare-data.mjs";
import { isPublicNetworkAddress } from "./check-report-access.mjs";

export async function createPublicBrowserProxy({
  resolve = lookup,
  connect = connectSocket,
  maxBytes = 100 * 1024 * 1024,
  maxConnections = 12,
  timeoutMs = 30000,
} = {}) {
  const controller = new AbortController();
  const clients = new Set(),
    upstreams = new Set();
  let bytes = 0,
    failure = null,
    closed = false;
  const destroySockets = () => {
    for (const socket of [...clients, ...upstreams]) socket.destroy();
  };
  function fail(error) {
    failure ??= error;
    controller.abort();
    destroySockets();
  }
  const server = http.createServer((_request, response) =>
    response.writeHead(403).end(),
  );
  server.on("error", fail);
  server.on("connection", (client) => {
    client.on("error", () => {});
    if (closed || clients.size >= maxConnections) {
      client.destroy();
      return;
    }
    clients.add(client);
    client.once("close", () => clients.delete(client));
    client.setTimeout(timeoutMs, () => client.destroy());
  });
  server.on("connect", async (request, client, head) => {
    let upstream;
    client.once("close", () => upstream?.destroy());
    try {
      controller.signal.throwIfAborted();
      const url = new URL("https://" + request.url);
      if (
        !publicEvidenceUrl(url.href) ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error("Invalid HTTPS proxy destination");
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      let onAbort;
      let records;
      try {
        records = await Promise.race([
          isIP(hostname)
            ? [{ address: hostname }]
            : resolve(hostname, { all: true }),
          new Promise((_, reject) => {
            onAbort = () => reject(new Error("Navigation cancelled"));
            controller.signal.addEventListener("abort", onAbort, {
              once: true,
            });
          }),
        ]);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
      controller.signal.throwIfAborted();
      if (
        client.destroyed ||
        !records.length ||
        records.some((record) => !isPublicNetworkAddress(record.address))
      )
        throw new Error("Proxy destination is private or reserved");
      upstream = connect({
        host: hostname,
        port: Number(url.port) || 443,
        autoSelectFamily: true,
        lookup: (_hostname, options, callback) => {
          const pinned = records.map((record) => ({
            address: record.address,
            family: isIP(record.address),
          }));
          if (options.all) callback(null, pinned);
          else callback(null, pinned[0].address, pinned[0].family);
        },
      });
      upstreams.add(upstream);
      upstream.on("error", () => client.destroy());
      upstream.once("close", () => {
        upstreams.delete(upstream);
        client.destroy();
      });
      upstream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes)
          fail(new Error("Report navigation exceeds its download budget"));
      });
      upstream.once("connect", () => {
        if (closed || controller.signal.aborted || client.destroyed) {
          upstream.destroy();
          return;
        }
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream).pipe(client);
      });
    } catch {
      client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const timer = setTimeout(
    () => fail(new Error("Report navigation exceeds its time budget")),
    timeoutMs,
  );
  return {
    server: "http://127.0.0.1:" + server.address().port,
    get failure() {
      return failure;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      controller.abort();
      destroySockets();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
