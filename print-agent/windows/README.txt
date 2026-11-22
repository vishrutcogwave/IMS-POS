# POS Print Bridge for Windows

This bridge serves IMS-POS on port 17779. The original IMS bridge can continue using port 17777.

1. Use Extract All, open the extracted folder, then run Install.cmd.
2. In the POS Print Bridge tray menu, copy the new bridge key and add the POS website to the allowed websites if needed.
3. In IMS-POS Utility Settings, paste the key and select Check POS bridge.
4. Assign installed Windows printer names to KOT categories or bills. Empty assignments use the Windows default printer. For mobile and background printing, the property owner selects Set this PC as branch print PC. After pairing, prints continue while Windows is signed in even with the POS tab closed.

To uninstall, exit the bridge from the Windows notification area and run Install.cmd -Uninstall from Command Prompt.
