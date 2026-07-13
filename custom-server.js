const http = require("http");

const origCreate = http.createServer.bind(http);

// Wrap Next standalone HTTP server: derive client IP from the TCP socket
// (unspoofable) and strip client-supplied forwarding headers so downstream
// rate-limiting keys on the real peer address instead of attacker-controlled XFF.
// When running behind a TRUSTED reverse proxy (e.g. Caddy/nginx on loopback),
// the TCP socket is the proxy hop, so the real client IP must come from the
// proxy's X-Forwarded-For header. Only honor it when explicitly opted in via
// TRUST_PROXY=true; otherwise a directly-exposed server would let clients spoof
// XFF to dodge the login rate-limiter.
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

http.createServer = (...args) => {
  const handler = args.find((a) => typeof a === "function");
  const rest = args.filter((a) => typeof a !== "function");
  if (!handler) return origCreate(...args);
  const wrapped = (req, res) => {
    const socketIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
    const xff = req.headers["x-forwarded-for"];
    const xRealIp = req.headers["x-real-ip"];
    const viaProxy = !!(xff || xRealIp);
    const isLoopbackProxy = socketIp === "127.0.0.1" || socketIp === "::1" || socketIp === "::ffff:127.0.0.1";
    // Trust forwarding headers when the TCP peer is a local reverse proxy, or
    // when TRUST_PROXY=true opts in explicitly (e.g. Caddy fronting a Docker
    // container, where the peer is the bridge gateway, not loopback).
    // Direct/public sockets without opt-in remain keyed by the unspoofable peer.
    const proxyIp = xRealIp || (xff ? String(xff).split(",")[0].trim() : "");
    const trustForwarded = isLoopbackProxy || TRUST_PROXY;
    const realIp = trustForwarded && proxyIp ? proxyIp : socketIp;
    delete req.headers["x-9r-real-ip"];
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-9r-via-proxy"];
    req.headers["x-9r-real-ip"] = realIp;
    if (viaProxy) req.headers["x-9r-via-proxy"] = "1";
    return handler(req, res);
  };
  return origCreate(...rest, wrapped);
};

require("./server.js");
