export function imsWindowsPrint(
  device: { key: string; port: number; printerName?: string; targetKey?: string },
  job: { id: string; paper_width: number; payload: object },
  copy: number,
  request?: typeof fetch,
): Promise<{ status: 'PRINTED' | 'FAILED' | 'UNCERTAIN'; error: string }>;
