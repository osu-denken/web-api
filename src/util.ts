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
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
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