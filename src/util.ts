export interface FMObj {
  meta: Record<string, any>;
  content: string;
}

export function parseFrontMatter(md: string): FMObj {
  const res: FMObj = { meta: {}, content: md };

  if (!md.startsWith('---')) return res;

  const endIndex = md.indexOf('---', 3);
  if (endIndex === -1) return res;

  const metaString = md.slice(3, endIndex).trim();
  const body = md.slice(endIndex + 3).trim();

  const lines = metaString.split('\n');

  for (const line of lines) {
    if (!line.includes(':')) continue;

    const [key, ...rest] = line.split(':');
    if (!key) continue;

    const valueRaw = rest.join(':').trim();

    let value: any = valueRaw;
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
      const arrayValues = valueRaw
        .slice(1, -1)
        .split(',')
        .map(v => v.trim())
        .filter(v => v.length > 0);
      value = arrayValues;
    }

    res.meta[key.trim()] = value;
  }

  res.content = body;
  return res;
}

export function createFrontMatter(meta: Record<string, any>, content: string): string {
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('---', '', content);

  return lines.join('\n');
}

export function FMObj2FrontMatterString(fm: FMObj): string {
  return createFrontMatter(fm.meta, fm.content);
}

export function txt2base64(str: string) {
	const bytes = new TextEncoder().encode(str);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function base642txt(base64: string) {
    const decodedContent = atob(base64);
    const bytes = new Uint8Array(decodedContent.length);
    for (let i = 0; i < decodedContent.length; i++) {
        bytes[i] = decodedContent.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

export function createJsonResponse(status: number, statusText: string, body: any) {
	return new Response(
		JSON.stringify(
			{
				status,
				statusText,
				body
			}, null, 2
		),
		{ 
			status, 
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization, page",
			} 
		}
	);
}

export function createJsonResponseRaw(data: any) {
    return new Response(JSON.stringify(data, null, 2), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    });
}

export function sha256(data: string): Promise<string> {
    const buf = new TextEncoder().encode(data);
    return crypto.subtle.digest("SHA-256", buf).then((hashBuf) => {
        const hashArray = Array.from(new Uint8Array(hashBuf));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    });
}

export function die(msg: string) {
	return createJsonResponse(500, "Internal Server Error", { error: msg });
}
