import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { openPostgres, PG_CONNECT_TIMEOUT_MS } from "@/server/db/client";

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();
afterEach(async () => {
  // server.close() waits for open connections, so drop them first.
  sockets.forEach((s) => s.destroy());
  sockets.clear();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

/** A server that accepts TCP connections and never answers, like a suspended database waking up. */
async function silentServer(): Promise<number> {
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

describe("PostgreSQL connection bounds", () => {
  it("defaults to a 15 second connection timeout", () => {
    expect(PG_CONNECT_TIMEOUT_MS).toBe(15_000);
  });

  it("fails fast instead of hanging when the server accepts the socket but never responds", async () => {
    const port = await silentServer();
    const started = Date.now();
    await expect(openPostgres(`postgres://u:p@127.0.0.1:${port}/db`, { connectionTimeoutMs: 400 })).rejects.toThrow(/timeout/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("rejects an unreachable server with a connection error, not a hang", async () => {
    const port = await silentServer();
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    await expect(openPostgres(`postgres://u:p@127.0.0.1:${port}/db`, { connectionTimeoutMs: 400 })).rejects.toThrow();
  });

  it("applies the same timeout to a dedicated migration URL", async () => {
    const port = await silentServer();
    await expect(openPostgres("postgres://u:p@127.0.0.1:1/db", { migrationUrl: `postgres://u:p@127.0.0.1:${port}/db`, connectionTimeoutMs: 400 })).rejects.toThrow(/timeout/i);
  });
});
