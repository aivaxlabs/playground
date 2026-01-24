import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ModelConfig, InferenceConfig, Chat } from '../types';

interface ChatUIDB extends DBSchema {
    models: {
        key: string;
        value: ModelConfig;
    };
    inference: {
        key: string;
        value: InferenceConfig;
    };
    chats: {
        key: string;
        value: Chat;
        indexes: { 'by-date': number };
    };
}

let db: IDBPDatabase<ChatUIDB> | null = null;

export async function getDB(): Promise<IDBPDatabase<ChatUIDB>> {
    if (db) return db;

    db = await openDB<ChatUIDB>('chat-ui-db', 1, {
        upgrade(database) {
            database.createObjectStore('models', { keyPath: 'id' });
            database.createObjectStore('inference', { keyPath: 'id' });
            const chatStore = database.createObjectStore('chats', { keyPath: 'id' });
            chatStore.createIndex('by-date', 'updatedAt');
        },
    });

    return db;
}

export async function saveModelConfig(config: ModelConfig): Promise<void> {
    const database = await getDB();
    await database.put('models', config);
}

export async function getModelConfig(id: string): Promise<ModelConfig | undefined> {
    const database = await getDB();
    return database.get('models', id);
}

export async function getDefaultModelConfig(): Promise<ModelConfig | undefined> {
    const database = await getDB();
    const all = await database.getAll('models');
    return all[0];
}

export async function saveInferenceConfig(config: InferenceConfig): Promise<void> {
    const database = await getDB();
    await database.put('inference', config);
}

export async function getInferenceConfig(id: string): Promise<InferenceConfig | undefined> {
    const database = await getDB();
    return database.get('inference', id);
}

export async function getDefaultInferenceConfig(): Promise<InferenceConfig | undefined> {
    const database = await getDB();
    const all = await database.getAll('inference');
    return all[0];
}

export async function saveChat(chat: Chat): Promise<void> {
    const database = await getDB();
    await database.put('chats', chat);
}

export async function getChat(id: string): Promise<Chat | undefined> {
    const database = await getDB();
    return database.get('chats', id);
}

export async function getAllChats(): Promise<Chat[]> {
    const database = await getDB();
    const all = await database.getAllFromIndex('chats', 'by-date');
    return all.reverse();
}

export async function deleteChat(id: string): Promise<void> {
    const database = await getDB();
    await database.delete('chats', id);
}
