import { ExecuteNode } from '@tracereactive/types/src/node';
import type { InputDefinition, OutputDefinition, PropertyDefinition, NodeCategory } from '@tracereactive/types/src/property';
import type { TraceReactiveAPI } from '@tracereactive/types';
import * as aq from 'arquero';

declare const traceReactive: TraceReactiveAPI;

export class GenerateDataframeNode extends ExecuteNode {
    readonly typeId = 'llm.dataframe';
    readonly displayName = 'Generate Dataframe';
    readonly category: NodeCategory = { name: 'AI', accent: 'cyan-500' };
    readonly visible = true;

    readonly properties: PropertyDefinition[] = [
        { name: 'provider', label: 'Provider', type: 'select', options: [{label: 'Ollama', value: 'Ollama'}, {label: 'Gemini', value: 'Gemini'}], defaultValue: '' },
        { name: 'model', label: 'Model', type: 'string', defaultValue: '' },
        { name: 'content', label: 'Content', type: 'text', defaultValue: '' },
        { name: 'temperature', label: 'Temperature', type: 'number', defaultValue: 0 },
        { name: 'multiple_rows', label: 'Allow multiple rows', type: 'boolean', defaultValue: false }
    ];

    readonly inputs: InputDefinition[] = [
        { name: 'Content', acceptsType: 'string' },
        { name: 'Schema', acceptsType: 'core:dataframe' }
    ];

    readonly outputs: OutputDefinition[] = [
        { name: 'Success', outputType: 'boolean' },
        { name: 'Dataframe', outputType: 'core:dataframe' },
        { name: 'Error', outputType: 'string' }
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

    private extractJSON(text: string): string {
        const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) {
            return match[1].trim();
        }
        return text.trim();
    }

    async evaluate(inputs: Record<string, any>, properties: Record<string, any>): Promise<Record<string, any>> {
        const provider = await this.getProvider(properties);
        const model = await this.getModel(provider, properties);
        
        const contentStr = (inputs.Content || properties.content || '').toString();
        let schemaTable = inputs.Schema;
        
        if (schemaTable && schemaTable.__arqueroData) {
            schemaTable = schemaTable.__arqueroData;
        }

        if (schemaTable && typeof schemaTable.columnNames !== 'function') {
            try {
                // Check if it is arquero JSON format (string or object with schema)
                if (typeof schemaTable === 'string' || (schemaTable.schema && schemaTable.data)) {
                    schemaTable = aq.fromJSON(schemaTable);
                } else {
                    schemaTable = aq.from(schemaTable);
                }
            } catch (e) {
                // Fallthrough to error
            }
        }

        if (!schemaTable || typeof schemaTable.columnNames !== 'function') {
            return { Success: false, Error: 'Invalid Schema Dataframe', Event: true };
        }

        const columnNames = schemaTable.columnNames();
        const schemaObjects = schemaTable.objects();
        const schemaSample = schemaObjects.length > 0 ? schemaObjects[0] : null;

        const multipleRows = properties.multiple_rows === true;

        const systemPrompt = `You are a data generation assistant. Generate JSON that strictly conforms to the provided schema.
Schema columns: ${JSON.stringify(columnNames)}
${schemaSample ? `Schema example row: ${JSON.stringify(schemaSample)}` : ''}

CRITICAL RULES:
1. Return ONLY valid JSON.
2. ${multipleRows ? 'Return a JSON array of objects.' : 'Return a single JSON object.'}
3. The keys of the object(s) MUST exactly match the schema columns. Do not include extra keys.
4. Do not include markdown formatting or \`\`\`json wrappers in your response. Output pure JSON.`;

        let rawResult = '';
        let error = '';

        try {
            if (provider === 'Ollama') {
                const baseUrl = await traceReactive.settings.get('ollamaUrl') || 'http://localhost:11434';
                const response = await traceReactive.net.fetch(`${baseUrl}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        prompt: contentStr,
                        system: systemPrompt,
                        stream: false,
                        format: 'json',
                        options: {
                            temperature: properties.temperature || 0
                        }
                    })
                });
                
                const data = JSON.parse(response.text);
                if (data.error) throw new Error(data.error);
                rawResult = data.response;
                
            } else if (provider === 'Gemini') {
                const apiKey = await traceReactive.settings.get('geminiKey');
                if (!apiKey) throw new Error("Gemini API Key is missing in package settings.");
                
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const body: any = {
                    contents: [{ parts: [{ text: contentStr }] }],
                    generationConfig: {
                        temperature: properties.temperature || 0,
                        responseMimeType: "application/json"
                    },
                    systemInstruction: { parts: [{ text: systemPrompt }] }
                };
                
                const response = await traceReactive.net.fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                const data = JSON.parse(response.text);
                if (data.error) throw new Error(data.error.message || "Unknown Gemini error");
                rawResult = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            }

            let parsed: any;
            try {
                parsed = JSON.parse(this.extractJSON(rawResult));
            } catch (e: any) {
                throw new Error("Failed to parse JSON response: " + e.message + "\n\nRaw: " + rawResult);
            }

            let arr: any[] = [];
            if (Array.isArray(parsed)) {
                arr = parsed;
            } else if (parsed && typeof parsed === 'object') {
                arr = [parsed];
            } else {
                throw new Error("Response is not a valid JSON object or array.");
            }

            if (!multipleRows && arr.length > 1) {
                arr = [arr[0]];
            }

            // Hydrate strictly according to schema
            const hydratedArr = arr.map(row => {
                const hydratedRow: Record<string, any> = {};
                for (const col of columnNames) {
                    hydratedRow[col] = row[col] !== undefined ? row[col] : null;
                }
                return hydratedRow;
            });

            const resultTable = aq.from(hydratedArr);
            return { Success: true, Dataframe: resultTable, Error: '', Event: true };

        } catch (e: any) {
            return { Success: false, Error: e.message || String(e), Event: true };
        }
    }
}
