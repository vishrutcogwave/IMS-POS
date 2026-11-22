# Silent Windows printing with POS Print Bridge

Use the POS Windows Print Bridge ZIP on the workstation. The POS bridge uses localhost port 17779 and the original IMS bridge can continue to use port 17777.

1. Extract the full ZIP and run Install.cmd.
2. Open **POS Print Bridge** in the Windows notification area. Copy the bridge key and add the POS site's exact origin under allowed websites if required.
3. In POS **Utility Settings**, paste the key and select **Check POS bridge**. Saved printer names and assignments remain in this browser.
4. Add installed Windows queue names. Use the category checkboxes to assign KOT printers and the **Bill printers** checkboxes to select one or more receipt printers. An empty assignment uses the current Windows default.

The POS tab sends each KOT printer only the lines assigned to it and sends full receipts to each selected bill printer. Void KOT items follow their category assignments. The POS requires an authorized signed-in session with the tab open. Printer IP addresses remain optional metadata for future mobile use.

To uninstall, run Install.cmd -Uninstall from Command Prompt.

## Print from Android and iPhone

1. Install the current POS Windows Print Bridge ZIP on the designated Windows PC.
2. On that PC, sign in to the POS as the property owner, select the branch outlet and open **Utility Settings**.
3. Paste the bridge key, select **Check POS bridge**, then choose **Set this PC as branch print PC**. Finish any already queued browser print jobs for the branch before pairing.
4. Assign printers on the PC. The bridge keeps these mappings locally and starts a background print worker when Windows signs in. The POS tab can be closed once paired.

Mobile staff send KOTs and settle or reprint bills through POS as usual. A paired branch routes them through its designated PC. If the PC is offline, unopened KOT jobs expire after 20 minutes and unopened bill jobs after 24 hours. **Sent to printer** confirms Windows spooler acceptance. **Needs review** means the print attempt may already have reached the printer. Check the physical output before resending.
