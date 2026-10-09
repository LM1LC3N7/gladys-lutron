# Test TLS material

Test-only certificates, never shipped (the `test/` directory is excluded from
the Docker build context). Valid for 100 years. Regenerate with OpenSSL:

- `bridge-ca.pem`: the authority of a fake Lutron bridge (its key was deleted
  after signing);
- `bridge.pem` / `bridge.key`: the fake bridge's server certificate;
- `client.pem` / `client.key`: the certificate "signed at pairing" for the
  integration;
- `other-ca.pem`, `stranger.pem` / `stranger.key`: another authority and a
  certificate it signed, to test refused certificates on both sides.
