# Lutron for Gladys Assistant

Control your Lutron lights, shades and fans from Gladys, and use your Pico
remotes in Gladys scenes. Everything runs **on your local network**, over
Lutron's LEAP protocol: no Lutron account, no cloud, no Internet connection
needed by the integration.

> **Development version.** The integration is being built step by step; the
> sections below describe the target of version 0.1.0. What already works is
> listed in the [changelog](../CHANGELOG.md).

## Supported systems

| System                                          | Status          |
| ----------------------------------------------- | --------------- |
| Caséta Smart Hub (L-BDG2, sold in starter kits) | supported       |
| Caséta Smart Bridge PRO (L-BDGPRO2)             | supported       |
| RA2 Select (RR-SEL-REP2)                        | supported       |
| RadioRA 3, HomeWorks QSX                        | planned (0.2.0) |
| Original Smart Bridge (L-BDG, before LEAP)      | not supported   |
| RadioRA 2, HomeWorks QS (telnet)                | not supported   |

Devices: dimmers (Caséta, Diva, Sunnata, plug-in, in-line), switches and
plug-in modules, shades and wood blinds, fan controls, occupancy sensors,
Pico remotes.

## What stays local, what does not

- **Gladys ↔ bridge: 100 % local.** Pairing, discovery, control and events
  go straight from Gladys to the bridge on your network. They keep working
  when the Internet is down.
- **Adding devices to the bridge** is done once in the Lutron app, which
  asks for a Lutron account. This is Lutron's own setup, outside Gladys.
  After that, the integration never needs the app nor the Internet. A Pico
  remote can also be paired directly to a dimmer, without any app.

## Installation

1. Plug the bridge into your router with its network cable and add your
   devices to it in the Lutron app.
2. Give the bridge a **fixed IP address** (a DHCP reservation in your
   router) so Gladys always finds it.
3. In Gladys, install the **Lutron** integration, open its configuration.
4. Leave the IP address empty (the bridge is searched on your network) or
   type it, then click **Pair the bridge**.
5. Within 60 seconds, press the **small black button at the back of the
   bridge**. The status turns to "Connected".
6. Open the **Discover** tab and create the devices you want.

If the search finds nothing, type the IP address: some networks (VLANs,
mesh Wi-Fi, Docker installs) block the discovery announcements, not the
connection itself.

## Pico remotes

Each Pico becomes a Gladys device with one button per physical button (On,
Off, Raise, Lower, Favorite…). In a scene, use the trigger **"Device state
change"**, pick the button and the press type.

The option **Pico remote buttons** sets how presses are detected:

- **Instant**: a click is reported the moment you press, with no delay.
  Double clicks and long presses are not detected.
- **Normal** (default): click, double click and long press are detected. A
  single click is reported about 0.3 s later, the time to make sure no
  second press follows.
- **Slow**: like Normal, with wider timings (0.45 s for a double click,
  0.75 s for a long press), for people who press slowly.

## Fade time

**Default fade time** applies to every level Gladys sends to a dimmer. The
scene action **"Lutron: set a level with a fade"** sets a level over a
chosen time, up to 4 hours (a sunrise in the bedroom, a slow dimming for a
film).

## Security

The bridge only accepts Gladys after the button press. The certificate it
signs is stored in the Gladys configuration (included in the Gladys backups,
never shown in the interface), and every connection checks the bridge's
certificate: another machine cannot pretend to be your bridge.

## Troubleshooting

- **"Button not pressed in time"**: click Pair again, then press the bridge
  button within 60 seconds.
- **"Certificate refused"**: the bridge was reset. Click **Forget the
  bridge**, then pair again.
- **States not updating**: click **Test the connection**; the integration
  also reconnects and reloads every state by itself.
- **To report a problem**: see "Diagnostics" below.

## Diagnostics

The **Diagnostics** button reads the description of your Lutron system from
the bridge (rooms, devices, buttons, scenes, current levels) and writes it to
the integration logs. It only reads: nothing is changed on the bridge.

1. Click **Diagnostics** (it takes a few seconds, up to a minute on a big
   system).
2. Open the **Logs** tab of the integration.
3. Copy every line from `LUTRON DIAGNOSTICS BEGIN` to
   `LUTRON DIAGNOSTICS END` and attach it to your report.

The dump is anonymized: serial numbers are replaced by `serial-1`,
`serial-2`…, MAC and IP addresses and any geographic position are masked,
and no certificate or key is ever included. Room and device names are kept,
since they explain your setup; rename them in the dump if you prefer. When
the bridge is not connected, only the connection state is written.

Not affiliated with Lutron Electronics. Lutron, Caséta, Pico, RadioRA and
HomeWorks are trademarks of Lutron Electronics Co., Inc.
