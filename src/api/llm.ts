const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_BASE_URL = process.env.LLM_BASE_URL;
if (!LLM_API_KEY) throw new Error("LLM API key (LLM_API_KEY) is not configured in .env file");
if (!LLM_BASE_URL) throw new Error("LLM base URL (LLM_BASE_URL) is not configured in .env file");

import { ImageAttachment } from "../models.js";
import { discordConfig } from "../config.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  thinking?: { type: string };
}

interface ChatCompletionResponse {
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

export async function generateResponse(
  model: string,
  messages: ChatMessage[],
  temperature: number,
  noThink = false,
  images: ImageAttachment[] = [],
): Promise<string> {
  // Build multimodal messages if vision is enabled and images are present
  let finalMessages = messages;

  if (discordConfig.enableVision && images.length > 0) {
    finalMessages = messages.map((msg) => {
      // Only modify user messages; keep system and assistant as-is
      if (msg.role !== "user") {
        return msg;
      }

      // Check if this is the last user message (the one that triggered the bot)
      const isLastUserMessage =
        messages.filter((m) => m.role === "user").length > 0 &&
        msg === messages.filter((m) => m.role === "user").pop();

      // Only add images to the last user message
      if (!isLastUserMessage) {
        return msg;
      }

      // Build multimodal content array
      const content: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [];

      // Add text content
      const textContent = typeof msg.content === "string" ? msg.content : msg.content.find((c) => c.type === "text")?.text || "";
      if (textContent) {
        content.push({ type: "text", text: textContent });
      }

      // Add images
      for (const image of images) {
        // Truncate base64 in logs to avoid exposing sensitive content
        const shortBase64 = image.base64.length > 100 ? image.base64.substring(0, 100) + "..." : image.base64;
        console.log(`Adding vision image: ${image.contentType}, data: ${shortBase64}`);
        content.push({ type: "image_url", image_url: { url: image.base64 } });
      }

      return {
        role: msg.role,
        content: content,
      };
    });
  }

  const requestBody: ChatCompletionRequest = {
    model,
    messages: finalMessages,
    temperature,
    ...(noThink && { thinking: { type: "disabled" } }),
  };

  try {
    const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from LLM API");
    }

    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling LLM API:", error);
    throw error;
  }
}
