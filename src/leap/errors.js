// -----------------------------------------------------------------------------
// Typed errors of the LEAP client. The Gladys side turns them into a status the
// user understands ("press the button", "bridge unreachable"…), so each kind of
// failure gets its own class. Messages never carry a key, a certificate or a
// serial number.
// -----------------------------------------------------------------------------

export class LeapError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** The bridge cannot be reached (refused, no route, timeout, closed). */
export class BridgeUnreachableError extends LeapError {
  /**
   * @param {string} host
   * @param {{ cause?: unknown, code?: string }} [options]
   */
  constructor(host, { cause, code } = {}) {
    super(`Lutron bridge unreachable at ${host}${code ? ` (${code})` : ''}`, { cause });
    this.host = host;
    this.code = code;
  }
}

/**
 * The TLS handshake failed on a certificate: the bridge refused ours (it was
 * reset, the pairing is lost) or we refused its certificate (not signed by
 * the authority received at pairing). Never retried in a loop.
 */
export class CertificateRefusedError extends LeapError {
  /**
   * @param {'bridge' | 'integration'} refusedBy who refused the other side's certificate
   * @param {{ cause?: unknown, code?: string }} [options]
   */
  constructor(refusedBy, { cause, code } = {}) {
    super(
      refusedBy === 'bridge'
        ? 'The Lutron bridge refused the pairing certificate'
        : 'The Lutron bridge presented a certificate that does not match the pairing',
      { cause },
    );
    this.refusedBy = refusedBy;
    this.code = code;
  }
}

/** No answer to a request within the timeout. */
export class LeapTimeoutError extends LeapError {
  constructor(url, timeoutMs) {
    super(`No answer from the Lutron bridge to ${url} within ${timeoutMs} ms`);
    this.url = url;
  }
}

/** The bridge answered with a non-2xx status. */
export class LeapStatusError extends LeapError {
  /**
   * @param {string} url
   * @param {number | null} statusCode
   * @param {string} status the raw status ("404 NotFound")
   */
  constructor(url, statusCode, status) {
    super(`Lutron bridge answered ${status} to ${url}`);
    this.url = url;
    this.statusCode = statusCode;
    this.status = status;
  }
}

/** The connection closed while the request was waiting, or before it was sent. */
export class LeapClosedError extends LeapError {
  constructor(message = 'The connection to the Lutron bridge is closed') {
    super(message);
  }
}

/** The stored pairing credentials cannot be loaded (corrupted or partial). */
export class InvalidCredentialsError extends LeapError {
  constructor(options) {
    super('The stored Lutron pairing credentials are invalid', options);
  }
}

/**
 * The bridge accepted the TLS connection then closed it before answering
 * anything: what a bridge does when it no longer knows our certificate (after
 * a reset) and drops the session instead of failing the handshake.
 */
export class BridgeClosedEarlyError extends LeapClosedError {
  constructor() {
    super('The Lutron bridge closed the connection right after accepting it');
  }
}
