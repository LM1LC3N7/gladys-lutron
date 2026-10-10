// -----------------------------------------------------------------------------
// A fake Lutron bridge speaking LEAP over TLS, for the tests: it requires the
// client certificate signed by its authority (like a real bridge after
// pairing), answers the routes it is given, and can misbehave on demand
// (split writes, silence, drop the connections).
// -----------------------------------------------------------------------------

import tls from 'node:tls';
import { once } from 'node:events';
import { TLS } from './tls.js';

/**
 * @typedef {(request: any, client: FakeClient) => any} Route
 *   returns a response object (Header.ClientTag added), an array of them,
 *   or undefined for no answer
 */

/**
 * @typedef {object} FakeClient
 * @property {tls.TLSSocket} socket
 * @property {(message: any) => void} send
 */

export const ok = (body, extra = {}) => ({
  CommuniqueType: 'ReadResponse',
  Header: { StatusCode: '200 OK', ...extra },
  ...(body === undefined ? {} : { Body: body }),
});

export const status = (code, extra = {}) => ({
  CommuniqueType: 'ExceptionResponse',
  Header: { StatusCode: code, ...extra },
});

/**
 * @param {object} [options]
 * @param {Record<string, Route>} [options.routes] by "CommuniqueType Url" or Url
 * @param {number} [options.chunkSize] write the answers in chunks of this many bytes
 * @param {string} [options.cert] server certificate (default: signed by the bridge CA)
 * @param {string} [options.key]
 * @param {string} [options.clientCa] authority accepted for client certificates
 */
export async function startFakeBridge({
  routes = {},
  chunkSize,
  cert = TLS.bridgeCert,
  key = TLS.bridgeKey,
  clientCa = TLS.bridgeCa,
} = {}) {
  const state = {
    routes: {
      'ReadRequest /server/1/status/ping': () => ok({ PingResponse: { LEAPVersion: 1.123 } }),
      ...routes,
    },
    requests: [],
    clients: new Set(),
    silent: false,
  };

  const write = (socket, text) => {
    if (!chunkSize) {
      socket.write(text);
      return;
    }
    const bytes = Buffer.from(text);
    for (let i = 0; i < bytes.length; i += chunkSize)
      socket.write(bytes.subarray(i, i + chunkSize));
  };

  const server = tls.createServer(
    { cert, key, ca: clientCa, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    (socket) => {
      /** @type {FakeClient} */
      const client = { socket, send: (message) => write(socket, `${JSON.stringify(message)}\r\n`) };
      state.clients.add(client);
      socket.on('close', () => state.clients.delete(client));
      socket.on('error', () => {});
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('data', (text) => {
        buffer += text;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const request = JSON.parse(line);
          state.requests.push(request);
          if (state.silent) continue;
          const url = request.Header?.Url;
          const route =
            state.routes[`${request.CommuniqueType} ${url}`] ??
            state.routes[url] ??
            (() => status('404 NotFound'));
          const answer = route(request, client);
          for (const response of [answer].flat()) {
            if (!response) continue;
            const header = { Url: url, ...response.Header };
            if (request.Header?.ClientTag && header.ClientTag !== null) {
              header.ClientTag ??= request.Header.ClientTag;
            }
            if (header.ClientTag === null) delete header.ClientTag;
            client.send({ ...response, Header: header });
          }
        }
      });
    },
  );
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    host: '127.0.0.1',
    port: server.address().port,
    state,
    /** Add or replace routes. */
    route(more) {
      Object.assign(state.routes, more);
    },
    /** Stop answering anything (half-open connection). */
    silence(value = true) {
      state.silent = value;
    },
    /** Send an unsolicited (untagged) message to every client. */
    broadcast(message) {
      for (const client of state.clients) client.send(message);
    },
    /** Cut every connection (bridge reboot). */
    dropClients() {
      for (const client of state.clients) client.socket.destroy();
    },
    requestsTo(url) {
      return state.requests.filter((r) => r.Header?.Url === url);
    },
    async close() {
      for (const client of state.clients) client.socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}
