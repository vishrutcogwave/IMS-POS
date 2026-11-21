# Restaurant printing and recovery

## Architecture

Routing and printable data belong to the backend, not the browser. The authenticated session resolves the restaurant; every printer has a tenant and outlet, and its outlet belongs to a branch. A category route references a category and printer within that same outlet through composite foreign keys. The server checks outlet access and printer type before creating tickets.

Sending an order first resolves every unsent line to an enabled KOT-capable printer. An explicit outlet fallback is allowed; without a route or fallback the send fails visibly without updating sent quantities. The order is grouped by printer ID, with one immutable KOT and queued print job per group. Modifiers, quantities, notes, order/table, outlet, timestamp and ticket identifier travel in the snapshot. The job is committed in the same PostgreSQL transaction as the ticket. Billing similarly uses the explicitly selected outlet receipt printer. The Windows default printer is used only by the explicitly configured IMS Windows adapter.

The UI says queued, failed or uncertain, not physically printed on order acceptance. Reprints create new jobs with the original document reference, reason and audit event. Cancellation produces a cancellation document referencing the original ticket. The original ticket and job are retained.

## Configuration

1. Sign in as an owner or authorized manager. Select the correct outlet.
2. In Settings, create menu categories and their kitchen department labels.
3. Configure printers with an outlet, friendly name, local `deviceKey` alias, KOT/BILL/BOTH type, 58/80 mm width, copies (1–5), STANDARD/COMPACT template, enabled state and optional explicit fallback/receipt designation.
4. Map every category to its kitchen printer. Routes cannot cross outlets or restaurants. Configure exactly one receipt printer for each billing outlet.
5. Use Routing preview with actual menu items. Resolve every unmapped category before kitchen send.
6. Copy `print-agent/devices.example.json` to `print-agent/devices.json`. Replace sample addresses/names with your locally installed printers. Aliases must match backend `deviceKey` values. This file stays on the restaurant machine; the server does not choose arbitrary IPs or run shell commands.
7. Create a dedicated KITCHEN account with access to only this outlet. This role has kitchen and print permissions; it is not a separate machine identity. Never run the agent as an owner. Set environment variables below in the process/service environment, not in committed files.
8. Run `node print-agent/agent.mjs` on a computer on the printers' network. Queue a Test print from the UI and inspect both the job status and the physical paper.

```text
PRINT_API_URL=https://<your-pos-host>/api
PRINT_TENANT=<restaurant-slug>
PRINT_EMAIL=<dedicated-printer-account-email>
PRINT_PASSWORD=<dedicated-printer-account-password>
PRINT_OUTLET_ID=<assigned-outlet-uuid>
PRINT_DEVICES_FILE=<absolute-path-to-local-devices.json>
```

Local development permits `http://localhost:8080/api`. Other remote hosts require HTTPS. Node 20+ is required. No paid print bridge or JSPrintManager license is required by this implementation.

## Silent printing from Windows and mobile

The outlet agent picks up queued jobs from Windows, Android and iPhone/iPad browsers. Keep it running on a Windows PC at the outlet. Mobile devices only need access to the POS website. Kitchen printers can keep their own LAN or installed-printer aliases.

Install the attached IMS Windows Print Bridge on the agent PC using Install.cmd from the ZIP. Start the tray app and set the intended Windows default printer. Set PRINT_WINDOWS_BRIDGE_KEY in the agent process environment using the key shown in the tray app. In the local devices.json, configure the receipt alias like this.

    "receipt": { "type": "ims-windows", "port": 17777 }

Match the alias to the outlet printer record and the port to the tray app. The agent calls the bridge over loopback and does not expose the key to browsers. The adapter uses 58 mm or 80 mm text receipts with the bridge's configured raw or Windows driver mode. Queue a test print and check the paper. Changing the Windows default queue changes the bridge destination.

## Supported adapters and constraints

- TCP: LAN ESC/POS-compatible thermal printers, normally port 9100, with an explicit IP and port in the local device file. Use a trusted restaurant LAN; many raw printer ports lack authentication/encryption. Do not expose them publicly.
- Windows: an installed Windows printer queue accepting RAW ESC/POS, via the supplied `windows-raw.ps1` and Windows spooler APIs. Install the manufacturer's compatible driver. The agent runs as the signed-in user with permission to that printer, not administrator. The machine's PowerShell execution policy must permit the reviewed/signed script. This workstation currently blocks `.ps1` execution; that adapter cannot be verified here. Do not disable machine policy as a shortcut.
- 58/80 mm layouts, 1–5 copies and standard/compact layout metadata are supported. Hardware-specific cutter/code-page behavior requires acceptance testing.
- The provided RAW renderer emits safe printable ASCII and replaces unsupported Unicode with `?`. Kannada/other complex scripts need a raster/Unicode-capable certified adapter or browser/driver rendering. Do not use this raw adapter where non-ASCII menu text must be preserved.
- Browser bill/report printing invokes the normal print dialog. It needs user browser permission/selection and does not silently print or acknowledge a hardware queue job.
- Mobile print jobs use the shared outlet agent. Direct phone-to-printer Bluetooth, USB and Android bridge printing are outside this setup.

No physical printer is assumed present. Test-print transport and paper output must be commissioned at each outlet. Hardware/driver compatibility is not established by compilation or API tests.

## Durable queue and duplicate safety

The agent claims only its authenticated outlet's PENDING jobs matching local device aliases. Claiming locks rows with `SKIP LOCKED` and attaches an unguessable claim token and claimant user. Acknowledgment must match both. After a connection failure before transmission a job can be FAILED; if bytes may have left the machine the agent reports UNCERTAIN. Claims older than 120 seconds are marked UNCERTAIN during tenant-scoped queue activity. They are not automatically resent.

PRINTED means bytes were accepted by the socket/spooler, not a paper sensor confirmation. If acknowledgment is lost after output, the agent never blindly sends the job again. Check the physical station, then use Retry with a reason that acknowledges possible duplicate output. If some copies succeeded and a later copy failed, all-copy retry can duplicate the successful copies; the queue makes that uncertainty explicit. Correct the device/driver/network first.

Monitor Print queue and last-contact indicators. A previously successful contact is not live printer health. A powered-off printer, empty paper roll, stopped agent or stale claim must not be treated as a successful print.

## API boundaries

The print agent authenticates through the normal session endpoint and sends CSRF headers for mutations. Credentials and session tokens are never embedded in print payloads. Category mappings, job access, retries, tests, original references and document snapshots are all tenant/outlet validated by the server. Background polling is always inside a resolved tenant context; there is no global unscoped printer worker.
