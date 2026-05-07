"use client";

import { useMemo } from "react";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { BaseNode } from "./BaseNode";
import { HandleLabel } from "./HandleLabel";
import { useShowHandleLabels } from "@/hooks/useShowHandleLabels";
import { useWorkflowStore } from "@/store/workflowStore";
import type {
  CropNodeData,
  RemoveBgNodeData,
  ResizeNodeData,
  UpscaleNodeData,
  WorkflowNodeData,
  WorkflowNode,
  WorkflowEdge,
} from "@/types";
import { getSourceOutput } from "@/store/utils/connectedInputs";

function getConnectedInputImage(nodeId: string, edges: WorkflowEdge[], nodes: WorkflowNode[]): string | null {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  for (const edge of incomingEdges) {
    const sourceNode = nodes.find((node) => node.id === edge.source);
    if (!sourceNode) continue;
    const output = getSourceOutput(sourceNode, edge.sourceHandle, edge.data as Record<string, unknown> | undefined);
    if (output.type === "image" && output.value) {
      return output.value;
    }
  }
  return null;
}

function clearTransformOutput(
  id: string,
  data: Record<string, unknown>,
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void,
) {
  updateNodeData(id, {
    ...data,
    outputImage: null,
    outputImageRef: undefined,
    error: null,
    status: "idle",
  } as Partial<WorkflowNodeData>);
}

interface TransformLayoutProps {
  id: string;
  selected: boolean;
  title: string;
  subtitle?: string;
  outputImage: string | null;
  sourceImage: string | null;
  status: string;
  error: string | null;
  canRun: boolean;
  onRun: () => void;
  onClear: () => void;
  controls: React.ReactNode;
}

