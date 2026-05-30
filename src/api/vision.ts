import { ImageAttachment } from "../models.js";
import { DiscordConfig, llmConfig } from "../config.js";
import { log } from "../utils/logger.js";

interface VisionChatMessage {
  role: "user";
  content: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
}

interface VisionCompletionResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Describes a single image using the configured vision model.
 * Returns a detailed text description of the image contents.
 */
export async function describeImage(image: ImageAttachment, config: DiscordConfig): Promise<string> {
  const apiKey = config.visionModelApiKey || llmConfig.apiKey || "";
  const baseUrl = config.visionModelBaseUrl || llmConfig.baseUrl || "";

  const content: VisionChatMessage["content"] = [
    {
      type: "text",
      text: "Describe this image in detail. Include all visible elements, people, actions, expressions, text, colors, and the overall scene. Be thorough and specific.",
    },
    {
      type: "image_url",
      image_url: { url: image.base64 },
    },
  ];

  try {
    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.visionModel,
        messages: [{ role: "user", content }],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = (await response.json()) as VisionCompletionResponse;

    if (!data.choices || data.choices.length === 0) throw new Error("No response from vision API");

    const elapsed = (Date.now() - startTime) / 1000;
    const usage = data.usage;
    if (usage)
      log.info(
        `Vision model: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} tokens (${elapsed.toFixed(1)}s)`,
      );
    else log.info(`Vision model response received in ${elapsed.toFixed(1)}s`);

    return data.choices[0].message.content.trim();
  } catch (error) {
    log.error("Vision API request failed:", error);
    throw error;
  }
}

/**
 * Describes multiple images in parallel using the configured vision model.
 * Returns an array of text descriptions, one per image.
 * Failed images return a fallback description instead
 */
export async function describeImages(images: ImageAttachment[], config: DiscordConfig): Promise<string[]> {
  const results = await Promise.all(
    images.map(async (image, index) => {
      try {
        const description = await describeImage(image, config);
        log.debug(`Vision image ${index + 1}/${images.length} described (${description.length} chars)`);
        return description;
      } catch (error) {
        log.warn(`Failed to describe image ${index + 1}/${images.length}, skipping: ${error}`);
        return "[Image description unavailable]";
      }
    }),
  );
  return results;
}

export function formatImageDescriptions(descriptions: string[]): string {
  if (descriptions.length === 0) return "";
  if (descriptions.length === 1) {
    return `[Attached image: ${descriptions[0]}]`;
  }
  return descriptions.map((desc, i) => `[Attached image ${i + 1}: ${desc}]`).join("\n");
}
