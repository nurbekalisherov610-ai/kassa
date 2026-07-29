import { google } from 'googleapis';
import { config } from '../config';
import { buildSheetsAuthOptions } from '../utils/googleAuth';

// ================ AUTH ================

const authOptions = buildSheetsAuthOptions(config.GOOGLE_CREDENTIALS);
const auth = new google.auth.GoogleAuth(authOptions);

const sheets = google.sheets({ version: 'v4', auth });

const USERS_SHEET = 'Users';
// Columns: A=ID, B=Name, C=Username, D=Role, E=LastActive, F=JoinedAt
const USERS_RANGE = `'${USERS_SHEET}'!A:F`;

export interface UserDef {
    id: number;
    name: string;
    username: string;
    role: 'admin' | 'manager';
    lastActive: string;
    joinedAt: string;
}

// ================ SHEET HELPERS ================

async function ensureUsersSheet(): Promise<void> {
    try {
        const meta = await sheets.spreadsheets.get({
            spreadsheetId: config.SPREADSHEET_ID,
        });
        const exists = meta.data.sheets?.some(
            s => s.properties?.title === USERS_SHEET
        );
        if (!exists) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: config.SPREADSHEET_ID,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: USERS_SHEET } } }],
                },
            });
            // Write header
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `'${USERS_SHEET}'!A1:F1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [['ID', 'Name', 'Username', 'Role', 'LastActive', 'JoinedAt']],
                },
            });
            console.log('✅ Users sheet created');
        }
    } catch (e) {
        console.error('ensureUsersSheet error:', e);
    }
}

// In-memory cache to avoid hammering Sheets API on every message
let usersCache: UserDef[] | null = null;
let usersCacheTs = 0;
const USERS_CACHE_TTL = 60_000; // 1 minute

async function readUsersFromSheet(): Promise<UserDef[]> {
    const now = Date.now();
    if (usersCache && now - usersCacheTs < USERS_CACHE_TTL) {
        return usersCache;
    }

    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: USERS_RANGE,
        });
        const rows = res.data.values || [];
        // Skip header row
        const users: UserDef[] = rows.slice(1)
            .filter(r => r[0] && !isNaN(Number(r[0])))
            .map(r => ({
                id: Number(r[0]),
                name: r[1] || '',
                username: r[2] || '',
                role: (r[3] === 'admin' ? 'admin' : 'manager') as 'admin' | 'manager',
                lastActive: r[4] || '',
                joinedAt: r[5] || '',
            }));
        usersCache = users;
        usersCacheTs = now;
        return users;
    } catch (e: any) {
        console.error('readUsersFromSheet error:', e.message);
        return usersCache || [];
    }
}

function userToSheetRow(user: UserDef): (string | number)[] {
    return [
        user.id,
        user.name,
        user.username,
        user.role,
        user.lastActive,
        user.joinedAt,
    ];
}

async function findUserRowIndex(userId: number): Promise<number | null> {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: config.SPREADSHEET_ID,
            range: `'${USERS_SHEET}'!A2:A`,
        });
        const rows = res.data.values || [];
        for (let i = 0; i < rows.length; i++) {
            if (Number(rows[i]?.[0] || 0) === userId) {
                return i + 2; // sheet rows are 1-based, data starts at row 2
            }
        }
        return null;
    } catch (e: any) {
        console.error('findUserRowIndex error:', e.message);
        return null;
    }
}

async function upsertUserInSheet(user: UserDef): Promise<void> {
    await ensureUsersSheet();
    const rowIndex = await findUserRowIndex(user.id);
    const values = [userToSheetRow(user)];

    try {
        if (rowIndex) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: config.SPREADSHEET_ID,
                range: `'${USERS_SHEET}'!A${rowIndex}:F${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values },
            });
            return;
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId: config.SPREADSHEET_ID,
            range: `'${USERS_SHEET}'!A:F`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });
    } catch (e: any) {
        console.error('upsertUserInSheet error:', e.message);
    }
}

async function clearUserRowInSheet(userId: number): Promise<boolean> {
    await ensureUsersSheet();
    const rowIndex = await findUserRowIndex(userId);
    if (!rowIndex) return false;

    try {
        await sheets.spreadsheets.values.clear({
            spreadsheetId: config.SPREADSHEET_ID,
            range: `'${USERS_SHEET}'!A${rowIndex}:F${rowIndex}`,
        });
        return true;
    } catch (e: any) {
        console.error('clearUserRowInSheet error:', e.message);
        return false;
    }
}

// Initialize sheet on startup
ensureUsersSheet().catch(console.error);

// ================ SERVICE ================

export const userService = {
    async getUsers(): Promise<UserDef[]> {
        return readUsersFromSheet();
    },

    async getUserById(id: number): Promise<UserDef | undefined> {
        const users = await this.getUsers();
        return users.find(u => u.id === id);
    },

    async getManagers(): Promise<UserDef[]> {
        const users = await this.getUsers();
        return users.filter(u => u.role === 'manager');
    },

    async getAdmins(): Promise<UserDef[]> {
        const users = await this.getUsers();
        return users.filter(u => u.role === 'admin');
    },

    async saveUser(user: Omit<UserDef, 'joinedAt' | 'role'> & { role?: string }): Promise<void> {
        const existing = await this.getUserById(user.id);
        let nextUser: UserDef;

        if (existing) {
            const nameChanged = existing.name !== user.name;
            const usernameChanged = existing.username !== user.username;
            const roleChanged = !!(user.role && existing.role !== user.role);

            // Only update lastActive if it's been more than 5 minutes
            const lastActiveMs = existing.lastActive ? new Date(existing.lastActive).getTime() : 0;
            const lastActiveStale = Date.now() - lastActiveMs > 5 * 60 * 1000;

            // Skip write entirely if nothing meaningful changed
            if (!nameChanged && !usernameChanged && !roleChanged && !lastActiveStale) {
                return;
            }

            nextUser = {
                ...existing,
                name: user.name,
                username: user.username,
                lastActive: user.lastActive,
                role: (user.role as 'admin' | 'manager') || existing.role,
            };
        } else {
            nextUser = {
                id: user.id,
                name: user.name,
                username: user.username,
                role: (user.role as 'admin' | 'manager') || 'manager',
                lastActive: user.lastActive,
                joinedAt: new Date().toISOString(),
            };
        }

        await upsertUserInSheet(nextUser);

        if (usersCache) {
            const idx = usersCache.findIndex(u => u.id === nextUser.id);
            if (idx >= 0) usersCache[idx] = nextUser;
            else usersCache.push(nextUser);
            usersCacheTs = Date.now();
        } else {
            usersCacheTs = 0;
        }
    },

    async deleteUser(id: number): Promise<boolean> {
        const users = await this.getUsers();
        const filtered = users.filter(u => u.id !== id);
        if (filtered.length === users.length) return false;

        const removed = await clearUserRowInSheet(id);
        if (!removed) return false;

        usersCache = filtered;
        usersCacheTs = Date.now();
        return true;
    },

    async getUserCount(): Promise<number> {
        const users = await this.getUsers();
        return users.length;
    },
};
