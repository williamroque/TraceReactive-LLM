import { PromptModelNode } from './nodes/PromptModelNode';
import { GenerateEmbeddingNode } from './nodes/GenerateEmbeddingNode';
import { GenerateDataframeNode } from './nodes/GenerateDataframeNode';
import type { TraceReactiveAPI } from '@tracereactive/types';

declare const traceReactive: TraceReactiveAPI;

const nodes = [
    new PromptModelNode(),
    new GenerateEmbeddingNode(),
    new GenerateDataframeNode()
];

const serializableNodes = nodes.map(n => ({
    typeId: n.typeId,
    displayName: n.displayName,
    category: n.category,
    nodeInterface: n.nodeInterface,
    visible: n.visible,
    inputs: n.inputs,
    outputs: n.outputs,
    properties: n.properties,
    dynamicInputs: n.dynamicInputs,
    dynamicOutputs: n.dynamicOutputs
}));

traceReactive.registerNodes(serializableNodes);

traceReactive.onEvaluateNode(async ({ typeId, inputs, properties }: any) => {
    const node = nodes.find(n => n.typeId === typeId);
    if (!node) {
        throw new Error(`Unknown node type: ${typeId}`);
    }

    const deserialize = (obj: any): any => {
        if (!obj) return obj;
        if (obj.__arqueroData) {
            return (globalThis as any).aq ? (globalThis as any).aq.from(obj.__arqueroData) : obj.__arqueroData;
        }
        if (Array.isArray(obj)) return obj.map(deserialize);
        if (typeof obj === 'object') {
            const res: any = {};
            for (const k in obj) res[k] = deserialize(obj[k]);
            return res;
        }
        return obj;
    };

    const serialize = (obj: any): any => {
        if (!obj) return obj;
        // Duck-type check for Arquero table
        if (typeof obj.numRows === 'function' && typeof obj.columnNames === 'function') {
            return { __arqueroData: obj.objects() };
        }
        if (Array.isArray(obj)) return obj.map(serialize);
        if (typeof obj === 'object') {
            const res: any = {};
            for (const k in obj) res[k] = serialize(obj[k]);
            return res;
        }
        return obj;
    };

    // We don't have arquero imported in index.ts directly, but if we did we could deserialize properly.
    // Actually, GenerateDataframeNode already handles __arqueroData. But for serialization, we definitely need it.
    
    const parsedInputs = deserialize(inputs);
    const result = await node.evaluate(parsedInputs, properties);
    return serialize(result);
});