function TransformLayout({
  id,
  selected,
  title,
  subtitle,
  outputImage,
  sourceImage,
  status,
  error,
  canRun,
  onRun,
  onClear,
  controls,
}: TransformLayoutProps) {
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const showLabels = useShowHandleLabels(selected);
  const displayImage = outputImage || sourceImage;

  return (
    <BaseNode
      id={id}
      selected={selected}
      isExecuting={isRunning}
      hasError={status === "error"}
      minWidth={320}
      minHeight={320}
      aspectFitMedia={displayImage}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        data-handletype="image"
        isConnectable={true}
        style={{ top: "50%" }}
      />
      <HandleLabel label="Image In" side="target" color="rgb(59, 130, 246)" top="calc(50% - 7px)" visible={showLabels} />

      <Handle
        type="source"
        position={Position.Right}
        id="image"
        data-handletype="image"
        isConnectable={true}
        style={{ top: "50%" }}
      />
      <HandleLabel label="Image Out" side="source" color="rgb(59, 130, 246)" top="calc(50% - 7px)" visible={showLabels} />

      <div className="flex-1 flex flex-col min-h-0 gap-2">
        <div className="shrink-0 px-1">
          <div className="text-xs font-semibold text-neutral-100">{title}</div>
          {subtitle && <div className="text-[10px] text-neutral-500 mt-0.5">{subtitle}</div>}
        </div>

        <div className="flex-1 min-h-[140px] relative rounded border border-neutral-800 overflow-hidden bg-neutral-900/60">
          {displayImage ? (
            <>
              <img
                src={displayImage}
                alt={title}
                className="absolute inset-0 w-full h-full object-contain"
              />
              {outputImage && (
                <button
                  onClick={onClear}
                  className="absolute top-1 right-1 w-5 h-5 bg-neutral-900/80 hover:bg-red-600/80 rounded flex items-center justify-center text-neutral-400 hover:text-white transition-colors"
                  title="Clear output"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <div className="absolute left-1 top-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-neutral-200 uppercase tracking-wide">
                {outputImage ? "Output" : "Input"}
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center border border-dashed border-neutral-700 rounded">
              <span className="text-[10px] text-neutral-500 text-center px-4">
                Connect an image to process
              </span>
            </div>
          )}
        </div>

        <div className="nodrag nowheel shrink-0 px-1 space-y-2">
          {controls}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 px-1">
          <div className="text-[10px] text-neutral-500">
            {status === "loading" ? "Processing..." : outputImage ? "Ready" : "Idle"}
          </div>
          <button
            onClick={onRun}
            disabled={!canRun}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 disabled:cursor-not-allowed rounded text-white text-xs font-medium transition-colors"
          >
            {status === "loading" ? "Running..." : "Run"}
          </button>
        </div>

        {error && (
          <div className="shrink-0 px-2 py-1.5 bg-red-900/30 border border-red-700/50 rounded">
            <p className="text-[10px] text-red-400 break-words">{error}</p>
          </div>
        )}
      </div>
    </BaseNode>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <div className="text-[10px] text-neutral-400 mb-1">{label}</div>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="nodrag nowheel w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-100 focus:outline-none focus:border-neutral-500"
      />
    </label>
  );
}

type CropNodeType = Node<CropNodeData, "crop">;
type ResizeNodeType = Node<ResizeNodeData, "resize">;
type UpscaleNodeType = Node<UpscaleNodeData, "upscale">;
type RemoveBgNodeType = Node<RemoveBgNodeData, "removeBg">;
const CROP_ASPECT_RATIOS: Array<{ value: CropNodeData["aspectRatio"]; label: string }> = [
  { value: "original", label: "Original" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "21:9", label: "21:9" },
];

export function CropNode({ id, data, selected }: NodeProps<CropNodeType>) {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const edges = useWorkflowStore((state) => state.edges);
  const nodes = useWorkflowStore((state) => state.nodes);
  const sourceImage = useMemo(() => getConnectedInputImage(id, edges, nodes) || data.inputImages[0] || null, [id, edges, nodes, data.inputImages]);

  return (
    <TransformLayout
      id={id}
      selected={selected}
      title="Crop"
      subtitle="Centered aspect crop"
      outputImage={data.outputImage}
      sourceImage={sourceImage}
      status={data.status}
      error={data.error}
      canRun={Boolean(sourceImage) && data.status !== "loading" && !isRunning}
      onRun={() => regenerateNode(id)}
      onClear={() => updateNodeData(id, { outputImage: null, outputImageRef: undefined, status: "idle", error: null })}
      controls={
        <label className="block">
          <div className="text-[10px] text-neutral-400 mb-1">Aspect Ratio</div>
          <select
            value={data.aspectRatio}
            onChange={(e) => clearTransformOutput(id, { aspectRatio: e.target.value as CropNodeData["aspectRatio"] }, updateNodeData)}
            className="nodrag nowheel w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-100 focus:outline-none focus:border-neutral-500"
          >
            {CROP_ASPECT_RATIOS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      }
    />
  );
}

export function ResizeNode({ id, data, selected }: NodeProps<ResizeNodeType>) {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const edges = useWorkflowStore((state) => state.edges);
  const nodes = useWorkflowStore((state) => state.nodes);
  const sourceImage = useMemo(() => getConnectedInputImage(id, edges, nodes) || data.inputImages[0] || null, [id, edges, nodes, data.inputImages]);

  return (
    <TransformLayout
      id={id}
      selected={selected}
      title="Resize"
      subtitle="Deterministic resample"
      outputImage={data.outputImage}
      sourceImage={sourceImage}
      status={data.status}
      error={data.error}
      canRun={Boolean(sourceImage) && data.status !== "loading" && !isRunning}
      onRun={() => regenerateNode(id)}
      onClear={() => updateNodeData(id, { outputImage: null, outputImageRef: undefined, status: "idle", error: null })}
      controls={
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Width"
              value={data.width}
              min={1}
              onChange={(value) => clearTransformOutput(id, { width: Math.max(1, value) }, updateNodeData)}
            />
            <NumberField
              label="Height"
              value={data.height}
              min={1}
              onChange={(value) => clearTransformOutput(id, { height: Math.max(1, value) }, updateNodeData)}
            />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-neutral-300">
            <input
              type="checkbox"
              checked={data.keepAspectRatio}
              onChange={(e) => clearTransformOutput(id, { keepAspectRatio: e.target.checked }, updateNodeData)}
              className="rounded border-neutral-600 bg-neutral-800"
            />
            Keep aspect ratio
          </label>
        </>
      }
    />
  );
}

export function UpscaleNode({ id, data, selected }: NodeProps<UpscaleNodeType>) {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const edges = useWorkflowStore((state) => state.edges);
  const nodes = useWorkflowStore((state) => state.nodes);
  const sourceImage = useMemo(() => getConnectedInputImage(id, edges, nodes) || data.inputImages[0] || null, [id, edges, nodes, data.inputImages]);

  return (
    <TransformLayout
      id={id}
      selected={selected}
      title="Upscale"
      subtitle="fal.ai Topaz Upscale"
      outputImage={data.outputImage}
      sourceImage={sourceImage}
      status={data.status}
      error={data.error}
      canRun={Boolean(sourceImage) && data.status !== "loading" && !isRunning}
      onRun={() => regenerateNode(id)}
      onClear={() => updateNodeData(id, { outputImage: null, outputImageRef: undefined, status: "idle", error: null })}
      controls={
        <>
          <label className="block">
            <div className="text-[10px] text-neutral-400 mb-1">Model</div>
            <select
              value={data.model}
              onChange={(e) => clearTransformOutput(id, { model: e.target.value as UpscaleNodeData["model"] }, updateNodeData)}
              className="nodrag nowheel w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-100 focus:outline-none focus:border-neutral-500"
            >
              <option value="Standard V2">Standard V2</option>
              <option value="High Fidelity V2">High Fidelity V2</option>
              <option value="Recovery V2">Recovery V2</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Upscale Factor"
              value={data.upscaleFactor}
              min={1}
              max={4}
              step={0.5}
              onChange={(value) => clearTransformOutput(id, { upscaleFactor: Math.max(1, Math.min(4, value)) }, updateNodeData)}
            />
            <label className="block">
              <div className="text-[10px] text-neutral-400 mb-1">Subject</div>
              <select
                value={data.subjectDetection}
                onChange={(e) => clearTransformOutput(id, { subjectDetection: e.target.value as UpscaleNodeData["subjectDetection"] }, updateNodeData)}
                className="nodrag nowheel w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-100 focus:outline-none focus:border-neutral-500"
              >
                <option value="All">All</option>
                <option value="Foreground">Foreground</option>
                <option value="Background">Background</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-neutral-300">
            <input
              type="checkbox"
              checked={data.faceEnhancement}
              onChange={(e) => clearTransformOutput(id, { faceEnhancement: e.target.checked }, updateNodeData)}
              className="rounded border-neutral-600 bg-neutral-800"
            />
            Face enhancement
          </label>
        </>
      }
    />
  );
}

export function RemoveBgNode({ id, data, selected }: NodeProps<RemoveBgNodeType>) {
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const regenerateNode = useWorkflowStore((state) => state.regenerateNode);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const edges = useWorkflowStore((state) => state.edges);
  const nodes = useWorkflowStore((state) => state.nodes);
  const sourceImage = useMemo(() => getConnectedInputImage(id, edges, nodes) || data.inputImages[0] || null, [id, edges, nodes, data.inputImages]);

  return (
    <TransformLayout
      id={id}
      selected={selected}
      title="Remove BG"
      subtitle="fal.ai BiRefNet v2"
      outputImage={data.outputImage}
      sourceImage={sourceImage}
      status={data.status}
      error={data.error}
      canRun={Boolean(sourceImage) && data.status !== "loading" && !isRunning}
      onRun={() => regenerateNode(id)}
      onClear={() => updateNodeData(id, { outputImage: null, outputImageRef: undefined, status: "idle", error: null })}
      controls={
        <>
          <label className="block">
            <div className="text-[10px] text-neutral-400 mb-1">Model</div>
            <select
              value={data.model}
              onChange={(e) => clearTransformOutput(id, { model: e.target.value as RemoveBgNodeData["model"] }, updateNodeData)}
              className="nodrag nowheel w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-100 focus:outline-none focus:border-neutral-500"
            >
              <option value="General Use (Light)">General Use (Light)</option>
              <option value="General Use (Light 2K)">General Use (Light 2K)</option>
              <option value="General Use (Heavy)">General Use (Heavy)</option>
              <option value="Portrait">Portrait</option>
              <option value="Matting">Matting</option>
              <option value="General Use (Dynamic)">General Use (Dynamic)</option>
            </select>
          </label>
          <label className="block">
            <div className="text-[10px] text-neutral-400 mb-1">Resolution</div>
            <select
              value={data.operatingResolution}
              onChange={(e) => clearTransformOutput(id, { operatingResolution: e.target.value as RemoveBgNodeData["operatingResolution"] }, updateNodeData)}
              className="nodrag nowheel w-full px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-100 focus:outline-none focus:border-neutral-500"
            >
              <option value="1024x1024">1024x1024</option>
              <option value="2048x2048">2048x2048</option>
              <option value="2304x2304">2304x2304</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-neutral-300">
            <input
              type="checkbox"
              checked={data.refineForeground}
              onChange={(e) => clearTransformOutput(id, { refineForeground: e.target.checked }, updateNodeData)}
              className="rounded border-neutral-600 bg-neutral-800"
            />
            Refine foreground edges
          </label>
        </>
      }
    />
  );
}
