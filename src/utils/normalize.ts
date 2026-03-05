export function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        // Remove fragments and sort search params
        parsed.hash = '';
        parsed.search = new URLSearchParams([...parsed.searchParams].sort()).toString();
        return parsed.toString();
    } catch {
        return url;
    }
}

export function extractDomain(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}
