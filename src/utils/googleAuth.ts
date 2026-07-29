const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export interface GoogleAuthOptionsLike {
    scopes: string[];
    credentials?: Record<string, unknown>;
    keyFile?: string;
}

function unwrapMatchingQuotes(value: string): string {
    if (value.length < 2) return value;

    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '\'' && last === '\'') || (first === '"' && last === '"')) {
        return value.slice(1, -1).trim();
    }

    return value;
}

export function buildSheetsAuthOptions(rawCredentials: string): GoogleAuthOptionsLike {
    const authOptions: GoogleAuthOptionsLike = {
        scopes: [GOOGLE_SHEETS_SCOPE],
    };

    const normalized = unwrapMatchingQuotes((rawCredentials || '').trim());
    if (!normalized) {
        return authOptions;
    }

    if (normalized.startsWith('{')) {
        if (!normalized.endsWith('}')) {
            throw new Error(
                'GOOGLE_CREDENTIALS is incomplete. Use a full one-line JSON value in Railway ' +
                'or a service-account JSON file path locally.'
            );
        }
        try {
            authOptions.credentials = JSON.parse(normalized);
        } catch (error) {
            throw new Error('GOOGLE_CREDENTIALS contains invalid JSON.');
        }
        return authOptions;
    }

    authOptions.keyFile = normalized;
    return authOptions;
}
