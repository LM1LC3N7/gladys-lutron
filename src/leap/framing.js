// -----------------------------------------------------------------------------
// LEAP framing: one JSON object per line, "\r\n" terminated.
//
// The decoder keeps a UTF-8 StringDecoder across chunks: a multi-byte
// character split over two TCP chunks must not become U+FFFD ("Salle à
// manger", the bug of lutron-leap's chunk.toString()). The buffer is capped so
// a bridge (or anything listening on its port) sending no newline cannot eat
// the container memory; big RA3/QSX projects stay far below the cap.
// -----------------------------------------------------------------------------

import { StringDecoder } from 'node:string_decoder';

export const DEFAULT_MAX_LINE_BYTES = 4 * 1024 * 1024;

/**
 * @param {object} message
 * @returns {string} the line to write on the socket
 */
export function encodeMessage(message) {
  return `${JSON.stringify(message)}\r\n`;
}

/**
 * @param {object} handlers
 * @param {(message: object) => void} handlers.onMessage a parsed JSON object
 * @param {(error: Error, line?: string) => void} handlers.onError a line that is
 *   not a JSON object (skipped), or the buffer overflowing (fatal for the stream)
 * @param {number} [maxLineBytes]
 * @returns {{ push(chunk: Buffer | string): void, end(): void }}
 */
export function createLineDecoder({ onMessage, onError, maxLineBytes = DEFAULT_MAX_LINE_BYTES }) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let overflowed = false;

  const handleLine = (line) => {
    const text = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (text.trim() === '') return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      onError(new Error('Malformed LEAP message', { cause: error }), text);
      return;
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      onError(new Error('LEAP message is not an object'), text);
      return;
    }
    onMessage(message);
  };

  const feed = (text) => {
    if (overflowed) return;
    buffer += text;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      handleLine(line);
      newline = buffer.indexOf('\n');
    }
    if (Buffer.byteLength(buffer) > maxLineBytes) {
      overflowed = true;
      buffer = '';
      onError(new Error(`LEAP message larger than ${maxLineBytes} bytes`));
    }
  };

  return {
    push(chunk) {
      feed(typeof chunk === 'string' ? chunk : decoder.write(chunk));
    },
    end() {
      feed(decoder.end());
      if (!overflowed && buffer !== '') handleLine(buffer);
      buffer = '';
    },
  };
}

/**
 * "200 OK" -> { code: 200, text: "OK" }; tolerant like pylutron-caseta.
 *
 * @param {unknown} status
 * @returns {{ code: number | null, text: string }}
 */
export function parseStatus(status) {
  if (typeof status !== 'string') return { code: null, text: '' };
  const match = /^(\d{3})\s*(.*)$/.exec(status.trim());
  return match ? { code: Number(match[1]), text: match[2] } : { code: null, text: status };
}

/**
 * The id of any LEAP href: "/zone/12/status" -> "12", "/button/105" -> "105".
 *
 * @param {unknown} href
 * @returns {string | null}
 */
export function idFromHref(href) {
  if (typeof href !== 'string') return null;
  const match = /^\/[^/\d]+\/(\d+)(?:\/|$)/.exec(href);
  return match ? match[1] : null;
}
