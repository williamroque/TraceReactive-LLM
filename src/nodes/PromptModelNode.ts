import { ExecuteNode } from '@tracereactive/types/src/node';
import type { InputDefinition, OutputDefinition, PropertyDefinition, NodeCategory } from '@tracereactive/types/src/property';
import type { TraceReactiveAPI } from '@tracereactive/types';

declare const traceReactive: TraceReactiveAPI;

export class PromptModelNode extends ExecuteNode {
    readonly typeId = 'llm.prompt';
    readonly displayName = 'Prompt Model';
    readonly category: NodeCategory = { name: 'AI', accent: 'cyan-500' };
    readonly visible = true;

    readonly properties: PropertyDefinition[] = [
        { name: 'provider', label: 'Provider', type: 'select', options: [{label: 'Ollama', value: 'Ollama'}, {label: 'Gemini', value: 'Gemini'}], defaultValue: '' },
        { name: 'model', label: 'Model', type: 'string', defaultValue: '' },
        { name: 'system_prompt', label: 'System Prompt', type: 'text', defaultValue: '' },
        { name: 'temperature', label: 'Temperature', type: 'number', defaultValue: 0.7 }
    ];

    readonly inputs: InputDefinition[] = [
        { name: 'Content', acceptsType: 'core:string' }
    ];

    readonly outputs: OutputDefinition[] = [
        { name: 'Success', outputType: 'core:boolean' },
        { name: 'Result', outputType: 'core:string' },
        { name: 'Error', outputType: 'core:string' }
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
        const content = inputs.Content || '';
        
        try {
            if (provider === 'Ollama') {
                const baseUrl = await traceReactive.settings.get('ollamaUrl') || 'http://localhost:11434';
                
                const response = await traceReactive.net.fetch(`${baseUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        prompt: content,
                        system: properties.system_prompt || undefined,
                        stream: false,
                        options: {
                            temperature: properties.temperature || 0.7
                        }
                    })
                });
                
                const data = JSON.parse(response.text);
                if (data.error) throw new Error(data.error);
                
                return { Success: true, Result: data.response, Error: '', Event: true };
                
            } else if (provider === 'Gemini') {
                const apiKey = await traceReactive.settings.get('geminiKey');
                if (!apiKey) throw new Error("Gemini API Key is missing in package settings.");
                
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                
                const body: any = {
                    contents: [{
                        parts: [{ text: content }]
                    }],
                    generationConfig: {
                        temperature: properties.temperature || 0.7
                    }
                };
                
                if (properties.system_prompt) {
                    body.systemInstruction = {
                        parts: [{ text: properties.system_prompt }]
                    };
                }
                
                const response = await traceReactive.net.fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                const data = JSON.parse(response.text);
                if (data.error) throw new Error(data.error.message || "Unknown Gemini error");
                
                const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                return { Success: true, Result: textResult, Error: '', Event: true };
            }
        } catch (e: any) {
            return { Success: false, Result: '', Error: e.message || String(e), Event: true };
        }
        
        return { Success: false, Result: '', Error: 'Unknown provider', Event: true };
    }
}
