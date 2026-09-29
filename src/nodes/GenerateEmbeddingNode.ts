import { ExecuteNode } from '@tracereactive/types/src/node';
import type { InputDefinition, OutputDefinition, PropertyDefinition, NodeCategory } from '@tracereactive/types/src/property';
import type { TraceReactiveAPI } from '@tracereactive/types';

declare const traceReactive: TraceReactiveAPI;

export class GenerateEmbeddingNode extends ExecuteNode {
    readonly typeId = 'llm.embedding';
    readonly displayName = 'Generate Embedding';
    readonly category: NodeCategory = { name: 'AI', accent: 'cyan-500' };
    readonly visible = true;

    readonly properties: PropertyDefinition[] = [
        { name: 'provider', label: 'Provider', type: 'select', options: [{label: 'Ollama', value: 'Ollama'}, {label: 'Gemini', value: 'Gemini'}], defaultValue: '' },
        { name: 'model', label: 'Model', type: 'string', defaultValue: '' }
    ];

    readonly inputs: InputDefinition[] = [
        { name: 'Text', acceptsType: 'string' }
    ];

    readonly outputs: OutputDefinition[] = [
        { name: 'Success', outputType: 'boolean' },
        { name: 'Embedding', outputType: 'array' }
    ];

    private async getProvider(properties: Record<string, any>): Promise<string> {
        const defaultProvider = await traceReactive.settings.get('defaultProvider') || 'Ollama';
        return properties.provider || defaultProvider;
    }

    private async getModel(provider: string, properties: Record<string, any>): Promise<string> {
        if (properties.model) return properties.model;
        if (provider === 'Ollama') {
            return await traceReactive.settings.get('defaultOllamaModel') || 'llama3';
        } else {
            return await traceReactive.settings.get('defaultGeminiModel') || 'gemini-1.5-flash';
        }
    }

    async evaluate(inputs: Record<string, any>, properties: Record<string, any>): Promise<Record<string, any>> {
        const provider = await this.getProvider(properties);
        const model = await this.getModel(provider, properties);
        const text = inputs.Text || '';
        
        try {
            if (provider === 'Ollama') {
                const baseUrl = await traceReactive.settings.get('ollamaUrl') || 'http://localhost:11434';
                const response = await traceReactive.net.fetch(`${baseUrl}/api/embeddings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        prompt: text
                    })
                });
                
                const data = JSON.parse(response.text);
                if (data.error) throw new Error(data.error);
                
                return { Success: true, Embedding: data.embedding, Event: true };
                
            } else if (provider === 'Gemini') {
                const apiKey = await traceReactive.settings.get('geminiKey');
                if (!apiKey) throw new Error("Gemini API Key is missing in package settings.");
                
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
                
                const response = await traceReactive.net.fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: `models/${model}`,
                        content: { parts: [{ text }] }
                    })
                });
                
                const data = JSON.parse(response.text);
                if (data.error) throw new Error(data.error.message || "Unknown Gemini error");
                
                const embedding = data.embedding?.values || [];
                return { Success: true, Embedding: embedding, Event: true };
            }
        } catch (e: any) {
            return { Success: false, Embedding: null, Event: true };
        }
        
        return { Success: false, Embedding: null, Event: true };
    }
}
