param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$InputFile
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HearthRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string pDocName = "Hearth restaurant ticket"; public string pOutputFile = null; public string pDataType = "RAW"; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  public static void Send(string name, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(name, out handle, IntPtr.Zero)) throw new Exception("Printer could not be opened");
    bool document = false, page = false;
    try {
      if (StartDocPrinter(handle, 1, new DocInfo()) == 0) throw new Exception("Spool document failed");
      document = true;
      if (!StartPagePrinter(handle)) throw new Exception("Spool page failed");
      page = true;
      int written;
      if (!WritePrinter(handle, data, data.Length, out written) || written != data.Length) throw new Exception("Partial or failed spool write");
      if (!EndPagePrinter(handle)) throw new Exception("Spool page completion failed");
      page = false;
      if (!EndDocPrinter(handle)) throw new Exception("Spool completion failed");
      document = false;
    } finally {
      if (page) EndPagePrinter(handle);
      if (document) EndDocPrinter(handle);
      ClosePrinter(handle);
    }
  }
}
'@
[HearthRawPrinter]::Send($PrinterName, [System.IO.File]::ReadAllBytes($InputFile))
