import { PromptModelNode } from './nodes/PromptModelNode';
import { GenerateEmbeddingNode } from './nodes/GenerateEmbeddingNode';
import type { TraceReactiveAPI } from '@tracereactive/types';

declare const traceReactive: TraceReactiveAPI;

const nodes = [
    new PromptModelNode(),
    new GenerateEmbeddingNode()
];

const serializableNodes = nodes.map(n => ({
    typeId: n.typeId,
    displayName: n.displayName,
    category: n.category,
    nodeInterface: n.nodeInterface,
    visible: n.visible,
    inputs: n.nodeInterface === 'execute' || n.nodeInterface === 'event' ? (n as any).getInputs() : n.inputs,
    outputs: n.nodeInterface === 'execute' || n.nodeInterface === 'event' ? (n as any).getOutputs() : n.outputs,
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
    return await node.evaluate(inputs, properties);
});
