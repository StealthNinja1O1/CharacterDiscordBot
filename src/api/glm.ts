const GLM_API_KEY = process.env.GLM_API_KEY;
const GLM_BASE_URL = process.env.GLM_BASE_URL

interface GLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GLMRequest {
  model: string;
  messages: GLMMessage[];
  temperature: number;
}

interface GLMResponse {
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
  messages: GLMMessage[],
  temperature: number
): Promise<string> {
  if (!GLM_API_KEY) {
    throw new Error("GLM_API_KEY is not configured in .env file");
  }

  const requestBody: GLMRequest = {
    model,
    messages,
    temperature,
  };

  try {
    const response = await fetch(`${GLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GLM_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GLM API request failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data = (await response.json()) as GLMResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error("No response from GLM API");
    }

    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling GLM API:", error);
    throw error;
  }
}