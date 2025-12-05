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
				"Content-Type": "application/json" 
			} 
		}
	);
}

export function createJsonResponseRaw(data: any) {
    return new Response(JSON.stringify(data, null, 2), {
        status: 200,
        headers: {
            "Content-Type": "application/json"
        }
    });
}

export function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    return crypto.subtle.digest("SHA-256", msgBuffer).then((hashBuffer) => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    });
}