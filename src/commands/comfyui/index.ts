import { comfyuiConfig } from "../../config.js";
import { generateImage } from "../../api/comfyui.js";
import type { CommandDef, AsyncCommandResult } from "../registry.js";

type Orientation = "portrait" | "square" | "landscape";

export const generateImageCommand: CommandDef<{ prompt: string; orientation?: Orientation }, AsyncCommandResult> = {
  name: "generateImage",
  args: { prompt: "string", orientation: "portrait | square | landscape (default: square)" },
  description: `Generate an image using the image generator. Provide a descriptive prompt and choose orientation. The image will be sent as a follow-up message. Use Booru style tags like "1girl, smile, blue hair, medium breasts, cowboy shot, dark, simple background" etc. natural language does not work as well.`,
  kind: "async",
  enabled: () => comfyuiConfig.enabled,
  execute: async (argsRaw) => {
    const { prompt, orientation = "square" } = argsRaw as { prompt: string; orientation?: Orientation };
    if (!prompt || typeof prompt !== "string")
      return { success: false, message: "Invalid prompt argument for generateImage" };

    const validOrientations: Orientation[] = ["portrait", "square", "landscape"];
    const safeOrientation: Orientation = validOrientations.includes(orientation) ? orientation : "square";

    try {
      const result = await generateImage(prompt, safeOrientation);
      return {
        success: true,
        message: `Image generated (${safeOrientation}): "${prompt}"`,
        attachment: { buffer: result.buffer, name: result.filename },
        prompt,
        orientation: safeOrientation,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
