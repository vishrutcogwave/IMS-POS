# POS Print Bridge for Windows

This bridge serves IMS-POS on port 17779. The original IMS bridge can continue using port 17777.

1. Use Extract All, open the extracted folder, then run Install.cmd.
2. The Bridge key window opens automatically. Select Copy, then add the POS website to allowed websites if needed. If you close the window, click the POS Print Bridge tray icon to reopen it.
3. In IMS-POS Utility Settings, paste the key and select Check POS bridge.
4. Assign installed Windows printer names to KOT categories or bills. Empty assignments use the Windows default printer. For mobile and background printing, the property owner selects Set this PC as branch print PC. After pairing, prints continue while Windows is signed in even with the POS tab closed.

To upgrade or uninstall, run Install.cmd from the extracted ZIP. The installer closes the old bridge before replacing it. To uninstall, run Install.cmd -Uninstall; it also closes the bridge first.
