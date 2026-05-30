import { readFileSync } from "fs";
import { comfyuiConfig } from "../config.js";
import { log } from "../utils/logger.js";

type Orientation = "portrait" | "square" | "landscape";

interface WorkflowNode {
  inputs: Record<string, any>;
  class_type?: string;
  _meta?: { title?: string };
  [key: string]: any;
}

interface GenerateImageResult {
  buffer: Buffer;
  filename: string;
}

/**
 * Generate an image using ComfyUI.
 * Loads the workflow template, injects the prompt and resolution,
 * submits it, polls until complete, and downloads the result.
 *
 * @param prompt - worklflow
 * @param orientation - portrait, square, or landscape
 * @returns The generated image as a Buffer and its filename
 */
export async function generateImage(prompt: string, orientation: Orientation = "square"): Promise<GenerateImageResult> {
  const baseUrl = comfyuiConfig.baseUrl.replace(/\/+$/, "");

  const workflow = loadAndPrepareWorkflow(prompt, orientation);
  const promptId = await submitPrompt(baseUrl, workflow);
  log.info(`ComfyUI: Job ${promptId} submitted, waiting for completion...`);

  const output = await pollForCompletion(baseUrl, promptId);
  let buffer = await downloadImage(baseUrl, output);
  if (comfyuiConfig.stripMetadata) buffer = stripPngTextChunks(buffer);

  log.info(`ComfyUI: Image ready (${(buffer.length / 1024).toFixed(0)}KB)`);
  return { buffer, filename: output.filename };
}

function stripPngTextChunks(png: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (png.length < 8 || !png.subarray(0, 8).equals(signature)) return png;

  const chunks: Buffer[] = [signature];
  let offset = 8;

  while (offset < png.length) {
    if (offset + 8 > png.length) break;
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkEnd = offset + 12 + length;

    if (type !== "tEXt") chunks.push(png.subarray(offset, chunkEnd));
    offset = chunkEnd;
  }

  return Buffer.concat(chunks);
}

function loadAndPrepareWorkflow(prompt: string, orientation: Orientation): Record<string, WorkflowNode> {
  const workflowText = readFileSync(comfyuiConfig.workflowPath, "utf-8");
  const workflow: Record<string, WorkflowNode> = JSON.parse(workflowText);
  const cloned = structuredClone(workflow);

  const resolution = comfyuiConfig.resolutions[orientation] ?? comfyuiConfig.resolutions.square;
  let promptReplaced = false;
  let resolutionReplaced = false;

  const randomSeed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  let seedsReplaced = 0;

  for (const node of Object.values(cloned)) {
    if (!node.inputs || typeof node.inputs !== "object") continue;

    if (comfyuiConfig.randomizeSeeds && "seed" in node.inputs) {
      node.inputs.seed = randomSeed;
      seedsReplaced++;
    }

    // Find and replace <PROMPT>
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === "string" && value === "<PROMPT>") {
        node.inputs[key] = prompt;
        promptReplaced = true;
      }
    }

    // Find and replace resolution
    if ("width" in node.inputs && "height" in node.inputs) {
      node.inputs.width = resolution[0];
      node.inputs.height = resolution[1];
      resolutionReplaced = true;
    }
  }

  if (!promptReplaced)
    throw new Error(
      `No <PROMPT> placeholder found in workflow at ${comfyuiConfig.workflowPath}. ` +
        `Add a node with an input value of exactly "<PROMPT>".`,
    );

  if (seedsReplaced > 0) log.debug(`ComfyUI: Randomized ${seedsReplaced} seed(s) to ${randomSeed}`);
  if (!resolutionReplaced)
    log.warn("ComfyUI: No node with width/height inputs found, resolution not overridden in workflow");

  return cloned;
}

async function submitPrompt(baseUrl: string, workflow: Record<string, WorkflowNode>): Promise<string> {
  const response = await fetch(`${baseUrl}/prompt`, {
    // yes /prompt is different from /api/prompt
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ComfyUI submit failed: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const data = (await response.json()) as { prompt_id?: string; number?: number; node_errors?: Record<string, any> };

  if (data.node_errors && Object.keys(data.node_errors).length > 0)
    throw new Error(`ComfyUI node errors: ${JSON.stringify(data.node_errors)}`);
  if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id");

  return data.prompt_id;
}

interface ImageOutput {
  filename: string;
  subfolder: string;
  type: string;
}

async function pollForCompletion(baseUrl: string, promptId: string): Promise<ImageOutput> {
  const timeoutMs = comfyuiConfig.timeoutSeconds * 1000;
  const intervalMs = comfyuiConfig.pollIntervalMs;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const response = await fetch(`${baseUrl}/api/history?max_items=64`);

    if (!response.ok) {
      log.warn(`ComfyUI: History poll failed (${response.status}), retrying...`);
      await sleep(intervalMs);
      continue;
    }

    const history = (await response.json()) as Record<string, any>;

    const entry = history[promptId];
    if (entry) {
      const status = entry.status;
      if (status?.status_str === "success" && status.completed) {
        const outputs: Record<string, any> = entry.outputs ?? {};
        for (const nodeOutput of Object.values(outputs)) {
          if (nodeOutput.images && Array.isArray(nodeOutput.images) && nodeOutput.images.length > 0) {
            const image = nodeOutput.images[0] as ImageOutput;
            return image;
          }
        }
        throw new Error("ComfyUI job completed but no images found in output");
      }
    }
    await sleep(intervalMs);
  }
  throw new Error(`ComfyUI timed out after ${comfyuiConfig.timeoutSeconds}s waiting for job ${promptId}`);
}

async function downloadImage(baseUrl: string, output: ImageOutput): Promise<Buffer> {
  const params = new URLSearchParams({
    filename: output.filename,
    type: output.type,
    subfolder: output.subfolder,
    t: String(Date.now()),
  });

  const response = await fetch(`${baseUrl}/view?${params}`);
  if (!response.ok) throw new Error(`ComfyUI image download failed: ${response.status} ${response.statusText}`);

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
