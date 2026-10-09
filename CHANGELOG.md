# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Audit of the LEAP libraries and of the existing Lutron integrations
  (`AUDIT.md`) and the v1 plan (`TODO.md`).
- Project scaffold: manifest (configuration, actions, scene triggers and
  actions, widget, mDNS discovery), Docker image, CI, store documentation in
  English and French, cover image.
- In-house LEAP client, without any runtime dependency: TLS connection
  checking the bridge certificate, request correlation, subscriptions,
  paging, keep-alive ping every minute, reconnection with backoff and full
  reload after every reconnection, explicit errors (bridge unreachable,
  certificate refused, invalid pairing).
- Local pairing from the configuration screen: the bridge is searched on the
  network (mDNS scan run by Gladys) when no IP address is typed, then paired
  by pressing its button; the certificate it signs is kept in the Gladys
  configuration. Actions "Test the connection", "Forget the bridge" and
  "Refresh the devices"; connection status in English and French saying what
  is wrong and what to do; a bridge that changed IP address is found again by
  its serial number.
