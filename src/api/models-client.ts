import type { ModelConfig } from '../types';

export interface Model {
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
}

export interface ListModelsResponse {
    object: 'list';
    data: Model[];
}

export async function listModels(modelConfig: ModelConfig): Promise<Model[]> {
    const url = new URL(modelConfig.endpoint);
    // Remove /chat/completions suffix if present to get base URL, then add /models
    const baseUrl = url.origin + url.pathname.replace(/\/chat\/completions\/?$/, '');
    const modelsUrl = `${baseUrl}/models`;

    const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${modelConfig.apiKey}`
        }
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to list models: ${response.status} - ${error}`);
    }

    const data = await response.json() as ListModelsResponse;
    return data.data;
}
