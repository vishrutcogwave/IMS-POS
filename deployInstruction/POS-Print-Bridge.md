# Deploy the POS Print Bridge

## Before you install

- Deploy the IMS-POS frontend and Spring Boot backend together. Apply the database migrations through the configured Flyway migration account. Use the public HTTPS POS URL on staff phones and on the printing PC.
- Pick one Windows PC per branch to handle print jobs. For two counters in the same branch, install both printers as Windows queues on the designated PC. A USB printer on a second PC can be reached through a Windows printer share while that second PC is online.
- To build the ZIP from the repository root, run the following with the .NET 10 SDK installed on Windows.

  ```powershell
  .\print-agent\windows\Build-Package.ps1
  ```

## Install on the Windows PC

1. Set the Windows default printer. Confirm that Windows can reach each named printer you will assign.
2. Extract all files from `print-agent/dist/POS-Windows-Print-Bridge.zip`. If an older POS bridge is running, exit it from the notification area before installing.
3. Open the extracted folder and run `Install.cmd`. The installer copies the bridge for the current Windows user, starts it, and configures Windows sign-in startup.
4. Open **POS Print Bridge** in the notification area and copy its key. If required, add your exact POS website origin under the bridge's allowed websites. The POS bridge listens on loopback port 17779.
5. Sign in as the property owner on this PC and select an outlet in the target branch. In **Utility Settings**, paste the key and select **Check POS bridge**. Choose **Set this PC as branch print PC**. Finish any pending browser print jobs before first pairing. Pairing a different PC to the same branch replaces the previous designation.
6. Add the exact Windows queue names in **Utility Settings**. Assign KOT categories to their printers and tick the bill printers. A blank assignment uses the current Windows default. The optional IP field is saved as metadata. Windows dispatch uses the installed queue name.

Managers can update printer assignments on the paired PC. Only the property owner can designate or replace the branch PC. A manager using another browser profile on that PC can paste the bridge key and select **Check POS bridge** to load the local mappings.

## Print from Windows, Android, or iPhone

Staff sign in to the same POS website and work in their assigned outlet. **Send KOT** queues the kitchen ticket. Settling a bill queues its receipt, and **Print bill** queues an additional receipt for authorized staff. The branch PC sends each KOT group to the configured printer and a full receipt to every selected bill printer.

The POS tab can be closed after pairing. The Windows user must stay signed in and the tray bridge must keep running. Phones need no bridge installation, printer credentials, or IP settings.

## Check job status

| Status | What it means |
| --- | --- |
| Queued | The server accepted the job. It waits for the designated PC or retries a known failure. |
| Sent to printer | The Windows spooler accepted the job. |
| Failed | The job expired or could not be sent. The status shows the reason. |
| Needs review | Some output may already have printed. Check the physical printer before resending. |

If the PC is offline, the bridge resumes queued jobs on reconnect. KOT jobs expire after 20 minutes and bill jobs after 24 hours. Successful printer deliveries are retained when another printer needs a retry.

If the bridge reports port 17779 in use, check whether the POS bridge is already running before launching another instance. To uninstall, exit the POS bridge from the notification area and run `Install.cmd -Uninstall` from the extracted folder.
