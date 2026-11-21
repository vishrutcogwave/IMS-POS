import { renderLines } from './renderer.mjs';

export async function imsWindowsPrint(device, job, copy, request = fetch) {
  const lines = renderLines(job);
  if (lines.length > 300 || lines.some(text => text.length > 200)) {
    return { status: 'FAILED', error: 'This ticket exceeds the Windows bridge receipt limits.' };
  }
  try {
    const response = await request('http://127.0.0.1:' + device.port + '/api/bridge/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': device.key },
      body: JSON.stringify({
        jobId: 1,
        jobKey: ['hearth', job.id, copy].join(':'),
        platform: 'WINDOWS',
        paperWidth: Number(job.paper_width) === 58 ? 'MM58' : 'MM80',
        document: { type: 'SALE_RECEIPT', lines: lines.map(text => ({ text, align: 'left' })) },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(18000),
    });
    if ([400, 401, 403, 404, 413].includes(response.status)) {
      return { status: 'FAILED', error: 'Windows bridge rejected the request. Check the key, port and receipt limits.' };
    }
    if (response.ok && (await response.json()).success === true) {
      return { status: 'PRINTED', error: '' };
    }
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') {
      return { status: 'FAILED', error: 'Windows bridge is unreachable. Start the tray app and check its port.' };
    }
  }
  return { status: 'UNCERTAIN', error: 'Windows bridge did not confirm acceptance. Check the printer before retrying.' };
}